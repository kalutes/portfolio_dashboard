import "server-only";
import { withHistory } from "./historical-store";
import { numeric } from "./normalize";
import { validHistoryDay } from "./historical-types";
import type { HistoricalTrade, TradeHistory } from "./trade-types";

// Imported records plus verified brokerage activities; never inferred from holdings.
export const tradeSchema = `CREATE TABLE IF NOT EXISTS historical_trades (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, symbol TEXT NOT NULL, description TEXT NOT NULL,
  account TEXT NOT NULL, institution TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
  quantity TEXT NOT NULL, price TEXT, amount TEXT, dateBasis TEXT NOT NULL,
  source TEXT NOT NULL, notes TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS historical_trades_date ON historical_trades(date DESC,id);`;

export function loadHistoricalTrades(path?: string): TradeHistory {
  return withHistory((db) => {
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='historical_trades'",
        )
        .get()
    )
      return { available: false, importedAt: null, trades: [] };
    const importedAt = db
      .prepare("SELECT value FROM metadata WHERE key='tradeHistoryImportedAt'")
      .get()?.value;
    const trades = db
      .prepare("SELECT * FROM historical_trades ORDER BY date DESC,id")
      .all()
      .map((row) => {
        const quantity = numeric(row.quantity),
          price = numeric(row.price),
          amount = numeric(row.amount);
        const date = String(row.date);
        if (
          !validHistoryDay(date) ||
          (row.side !== "BUY" && row.side !== "SELL") ||
          quantity === null ||
          quantity <= 0 ||
          (row.price !== null && (price === null || price < 0)) ||
          (row.amount !== null && (amount === null || amount < 0)) ||
          !String(row.symbol).trim()
        )
          throw new Error("Invalid historical trade");
        return {
          id: String(row.id),
          date,
          symbol: String(row.symbol),
          description: String(row.description),
          account: String(row.account),
          institution: String(row.institution),
          side: row.side,
          quantity,
          price,
          amount,
          dateBasis: String(row.dateBasis),
          source: String(row.source),
          notes: String(row.notes),
        } as HistoricalTrade;
      });
    return {
      available: true,
      importedAt: typeof importedAt === "string" ? importedAt : null,
      trades,
      ...(db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='trade_sync_state'",
        )
        .get()
        ? {
            sync: {
              attemptedAt:
                (db
                  .prepare(
                    "SELECT MAX(attemptedAt) AS value FROM trade_sync_state",
                  )
                  .get()?.value as string | null) ?? null,
              pending: Number(
                db
                  .prepare(
                    "SELECT COUNT(*) AS n FROM trade_sync_records WHERE status='review'",
                  )
                  .get()?.n ?? 0,
              ),
              failed: Number(
                db
                  .prepare(
                    "SELECT COUNT(*) AS n FROM trade_sync_state WHERE failed=1",
                  )
                  .get()?.n ?? 0,
              ),
            },
          }
        : {}),
    };
  }, path);
}
