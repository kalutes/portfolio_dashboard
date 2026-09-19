import "server-only";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { loadPortfolio, Section } from "./portfolio";

export type SavedPortfolio = Awaited<ReturnType<typeof loadPortfolio>>;
export const dashboardSchema = `CREATE TABLE IF NOT EXISTS dashboard_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL) STRICT;`;

/** Preserve successful sections and their original timestamps when a later sync fails. */
export function mergeSavedPortfolio(
  next: SavedPortfolio,
  previous: SavedPortfolio | null,
): SavedPortfolio {
  function section<T>(current: Section<T>, prior?: Section<T>): Section<T> {
    return current.error && prior?.data !== null && prior?.data !== undefined
      ? {
          ...prior,
          error:
            "Latest background sync could not update this section. Showing the last saved data.",
        }
      : current;
  }
  const accounts = section(next.accounts, previous?.accounts);
  const details = (
    next.accounts.data ? next.details : (previous?.details ?? [])
  ).map((d) => {
    const prior = previous?.details.find((p) => p.account.id === d.account.id);
    if (!next.accounts.data)
      return {
        ...d,
        positions: {
          ...d.positions,
          error: "Latest account sync failed. Showing the last saved holdings.",
        },
      };
    const positions =
      d.account.syncing || d.account.holdingsUnavailable
        ? {
            ...d.positions,
            data: null,
            error:
              "Brokerage holdings unavailable during the last background sync.",
          }
        : d.positions;
    const balances = d.balances.data?.some((b) => b.amount === null)
      ? {
          ...d.balances,
          error: "Cash balance unavailable during the last background sync.",
        }
      : d.balances;
    return {
      ...d,
      balances: section(balances, prior?.balances),
      positions: section(positions, prior?.positions),
    };
  });
  return {
    ...next,
    accounts,
    details,
    connections: section(next.connections, previous?.connections),
  };
}

export function readSavedPortfolio(
  path = process.env.HISTORY_DB_PATH || resolve("data/portfolio.sqlite"),
): SavedPortfolio | null {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='dashboard_state'")
        .get()
    )
      return null;
    const row = db.prepare("SELECT body FROM dashboard_state WHERE id=1").get();
    return row ? (JSON.parse(String(row.body)) as SavedPortfolio) : null;
  } finally {
    db.close();
  }
}
