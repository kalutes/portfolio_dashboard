import "server-only";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { HistoricalDetail, HistoricalSeries } from "./historical-types";

function numeric(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Invalid value");
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Invalid value");
  return n;
}
function optional(value: unknown): number | null {
  return value === null ? null : numeric(value);
}
export class HistoryRevisionChanged extends Error {}
export function withHistory<T>(
  run: (db: DatabaseSync, revision: string) => T,
  databasePath = process.env.HISTORY_DB_PATH ||
    resolve("data/portfolio.sqlite"),
): T {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN;");
    const version = db
      .prepare("SELECT value FROM metadata WHERE key='schemaVersion'")
      .get();
    const row = db
      .prepare("SELECT value FROM metadata WHERE key='revision'")
      .get();
    if (
      version?.value !== "1" ||
      typeof row?.value !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.value)
    )
      throw new Error("Invalid history database");
    const result = run(db, row.value);
    db.exec("COMMIT;");
    return result;
  } finally {
    db.close();
  }
}
export function loadHistoricalSeries(databasePath?: string): HistoricalSeries {
  return withHistory(
    (db, revision) => ({
      revision,
      retrievedAt: new Date().toISOString(),
      points: db
        .prepare(
          "SELECT date,totalValue,knownValue,unpricedHoldings,estimatedHoldings,stale FROM portfolio_values ORDER BY date",
        )
        .all()
        .map((r) => ({
          day: String(r.date),
          total: optional(r.totalValue),
          known: numeric(r.knownValue),
          missing: numeric(r.unpricedHoldings),
          estimated: numeric(r.estimatedHoldings),
          stale: r.stale === 1,
        })),
    }),
    databasePath,
  );
}
export function loadHistoricalDetail(
  day: string,
  revision: string,
  databasePath?: string,
): HistoricalDetail | null {
  return withHistory((db, current) => {
    if (revision !== current) throw new HistoryRevisionChanged();
    if (!db.prepare("SELECT date FROM portfolio_values WHERE date=?").get(day))
      return null;
    return {
      day,
      holdings: db
        .prepare(
          "SELECT symbol,quantity,value,method,previousAnchor,nextAnchor FROM portfolio_holdings WHERE date=? ORDER BY CAST(value AS REAL) DESC,symbol",
        )
        .all(day)
        .map((r) => ({
          symbol: String(r.symbol),
          quantity: optional(r.quantity),
          value: optional(r.value),
          method: String(r.method),
          previous: r.previousAnchor === null ? null : String(r.previousAnchor),
          next: r.nextAnchor === null ? null : String(r.nextAnchor),
        })),
    };
  }, databasePath);
}
