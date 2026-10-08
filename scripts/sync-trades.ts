import { createSnaptrade } from "../lib/snaptrade";
import { syncTrades } from "../lib/trade-sync/run";
import { readFileSync, writeFileSync } from "node:fs";
import {
  setTradeAccountLink,
  withTradeWriter,
  recordActivities,
  type Link,
} from "../lib/trade-sync/store";
import type { Activity } from "../lib/trade-sync/activities";

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--link-stdin" && args.length === 1) {
      const links: Link[] = JSON.parse(readFileSync(0, "utf8"));
      if (!Array.isArray(links)) throw new Error("Expected array of mappings");
      for (const link of links) setTradeAccountLink(link);
      console.log("Private account mappings saved.");
      return;
    }
    if (args[0] === "--report" && args.length === 2) {
      const report = withTradeWriter((db) => ({
        states: db.prepare("SELECT * FROM trade_sync_state").all(),
        links: db.prepare("SELECT * FROM trade_account_links").all(),
        counts: db
          .prepare(
            "SELECT status,COUNT(*) count FROM trade_sync_records GROUP BY status",
          )
          .all(),
        records: db
          .prepare(
            "SELECT * FROM trade_sync_records ORDER BY accountId,activityId",
          )
          .all()
          .map((row) => ({ ...row, body: JSON.parse(String(row.body)) })),
      }));
      writeFileSync(args[1], JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      console.log("Private trade audit written.");
      return;
    }
    if (args[0] === "--replay" && args.length === 1) {
      const batches = withTradeWriter((db) =>
        db
          .prepare(
            "SELECT accountId,attemptedAt FROM trade_sync_state WHERE failed=0",
          )
          .all()
          .map((state) => ({
            accountId: String(state.accountId),
            observedAt: String(state.attemptedAt),
            activities: db
              .prepare(
                "SELECT body FROM trade_sync_records WHERE accountId=? ORDER BY activityId",
              )
              .all(state.accountId)
              .map((row) => JSON.parse(String(row.body)) as Activity),
          })),
      );
      for (const batch of batches)
        recordActivities(batch.accountId, batch.activities, batch.observedAt);
      console.log("Saved normalized activities replayed without API requests.");
      return;
    }
    if (args.length) throw new Error("Invalid arguments");
    const client = createSnaptrade();
    if (!client) throw new Error("Missing credentials");
    const result = await syncTrades(client);
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } catch {
    console.error(
      "Trade command failed. Check arguments, credentials, connection status and database permissions. Report output files must not already exist.",
    );
    process.exitCode = 1;
  }
}
void main();
