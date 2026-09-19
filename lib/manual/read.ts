import "server-only";
import { withManualStore } from "./store";
import { manualAccountDetail, type ManualDetail } from "./portfolio";

/** Read saved manual valuations only. Quote fetching belongs to the background worker. */
export function readManualPortfolio() {
  try {
    const snapshot = withManualStore((store) => store.snapshot());
    return {
      details: snapshot.accounts.map((account) => {
        const detail = manualAccountDetail(
          account,
          snapshot.holdings.filter((h) => h.accountId === account.id),
          new Set(),
        );
        detail.balances.retrievedAt = detail.account.holdingsAt || "";
        detail.positions.retrievedAt = detail.account.holdingsAt || "";
        return detail;
      }),
      error: null,
    };
  } catch {
    return {
      details: [] as ManualDetail[],
      error:
        "Saved manual holdings are unavailable. Check the database path and permissions.",
    };
  }
}
