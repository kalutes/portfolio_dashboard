import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import manifest from "../app/manifest";

test("install manifest uses standalone mode with valid Android and Apple PNG icons", () => {
  const m = manifest();
  assert.equal(m.display, "standalone");
  assert.equal(m.scope, "/");
  assert.equal(m.start_url, "/");
  for (const icon of m.icons ?? []) {
    const bytes = readFileSync("public" + icon.src);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const [width, height] = icon.sizes!.split("x").map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
  const apple = readFileSync("public/icons/apple-touch-icon.png");
  assert.equal(apple.readUInt32BE(16), 180);
});

test("service worker caches only the generic offline page; financial traffic stays network-only", async () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const cached: string[] = [];
  const removed: string[] = [];
  let fail = false;
  let requests = 0;
  let policy: RequestCache | undefined;
  const offline = new Response("Offline screen");
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://portfolio.test" },
      addEventListener: (
        name: string,
        callback: (event: Record<string, unknown>) => void,
      ) => listeners.set(name, callback),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => ({
        add: async (request: Request) => {
          cached.push(request.url);
        },
        match: async () => offline,
      }),
      keys: async () => ["portfolio-shell-v0", "unrelated-cache"],
      delete: async (name: string) => {
        removed.push(name);
      },
    },
    Request: class extends Request {
      constructor(input: string, init?: RequestInit) {
        super(new URL(input, "https://portfolio.test"), init);
      }
    },
    Response,
    URL,
    fetch: async (_request: unknown, options: RequestInit) => {
      requests++;
      policy = options.cache;
      if (fail) throw new Error("offline");
      return new Response("private portfolio");
    },
  });
  let done: Promise<unknown> = Promise.resolve();
  listeners.get("install")!({
    waitUntil: (p: Promise<unknown>) => {
      done = p;
    },
  });
  await done;
  assert.deepEqual(cached, ["https://portfolio.test/offline.html"]);
  listeners.get("activate")!({
    waitUntil: (p: Promise<unknown>) => {
      done = p;
    },
  });
  await done;
  assert.deepEqual(removed, ["portfolio-shell-v0"]);
  let response: Promise<Response> | undefined;
  const navigate = () =>
    listeners.get("fetch")!({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://portfolio.test/",
      },
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    });
  navigate();
  assert.equal(await (await response!).text(), "private portfolio");
  assert.equal(policy, "no-store");
  fail = true;
  navigate();
  assert.equal(await (await response!).text(), "Offline screen");
  for (const request of [
    { method: "GET", mode: "cors", url: "https://portfolio.test/api/history" },
    { method: "GET", mode: "cors", url: "https://portfolio.test/?_rsc=abc" },
    { method: "POST", mode: "navigate", url: "https://portfolio.test/manual" },
  ]) {
    listeners.get("fetch")!({
      request,
      respondWith: () => assert.fail("API/RSC/actions must not be intercepted"),
    });
  }
  assert.equal(requests, 2);
  assert.deepEqual(cached, ["https://portfolio.test/offline.html"]);
});
