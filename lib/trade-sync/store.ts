import "server-only";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tradeSchema } from "../trade-store";
import { validHistoryDay } from "../historical-types";
import type { Activity } from "./activities";

export const syncSchema = `
CREATE TABLE IF NOT EXISTS trade_account_links (
  accountId TEXT PRIMARY KEY, account TEXT NOT NULL, institution TEXT NOT NULL,
  coveredThrough TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS trade_sync_records (
  accountId TEXT NOT NULL, activityId TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('matched','added','review')),
  tradeId TEXT REFERENCES historical_trades(id), reason TEXT NOT NULL,
  observedAt TEXT NOT NULL, PRIMARY KEY(accountId,activityId)
) STRICT;
CREATE INDEX IF NOT EXISTS trade_sync_trade ON trade_sync_records(tradeId);
CREATE TABLE IF NOT EXISTS trade_sync_state (
  accountId TEXT PRIMARY KEY, attemptedAt TEXT NOT NULL, succeededAt TEXT, failed INTEGER NOT NULL
) STRICT;`;
export type Link = {
  accountId: string;
  account: string;
  institution: string;
  coveredThrough: string;
};
export function withTradeWriter<T>(
  run: (db: DatabaseSync) => T,
  path = process.env.HISTORY_DB_PATH || resolve("data/portfolio.sqlite"),
): T {
  if (!existsSync(path)) throw new Error("Historical database is missing");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE",
    );
    if (
      db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()
        ?.value !== "1"
    )
      throw new Error("Unsupported history schema");
    db.exec(tradeSchema + syncSchema);
    const result = run(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

// Only explicit, private database mappings establish which imported account to compare.
export function setTradeAccountLink(link: Link, path?: string) {
  if (
    !link.accountId ||
    !link.account ||
    !link.institution ||
    !validHistoryDay(link.coveredThrough)
  )
    throw new Error("Invalid trade account mapping");
  withTradeWriter((db) => {
    db.prepare(
      `INSERT INTO trade_account_links VALUES (?,?,?,?) ON CONFLICT(accountId) DO UPDATE SET
      account=excluded.account,institution=excluded.institution,coveredThrough=excluded.coveredThrough`,
    ).run(link.accountId, link.account, link.institution, link.coveredThrough);
  }, path);
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type TradeRow = {
  id: string;
  date: string;
  symbol: string;
  side: string;
  quantity: string;
  amount: string | null;
  price: string | null;
  source: string;
};
const symbolKey = (symbol: string) => symbol.replace(/\s/g, "").toUpperCase();
function nearDate(a: Activity, row: TradeRow) {
  return [a.date, a.settlement].some(
    (date) =>
      date && Math.abs(Date.parse(date) - Date.parse(row.date)) <= 4 * 86400000,
  );
}
function sameEconomics(a: Activity, row: TradeRow) {
  if (
    a.quantity === null ||
    Math.abs(Number(row.quantity) - a.quantity) > 0.000001
  )
    return false;
  if (a.amount !== null && row.amount !== null) {
    const difference = Math.abs(Number(row.amount) - a.amount);
    // Exact amounts identify distinct fills whose prices differ by only a cent.
    if (difference < 0.000001) return true;
    return (
      difference <= 0.02 &&
      (a.price === null ||
        row.price === null ||
        Math.abs(Number(row.price) - a.price) <= 0.0001)
    );
  }
  return (
    a.price !== null &&
    row.price !== null &&
    Math.abs(Number(row.price) - a.price) <= 0.0001
  );
}

export function recordActivities(
  accountId: string,
  activities: Activity[],
  observedAt: string,
  path?: string,
) {
  return withTradeWriter((db) => {
    const link = db
      .prepare("SELECT * FROM trade_account_links WHERE accountId=?")
      .get(accountId) as Link | undefined;
    const rows = link
      ? (db
          .prepare(
            "SELECT * FROM historical_trades WHERE account=? AND institution=?",
          )
          .all(link.account, link.institution) as TradeRow[])
      : [];
    const counts = { added: 0, matched: 0, review: 0, unchanged: 0 };
    for (const a of activities) {
      const body = JSON.stringify(a),
        activityId = a.id || `missing:${hash(body)}`;
      const prior = db
        .prepare(
          "SELECT * FROM trade_sync_records WHERE accountId=? AND activityId=?",
        )
        .get(accountId, activityId);
      if (prior && prior.body === body && prior.status !== "review") {
        counts.unchanged++;
        continue;
      }
      let status: "matched" | "added" | "review" = "review",
        tradeId = (prior?.tradeId as string | null) ?? null;
      let reason = a.issue || (!link ? "Account mapping required" : "");
      if (prior?.tradeId && (prior.body !== body || prior.status === "review"))
        reason = "Previously linked activity changed; existing trade retained";
      if (!reason && link) {
        const nearby = rows.filter(
          (r) =>
            r.side === a.side &&
            symbolKey(r.symbol) === symbolKey(a.symbol) &&
            nearDate(a, r),
        );
        const exact = nearby.filter((r) => sameEconomics(a, r));
        const competitors = activities.filter(
          (other) =>
            other !== a &&
            exact.some(
              (r) =>
                other.side === r.side &&
                symbolKey(other.symbol) === symbolKey(r.symbol) &&
                nearDate(other, r) &&
                sameEconomics(other, r),
            ),
        );
        const claimed = exact.some((r) =>
          db
            .prepare(
              "SELECT 1 FROM trade_sync_records WHERE tradeId=? AND NOT (accountId=? AND activityId=?)",
            )
            .get(r.id, accountId, activityId),
        );
        if (exact.length === 1 && !competitors.length && !claimed) {
          status = "matched";
          tradeId = exact[0].id;
          reason =
            "Matched account, symbol, side, quantity, economics and nearby trade/settlement date";
        } else if (
          nearby.some(
            (r) =>
              r.source !== "SnapTrade activity" ||
              Math.abs(Number(r.quantity) - a.quantity!) <= 0.000001,
          )
        )
          reason =
            "Potential duplicate, split adjustment, correction or ambiguous fills";
        else if (a.date! <= link.coveredThrough)
          reason = "Unmatched activity inside imported coverage";
        else {
          status = "added";
          tradeId = `snaptrade:${hash(`${accountId}:${activityId}`)}`;
          db.prepare(
            "INSERT INTO historical_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            tradeId,
            a.date,
            a.symbol,
            a.symbol,
            link.account,
            link.institution,
            a.side,
            String(a.quantity),
            a.price === null ? null : String(a.price),
            a.amount === null ? null : String(a.amount),
            "Reported trade or settlement date",
            "SnapTrade activity",
            [
              ["REI", "DIVIDENDREINVEST"].includes(a.type)
                ? "Dividend reinvestment"
                : "",
              a.optionAction,
              "Reported USD amount; may include fees. Not realized profit.",
            ]
              .filter(Boolean)
              .join(". "),
          );
          // Keep newly inserted trades visible to duplicate/correction checks in this batch.
          rows.push({
            id: tradeId,
            date: a.date!,
            symbol: a.symbol,
            side: a.side!,
            quantity: String(a.quantity),
            price: a.price === null ? null : String(a.price),
            amount: a.amount === null ? null : String(a.amount),
            source: "SnapTrade activity",
          });
          reason = "New activity after imported coverage";
        }
      }
      db.prepare(
        `INSERT INTO trade_sync_records VALUES (?,?,?,?,?,?,?) ON CONFLICT(accountId,activityId) DO UPDATE SET
        body=excluded.body,status=excluded.status,tradeId=excluded.tradeId,reason=excluded.reason,observedAt=excluded.observedAt`,
      ).run(accountId, activityId, body, status, tradeId, reason, observedAt);
      counts[status]++;
    }
    db.prepare(
      `INSERT INTO trade_sync_state VALUES (?,?,?,0) ON CONFLICT(accountId) DO UPDATE SET
      attemptedAt=excluded.attemptedAt,succeededAt=excluded.succeededAt,failed=0`,
    ).run(accountId, observedAt, observedAt);
    return counts;
  }, path);
}
export function recordSyncFailure(
  accountId: string,
  observedAt: string,
  path?: string,
) {
  withTradeWriter(
    (db) =>
      db
        .prepare(
          `INSERT INTO trade_sync_state VALUES (?,?,NULL,1)
    ON CONFLICT(accountId) DO UPDATE SET attemptedAt=excluded.attemptedAt,failed=1`,
        )
        .run(accountId, observedAt),
    path,
  );
}
