import { createSession } from "../lib/auth/session";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { historySchema, protectHistory } from "../lib/history-schema";
import {
  loadHistoricalSeries,
  loadHistoricalDetail,
  HistoryRevisionChanged,
  withHistory,
} from "../lib/historical-store";
import { validHistoryDay } from "../lib/historical-types";
import { GET } from "../app/api/history/route";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "history-"));
  const path = join(dir, "history.sqlite");
  const hash = "a".repeat(64);
  const db = new DatabaseSync(path);
  db.exec(historySchema);
  db.prepare("INSERT INTO metadata VALUES (?,?)").run("schemaVersion", "1");
  db.prepare("INSERT INTO metadata VALUES (?,?)").run("revision", hash);
  db.prepare("INSERT INTO metadata VALUES (?,?)").run(
    "historicalThrough",
    "2021-06-15",
  );
  db.exec(`INSERT INTO portfolio_values VALUES ('2021-06-15',NULL,'100.25',1,1,1,NULL);
 INSERT INTO portfolio_holdings VALUES ('2021-06-15','GME','GME','2','100.25','anchor_linear_interpolation','2021-06-01','2021-06-30');
 INSERT INTO portfolio_holdings VALUES ('2021-06-15','FUND','FUND',NULL,NULL,'unavailable',NULL,NULL);`);
  db.exec(protectHistory);
  db.close();
  return { dir, path, hash };
}
test("history preserves partial values, estimates, dates and read-only access", () => {
  const f = fixture();
  try {
    const series = loadHistoricalSeries(f.path);
    assert.deepEqual(series.points, [
      {
        day: "2021-06-15",
        total: null,
        known: 100.25,
        missing: 1,
        estimated: 1,
        stale: true,
      },
    ]);
    const detail = loadHistoricalDetail("2021-06-15", f.hash, f.path)!;
    assert.equal(detail.holdings[1].quantity, null);
    assert.equal(detail.holdings[1].value, null);
    assert.equal(detail.holdings[0].previous, "2021-06-01");
    assert.equal(loadHistoricalDetail("2021-06-16", f.hash, f.path), null);
    assert.throws(
      () => loadHistoricalDetail("2021-06-15", "0".repeat(64), f.path),
      HistoryRevisionChanged,
    );
    assert.throws(() =>
      withHistory((db) => db.exec("DELETE FROM portfolio_values"), f.path),
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("history API validates dates and revisions, avoids caching and conceals paths", async () => {
  const f = fixture();
  const previous = process.env.HISTORY_DB_PATH;
  const oldPassword = process.env.DASHBOARD_PASSWORD;
  const oldSecret = process.env.DASHBOARD_SESSION_SECRET;
  process.env.DASHBOARD_PASSWORD = "test-password";
  process.env.DASHBOARD_SESSION_SECRET = "a".repeat(64);
  const cookie = `portfolio_session=${createSession()}`;
  process.env.HISTORY_DB_PATH = f.path;
  const request = (day: string, hash = f.hash) =>
    GET(
      new Request(`http://localhost/api/history?date=${day}&revision=${hash}`, {
        headers: { cookie },
      }),
    );
  try {
    assert.equal(
      (await GET(new Request("http://localhost/api/history"))).status,
      401,
    );
    assert.equal(validHistoryDay("2021-02-29"), false);
    assert.equal(validHistoryDay("2020-02-29"), true);
    assert.equal((await request("2021-02-30")).status, 400);
    assert.equal((await request("2021-06-16")).status, 404);
    assert.equal((await request("2021-06-15", "0".repeat(64))).status, 409);
    const response = await request("2021-06-15");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).holdings.length, 2);
    process.env.HISTORY_DB_PATH = join(f.dir, "missing.sqlite");
    const missing = await request("2021-06-15");
    assert.equal(missing.status, 503);
    assert.ok(!(await missing.text()).includes(f.dir));
  } finally {
    if (oldPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = oldPassword;
    if (oldSecret === undefined) delete process.env.DASHBOARD_SESSION_SECRET;
    else process.env.DASHBOARD_SESSION_SECRET = oldSecret;
    if (previous === undefined) delete process.env.HISTORY_DB_PATH;
    else process.env.HISTORY_DB_PATH = previous;
    rmSync(f.dir, { recursive: true, force: true });
  }
});
