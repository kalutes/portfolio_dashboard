import "server-only";
import { mergeSavedPortfolio, readSavedPortfolio } from "../dashboard-store";
import { createSnaptrade } from "../snaptrade";
import { loadPortfolio } from "../portfolio";
import { loadManualPortfolio } from "../manual/portfolio";
import { withManualStore } from "../manual/store";
import { normalizeSnapshot } from "./normalize";
import { appendSnapshot, loadSnapshotSources } from "./store";

function manualRevision() {
  try {
    const { accounts, holdings } = withManualStore((s) => s.snapshot());
    return JSON.stringify({
      accounts,
      holdings: holdings.map(
        ({ quotePrice, quoteAsOf, quoteRetrievedAt, ...holding }) => {
          void quotePrice;
          void quoteAsOf;
          void quoteRetrievedAt;
          return holding;
        },
      ),
    });
  } catch {
    return null;
  }
}
export async function runDailySnapshot() {
  const client = createSnaptrade();
  if (!client) throw new Error("SnapTrade credentials are not configured.");
  const before = manualRevision();
  const [portfolio, manual] = await Promise.all([
    loadPortfolio(client),
    loadManualPortfolio(),
  ]);
  if (before !== manualRevision())
    throw new Error(
      "Manual holdings changed during retrieval; retry snapshot.",
    );
  const snapshot = normalizeSnapshot(
    portfolio,
    manual,
    new Date(),
    loadSnapshotSources(),
  );
  snapshot.dashboard = mergeSavedPortfolio(portfolio, readSavedPortfolio());
  return appendSnapshot(snapshot);
}
