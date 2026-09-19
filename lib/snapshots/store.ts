import "server-only";
import { dashboardSchema } from "../dashboard-store";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { DailySnapshot, SnapshotSource } from "./normalize";
import { validHistoryDay } from "../historical-types";

export function appendSnapshot(
  snapshot: DailySnapshot,
  path = process.env.HISTORY_DB_PATH || resolve("data/portfolio.sqlite"),
) {
  if (!existsSync(path))
    throw new Error("Historical seed database is missing.");
  if (
    !validHistoryDay(snapshot.date) ||
    snapshot.retrievedAt.slice(0, 10) !== snapshot.date ||
    !Number.isFinite(Date.parse(snapshot.retrievedAt))
  )
    throw new Error("Invalid snapshot date");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;",
    );
    if (
      db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()
        ?.value !== "1"
    )
      throw new Error("Unsupported history schema");
    const through = db
      .prepare("SELECT value FROM metadata WHERE key='historicalThrough'")
      .get()?.value;
    if (typeof through !== "string" || snapshot.date <= through)
      throw new Error("Historical seed is frozen");
    if (snapshot.dashboard) {
      db.exec(dashboardSchema);
      db.prepare(
        "INSERT INTO dashboard_state (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      ).run(JSON.stringify(snapshot.dashboard));
    }
    if (
      db
        .prepare("SELECT 1 FROM portfolio_values WHERE date=?")
        .get(snapshot.date)
    ) {
      db.exec("COMMIT;");
      return false;
    }
    // Round each displayed holding once, then sum exact integer cents.
    const rows = snapshot.holdings.map((h) => {
      if (
        !h.key ||
        !h.symbol.trim() ||
        (h.quantity !== null && !Number.isFinite(h.quantity)) ||
        (h.value !== null && !Number.isFinite(h.value)) ||
        (h.value !== null && Math.abs(h.value) > 1e13)
      )
        throw new Error("Invalid snapshot holding");
      return {
        ...h,
        cents: h.value === null ? null : BigInt(Math.round(h.value * 100)),
      };
    });
    const money = (cents: bigint) =>
      `${cents < BigInt(0) ? "-" : ""}${(cents < BigInt(0) ? -cents : cents) / BigInt(100)}.${((cents < BigInt(0) ? -cents : cents) % BigInt(100)).toString().padStart(2, "0")}`;
    const total = money(
      rows.reduce((sum, r) => sum + (r.cents ?? BigInt(0)), BigInt(0)),
    );
    db.prepare("INSERT INTO portfolio_values VALUES (?,?,?,?,?,?,?)").run(
      snapshot.date,
      rows.some((r) => r.cents === null) ? null : total,
      total,
      rows.filter((r) => r.cents === null).length,
      rows.filter((r) => r.stale).length,
      Number(snapshot.stale || rows.some((r) => r.stale)),
      snapshot.retrievedAt,
    );
    const insert = db.prepare(
      "INSERT INTO portfolio_holdings VALUES (?,?,?,?,?,?,?,?)",
    );
    for (const r of rows)
      insert.run(
        snapshot.date,
        r.key,
        r.symbol,
        r.quantity === null ? null : String(r.quantity),
        r.cents === null ? null : money(r.cents),
        r.stale ? "daily_snapshot_stale_estimate" : "daily_snapshot",
        r.asOf?.slice(0, 10) ?? null,
        null,
      );
    db.exec(sourceSchema);
    if (snapshot.sources) {
      db.exec("DELETE FROM latest_sources");
      const save = db.prepare("INSERT INTO latest_sources VALUES (?,?,?,?)");
      for (const source of snapshot.sources)
        save.run(
          source.source,
          source.section,
          source.observedAt,
          JSON.stringify(source.holdings),
        );
    }
    db.prepare("UPDATE metadata SET value=? WHERE key='revision'").run(
      randomBytes(32).toString("hex"),
    );
    db.exec("COMMIT;");
    return true;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }
}

export const sourceSchema = `CREATE TABLE IF NOT EXISTS latest_sources (source TEXT NOT NULL,section TEXT NOT NULL,observedAt TEXT NOT NULL,holdings TEXT NOT NULL,PRIMARY KEY(source,section)) STRICT;`;
export function loadSnapshotSources(
  path = process.env.HISTORY_DB_PATH || resolve("data/portfolio.sqlite"),
): SnapshotSource[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='latest_sources'")
        .get()
    )
      return [];
    return db
      .prepare("SELECT * FROM latest_sources ORDER BY source,section")
      .all()
      .map((r) => ({
        source: String(r.source),
        section: r.section as SnapshotSource["section"],
        observedAt: String(r.observedAt),
        holdings: JSON.parse(String(r.holdings)),
      }));
  } finally {
    db.close();
  }
}
