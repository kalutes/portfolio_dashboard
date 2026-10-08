import "server-only";
import type { PersonalApiKeyAuth, Snaptrade } from "snaptrade-typescript-sdk";
import { fetchActivities } from "./activities";
import { recordActivities, recordSyncFailure } from "./store";

export async function syncTrades(
  client: Pick<Snaptrade<PersonalApiKeyAuth>, "accountInformation">,
  path?: string,
) {
  const observedAt = new Date().toISOString();
  let accounts;
  try {
    accounts = (await client.accountInformation.listUserAccounts()).data;
  } catch {
    recordSyncFailure("__account_list__", observedAt, path);
    return { failed: 1, added: 0, matched: 0, review: 0, unchanged: 0 };
  }
  // Accounts are independent; use a small concurrency limit to avoid bursts.
  const totals = { failed: 0, added: 0, matched: 0, review: 0, unchanged: 0 };
  const queue = [...accounts];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (let account = queue.shift(); account; account = queue.shift()) {
        if (!account.id) {
          totals.failed++;
          continue;
        }
        try {
          const activities = await fetchActivities(
            client.accountInformation,
            account.id,
          );
          const counts = recordActivities(
            account.id,
            activities,
            observedAt,
            path,
          );
          for (const key of [
            "added",
            "matched",
            "review",
            "unchanged",
          ] as const)
            totals[key] += counts[key];
        } catch {
          recordSyncFailure(account.id, observedAt, path);
          totals.failed++;
        }
      }
    }),
  );
  // A successful list clears a previous global list failure, without creating a fake account.
  const { withTradeWriter } = await import("./store");
  withTradeWriter(
    (db) =>
      db
        .prepare(
          "DELETE FROM trade_sync_state WHERE accountId='__account_list__'",
        )
        .run(),
    path,
  );
  return totals;
}
