import { createHash } from "node:crypto";
import type { SavedPortfolio } from "../dashboard-store";
import type { loadPortfolio } from "../portfolio";
import type { ManualDetail } from "../manual/portfolio";

export type SnapshotHolding = {
  key: string;
  symbol: string;
  quantity: number | null;
  value: number | null;
  stale: boolean;
  asOf?: string | null;
};
export type SnapshotSource = {
  source: string;
  section: "cash" | "positions";
  observedAt: string;
  holdings: SnapshotHolding[];
};
export type DailySnapshot = {
  date: string;
  retrievedAt: string;
  holdings: SnapshotHolding[];
  stale: boolean;
  sources?: SnapshotSource[];
  dashboard?: SavedPortfolio;
};
const staleAt = (value: string | null | undefined, now: number) =>
  !value ||
  !Number.isFinite(Date.parse(value)) ||
  Date.parse(value) > now + 300000 ||
  now - Date.parse(value) > 86400000;
const valid = (n: number | null) =>
  n !== null && Number.isFinite(n) ? n : null;

/** Only normalized current-source state is retained; no transaction/account reconciliation. */
export function normalizeSnapshot(
  portfolio: Awaited<ReturnType<typeof loadPortfolio>>,
  manual: { details: ManualDetail[]; error: string | null },
  now = new Date(),
  previous: SnapshotSource[] = [],
): DailySnapshot {
  const sources: SnapshotSource[] = [];
  const rows: SnapshotHolding[] = [];
  const observedAt = now.toISOString();
  const old = new Map(previous.map((s) => [`${s.source}:${s.section}`, s]));
  function unknown(key: string, symbol: string) {
    rows.push({
      key,
      symbol,
      quantity: null,
      value: null,
      stale: true,
      asOf: null,
    });
  }
  function carry(source: string, section: "cash" | "positions") {
    const prior = old.get(`${source}:${section}`);
    if (prior) {
      sources.push(prior);
      rows.push(...prior.holdings.map((h) => ({ ...h, stale: true })));
    } else
      unknown(
        `unreported:${source}:${section}`,
        section === "cash" ? "Unreported cash" : "Unreported holdings",
      );
  }
  function unavailableScope(scope: string) {
    const prior = previous.filter((s) => s.source.startsWith(scope + ":"));
    if (!prior.length)
      unknown("unreported:" + scope, "Unreported " + scope + " holdings");
    for (const s of prior) carry(s.source, s.section);
  }
  function current(
    source: string,
    section: "cash" | "positions",
    holdings: SnapshotHolding[],
  ) {
    const prior = old.get(`${source}:${section}`);
    // A missing price may use the last known per-unit value, with current units and a stale label.
    const resolved = holdings.map((h) => {
      const before = prior?.holdings.find((p) => p.key === h.key);
      if (
        h.value === null &&
        h.quantity !== null &&
        before?.value !== null &&
        before?.value !== undefined &&
        before.quantity
      ) {
        return {
          ...h,
          value: valid((h.quantity * before.value) / before.quantity),
          stale: true,
          asOf: before.asOf ?? prior!.observedAt,
        };
      }
      return h;
    });
    sources.push({ source, section, observedAt, holdings: resolved });
    rows.push(...resolved);
  }
  function account(
    detail:
      | Awaited<ReturnType<typeof loadPortfolio>>["details"][number]
      | ManualDetail,
    scope: string,
  ) {
    const { account, balances, positions } = detail;
    const source =
      scope + ":" + createHash("sha256").update(account.id).digest("hex");
    const asOf = positions.data?.asOf ?? account.holdingsAt;
    const stale =
      staleAt(asOf, now.getTime()) ||
      ("notes" in detail && detail.notes.length > 0) ||
      (scope === "snaptrade" &&
        (!!portfolio.connections.error ||
          portfolio.connections.data?.some(
            (c) => c.id === account.connectionId && c.status !== "Connected",
          ) === true));
    if (
      balances.error ||
      !balances.data?.length ||
      balances.data.some((b) => valid(b.amount) === null)
    )
      carry(source, "cash");
    else {
      const cash = balances.data.reduce((sum, b) => sum + b.amount!, 0);
      current(source, "cash", [
        {
          key: "cash:USD",
          symbol: "CASH",
          quantity: valid(cash),
          value: valid(cash),
          stale,
          asOf,
        },
      ]);
    }
    if (
      account.syncing ||
      account.holdingsUnavailable ||
      positions.error ||
      !positions.data
    )
      carry(source, "positions");
    else
      current(
        source,
        "positions",
        positions.data.rows
          .filter((p) => !p.cashEquivalent)
          .map((p) => ({
            key: `${p.kind === "option" ? "option" : "symbol"}:${p.symbol}`,
            symbol: p.symbol || "Unreported symbol",
            quantity: valid(p.units),
            value: valid(p.value.amount),
            stale,
            asOf,
          })),
      );
  }
  if (
    portfolio.accounts.error ||
    !portfolio.accounts.data ||
    portfolio.accounts.data.length !== portfolio.details.length
  )
    unavailableScope("snaptrade");
  else for (const detail of portfolio.details) account(detail, "snaptrade");
  if (manual.error) unavailableScope("manual");
  else for (const detail of manual.details) account(detail, "manual");
  const combined = new Map<string, SnapshotHolding>();
  for (const original of rows) {
    const h =
      original.value === null
        ? {
            ...original,
            key:
              (original.key.startsWith("unreported:")
                ? "unreported:" + original.symbol
                : original.key) + ":unpriced",
            symbol: original.symbol + " (unpriced)",
          }
        : original;
    const before = combined.get(h.key);
    combined.set(
      h.key,
      before
        ? {
            ...h,
            quantity:
              before.quantity === null || h.quantity === null
                ? null
                : valid(before.quantity + h.quantity),
            value:
              before.value === null || h.value === null
                ? null
                : valid(before.value + h.value),
            stale: before.stale || h.stale,
            asOf:
              before.asOf && h.asOf ? [before.asOf, h.asOf].sort()[0] : null,
          }
        : h,
    );
  }
  const holdings = [...combined.values()].filter(
    (h) => h.quantity !== 0 || h.value !== 0,
  );
  return {
    date: observedAt.slice(0, 10),
    retrievedAt: observedAt,
    holdings,
    stale: holdings.some((h) => h.stale),
    sources,
  };
}
