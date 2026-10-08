import test from "node:test";
import assert from "node:assert/strict";
import { accountExclusionReason } from "../lib/account-inclusion";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historySchema, protectHistory } from "../lib/history-schema";
import { dashboardSchema } from "../lib/dashboard-store";
import {
  readAccountExclusions,
  setAccountExclusion,
  setAccountExclusions,
  removeAccountExclusion,
} from "../lib/account-exclusion-store";

test("inclusion uses configured IDs only, even with renamed or identical account names", () => {
  const exclusions = [{ accountId: "summary", reason: "Duplicate summary" }];
  const account = {
    id: "summary",
    name: "Renamed plan",
    institution: "Example",
  };
  assert.equal(
    accountExclusionReason(account, exclusions),
    "Duplicate summary",
  );
  assert.equal(
    accountExclusionReason({ ...account, id: "independent" }, exclusions),
    null,
  );
  assert.equal(accountExclusionReason(account, []), null);
});

test("settings persist privately without changing historical data or saved observations", () => {
  const dir = mkdtempSync(join(tmpdir(), "account-settings-"));
  const path = join(dir, "portfolio.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(historySchema + dashboardSchema);
    db.exec(
      "INSERT INTO metadata VALUES ('schemaVersion','1'),('revision','test'),('historicalThrough','2026-08-31'); INSERT INTO portfolio_values VALUES ('2026-08-31','100','100',0,0,0,NULL);",
    );
    const saved = JSON.stringify({
      accounts: { data: [{ id: "summary", name: "Example Plan" }] },
    });
    db.prepare("INSERT INTO dashboard_state VALUES (1,?)").run(saved);
    db.exec(protectHistory);
    assert.deepEqual(readAccountExclusions(path), []);
    assert.equal(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='account_exclusions'")
        .get(),
      undefined,
    );
    setAccountExclusion(
      { accountId: "summary", reason: "Duplicate summary" },
      path,
    );
    assert.deepEqual(readAccountExclusions(path), [
      { accountId: "summary", reason: "Duplicate summary" },
    ]);
    setAccountExclusion(
      { accountId: "summary", reason: "Updated reason" },
      path,
    );
    assert.equal(readAccountExclusions(path)[0].reason, "Updated reason");
    assert.throws(
      () =>
        setAccountExclusions(
          [
            { accountId: "summary", reason: "Must roll back" },
            { accountId: "missing", reason: "Invalid account" },
          ],
          path,
        ),
      /not present/,
    );
    assert.equal(readAccountExclusions(path)[0].reason, "Updated reason");
    assert.throws(
      () =>
        setAccountExclusion({ accountId: "missing", reason: "Example" }, path),
      /not present/,
    );
    assert.throws(
      () => setAccountExclusion({ accountId: "summary", reason: " " }, path),
      /Invalid/,
    );
    assert.equal(readAccountExclusions(path).length, 1);
    assert.equal(
      db.prepare("SELECT body FROM dashboard_state").get()?.body,
      saved,
    );
    assert.equal(
      db.prepare("SELECT totalValue FROM portfolio_values").get()?.totalValue,
      "100",
    );
    assert.throws(() => db.exec("DELETE FROM portfolio_values"), /append-only/);
    removeAccountExclusion("summary", path);
    assert.deepEqual(readAccountExclusions(path), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unreadable or malformed settings fail instead of silently including accounts", () => {
  const dir = mkdtempSync(join(tmpdir(), "account-settings-error-"));
  const path = join(dir, "portfolio.sqlite");
  try {
    assert.throws(() => readAccountExclusions(path));
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE account_exclusions (accountId TEXT, reason TEXT); INSERT INTO account_exclusions VALUES ('summary','');",
    );
    db.close();
    assert.throws(() => readAccountExclusions(path), /Invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
