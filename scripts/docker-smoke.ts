/** Integration check against built images; uses disposable databases, never real holdings. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { historySchema } from "../lib/history-schema";

const dir = mkdtempSync(resolve(".docker-smoke-"));
const containers: string[] = [];
const revision = "a".repeat(64);
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const webImage = process.env.SMOKE_WEB_IMAGE || "portfolio-web:test";
const workerImage =
  process.env.SMOKE_WORKER_IMAGE || "portfolio-snapshots:test";
const common = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges:true",
  "--tmpfs",
  "/tmp:rw,size=32m,mode=1777",
  "--user",
  `${process.getuid!()}:${process.getgid!()}`,
];
const manualMount = ["-v", `${join(dir, "manual")}:/data`];
function form(html: string, match: string) {
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const source = html
    .match(/<form\b[\s\S]*?<\/form>/g)
    ?.find((f) => f.includes(match));
  assert.ok(source, `Expected form: ${match}`);
  const data = new FormData();
  for (const input of source.match(/<input\b[^>]*>/g) ?? []) {
    const name = /\bname="([^"]*)"/.exec(input)?.[1];
    const value = /\bvalue="([^"]*)"/.exec(input)?.[1] ?? "";
    if (name) data.append(decode(name), decode(value));
  }
  return data;
}
async function start(auth: boolean) {
  const id = docker(
    "run",
    "-d",
    ...common,
    ...manualMount,
    "-v",
    `${join(dir, "history")}:/history:ro`,
    "-p",
    "127.0.0.1::3000",
    "-e",
    "MANUAL_DB_PATH=/data/manual.sqlite",
    "-e",
    "HISTORY_DB_PATH=/history/portfolio.sqlite",
    ...(auth
      ? [
          "-e",
          "DASHBOARD_PASSWORD=smoke-test-password",
          "-e",
          `DASHBOARD_SESSION_SECRET=${randomBytes(32).toString("hex")}`,
          "-e",
          "AUTH_COOKIE_SECURE=false",
        ]
      : []),
    webImage,
  );
  containers.push(id);
  const port = docker("port", id, "3000/tcp").split(":").at(-1);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { id, url };
    } catch {}
    await setTimeout(500);
  }
  throw new Error("Container failed its health check");
}
async function main() {
  try {
    mkdirSync(join(dir, "manual"));
    mkdirSync(join(dir, "history"));
    const db = new DatabaseSync(join(dir, "history/portfolio.sqlite"));
    db.exec(historySchema);
    db.prepare(
      "INSERT INTO metadata VALUES ('schemaVersion','1'),('revision',?),('historicalThrough','2020-01-01')",
    ).run(revision);
    db.exec(
      "INSERT INTO portfolio_values VALUES ('2020-01-01','100','100',0,0,0,NULL)",
    );
    db.close();
    const closed = await start(false);
    assert.equal(
      (await fetch(`${closed.url}/`, { redirect: "manual" })).status,
      303,
    );
    assert.match(
      await (await fetch(`${closed.url}/login`)).text(),
      /Sign-in is not configured/,
    );
    docker("rm", "-f", closed.id);
    containers.splice(containers.indexOf(closed.id), 1);
    const { url, id } = await start(true);
    assert.equal(
      (await fetch(`${url}/manual`, { method: "POST", redirect: "manual" }))
        .status,
      303,
    );
    assert.equal((await fetch(`${url}/api/history`)).status, 401);
    assert.equal(
      (await fetch(`${url}/`, { headers: { RSC: "1" }, redirect: "manual" }))
        .status,
      303,
    );
    const loginHtml = await (await fetch(`${url}/login`)).text();
    const bad = form(loginHtml, 'name="password"');
    bad.set("password", "wrong");
    const post = (path: string, body: FormData, cookie = "") =>
      fetch(`${url}${path}`, {
        method: "POST",
        body,
        headers: { Origin: url, ...(cookie ? { Cookie: cookie } : {}) },
        redirect: "manual",
      });
    assert.match(
      await (await post("/login", bad)).text(),
      /Incorrect password/,
    );
    const good = form(loginHtml, 'name="password"');
    good.set("password", "smoke-test-password");
    const login = await post("/login", good);
    assert.equal(login.status, 303);
    const setCookie = login.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    const cookie = setCookie.split(";")[0];
    const get = (path: string) =>
      fetch(`${url}${path}`, { headers: { Cookie: cookie } });
    const home = await get("/");
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Last background sync/);
    const manualHtml = await (await get("/manual")).text();
    const blockedEdit = form(manualHtml, "Add account");
    blockedEdit.set("name", "Unauthorized account");
    blockedEdit.set("institution", "Must not be saved");
    const denied = await post("/login", blockedEdit);
    // Next may reject an action posted to a different page before invoking it.
    // Either that rejection or our authentication redirect must prevent the write.
    assert.ok(denied.status === 303 || denied.status >= 400);
    if (denied.status === 303)
      assert.equal(
        new URL(denied.headers.get("location")!, url).pathname,
        "/login",
      );
    assert.ok(
      !(await (await get("/manual")).text()).includes("Unauthorized account"),
    );
    const account = form(manualHtml, "Add account");
    account.set("name", "Docker test account");
    account.set("institution", "Test institution");
    await post("/manual", account, cookie);
    assert.match(await (await get("/manual")).text(), /Docker test account/);
    const detail = await get(
      `/api/history?date=2020-01-01&revision=${revision}`,
    );
    assert.equal(detail.status, 200);
    const signout = await post("/", form(homeHtml, "Sign out"), cookie);
    assert.equal(signout.status, 303);
    assert.match(signout.headers.get("set-cookie")!, /Max-Age=0/i);
    assert.equal((await fetch(`${url}/`, { redirect: "manual" })).status, 303);
    docker(
      "exec",
      id,
      "node",
      "-e",
      "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/history/portfolio.sqlite');try{db.exec('CREATE TABLE forbidden_write (id INTEGER)');process.exit(1)}catch(e){if(!/readonly/i.test(e.message))throw e}finally{db.close()}",
    );
    docker(
      "exec",
      id,
      "node",
      "-e",
      "const fs=require('fs'); for (const p of ['.env.local','data/portfolio.sqlite']) if(fs.existsSync(p)) process.exit(1)",
    );
    docker(
      "run",
      "--rm",
      ...common,
      ...manualMount,
      "-v",
      `${join(dir, "history")}:/history`,
      "-e",
      "HISTORY_DB_PATH=/history/portfolio.sqlite",
      "-e",
      "MANUAL_DB_PATH=/data/manual.sqlite",
      workerImage,
      "node",
      "--conditions=react-server",
      "--import",
      "tsx",
      "-e",
      `require('./lib/snapshots/run.ts'); const {appendSnapshot}=require('./lib/snapshots/store.ts'); if(!appendSnapshot({date:'2020-01-02',retrievedAt:'2020-01-02T22:00:00Z',holdings:[],stale:false})) process.exit(1);`,
    );
    console.log(
      "Docker smoke passed: fail-closed login, password/session/logout, API/RSC/action protection, manual writes, read-only web history, worker append and image data exclusions.",
    );
  } finally {
    for (const id of containers) {
      try {
        docker("rm", "-f", id);
      } catch {
        console.error("Could not remove smoke container", id);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
