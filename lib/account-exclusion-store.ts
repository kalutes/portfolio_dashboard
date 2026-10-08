import "server-only";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AccountExclusion } from "./account-inclusion";

export const accountExclusionSchema = `CREATE TABLE IF NOT EXISTS account_exclusions (
  accountId TEXT PRIMARY KEY CHECK(length(trim(accountId)) > 0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0)
) STRICT;`;

const defaultPath = () =>
  process.env.HISTORY_DB_PATH || resolve("data/portfolio.sqlite");

function validate(entry: AccountExclusion) {
  if (
    typeof entry.accountId !== "string" ||
    !entry.accountId.trim() ||
    entry.accountId !== entry.accountId.trim() ||
    typeof entry.reason !== "string" ||
    !entry.reason.trim() ||
    entry.reason.length > 1000
  )
    throw new Error("Invalid account exclusion.");
}

/** Legacy databases without settings include all accounts. Other read errors propagate. */
export function readAccountExclusions(
  path = defaultPath(),
): AccountExclusion[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_exclusions'",
        )
        .get()
    )
      return [];
    return db
      .prepare(
        "SELECT accountId,reason FROM account_exclusions ORDER BY accountId",
      )
      .all()
      .map((row) => {
        const entry = {
          accountId: String(row.accountId),
          reason: String(row.reason),
        };
        validate(entry);
        return entry;
      });
  } finally {
    db.close();
  }
}

/** Administrative setting only: does not edit observations, holdings or source data. */
export function setAccountExclusion(
  entry: AccountExclusion,
  path = defaultPath(),
) {
  setAccountExclusions([entry], path);
}

/** Import settings atomically without replacing observations or unrelated exclusions. */
export function setAccountExclusions(
  entries: readonly AccountExclusion[],
  path = defaultPath(),
) {
  entries.forEach(validate);
  edit(path, (db) => {
    const row = db.prepare("SELECT body FROM dashboard_state WHERE id=1").get();
    const saved = row ? JSON.parse(String(row.body)) : null;
    const insert = db.prepare(
      "INSERT INTO account_exclusions (accountId,reason) VALUES (?,?) ON CONFLICT(accountId) DO UPDATE SET reason=excluded.reason",
    );
    for (const entry of entries) {
      if (
        !saved?.accounts?.data?.some(
          (account: { id: string }) => account.id === entry.accountId,
        )
      )
        throw new Error("Account not present in the saved brokerage accounts.");
      insert.run(entry.accountId, entry.reason.trim());
    }
  });
}

export function removeAccountExclusion(
  accountId: string,
  path = defaultPath(),
) {
  validate({ accountId, reason: "validation" });
  edit(path, (db) => {
    db.prepare("DELETE FROM account_exclusions WHERE accountId=?").run(
      accountId,
    );
  });
}

function edit(path: string, run: (db: DatabaseSync) => void) {
  if (!existsSync(path)) throw new Error("Portfolio database is missing.");
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;");
    if (
      db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()
        ?.value !== "1"
    )
      throw new Error("Unsupported portfolio database.");
    db.exec(accountExclusionSchema);
    run(db);
    db.exec("COMMIT;");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }
}
