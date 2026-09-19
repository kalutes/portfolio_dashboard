import type {
  Account,
  Balance,
  AccountPosition,
  BrokerageAuthorization,
} from "snaptrade-typescript-sdk";

export type Money = { amount: number | null };
export function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function timestamp(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export function freshness(value: string | null, now = Date.now()) {
  if (!value || Date.parse(value) > now + 300_000) return "Freshness unknown";
  return now - Date.parse(value) > 24 * 60 * 60 * 1000
    ? "Stale · over 24 hours old"
    : "Synced within 24 hours";
}
export function normalizeAccount(a: Account) {
  return {
    id: a.id,
    connectionId: a.brokerage_authorization,
    name: a.name || "Unnamed account",
    institution: a.institution_name || "Unknown institution",
    suffix: a.number ? a.number.slice(-4) : null,
    type: a.raw_type || a.account_category || "Type unavailable",
    total: {
      amount: numeric(a.balance?.total?.amount),
    },
    holdingsAt: timestamp(a.sync_status?.holdings?.last_successful_sync),
    holdingsUnavailable: a.sync_status?.holdings?.holdings_unavailable === true,
    syncing: a.sync_status?.holdings?.initial_sync_completed === false,
  };
}
export function normalizeBalance(b: Balance): Money {
  return { amount: numeric(b.cash) };
}
export function normalizePosition(p: AccountPosition) {
  const units = numeric(p.units),
    price = numeric(p.price);
  const kind = p.instrument.kind;
  // Futures, bonds and CFDs have valuation conventions that units × price cannot represent safely.
  const multiplier =
    kind === "option"
      ? numeric(p.instrument.multiplier)
      : ["stock", "etf", "adr", "cef", "mutualfund", "crypto"].includes(kind)
        ? 1
        : null;
  const value =
    units !== null && price !== null && multiplier !== null
      ? numeric(units * price * multiplier)
      : null;
  return {
    symbol: p.instrument.symbol,
    costBasis: {
      amount:
        units !== null && numeric(p.cost_basis) !== null && multiplier !== null
          ? numeric(units * numeric(p.cost_basis)! * multiplier)
          : null,
    },
    acquiredDate:
      p.tax_lots?.length === 1
        ? (timestamp(p.tax_lots[0].original_purchase_date)?.slice(0, 10) ??
          null)
        : null,
    lots: (p.tax_lots ?? []).map((lot) => ({
      date: timestamp(lot.original_purchase_date)?.slice(0, 10) ?? null,
      quantity: numeric(lot.quantity),
      costBasis: {
        amount: numeric(lot.cost_basis),
      },
    })),
    cashEquivalent: p.cash_equivalent === true,
    description: p.instrument.description || kind,
    kind,
    units,
    price: { amount: price },
    value: { amount: value },
  };
}
export function normalizeConnection(c: BrokerageAuthorization) {
  return {
    id: c.id || "",
    name:
      c.brokerage?.display_name?.trim() ||
      c.brokerage?.name?.trim() ||
      c.name?.trim() ||
      "Brokerage connection",
    status:
      c.disabled === true
        ? "Reconnect in SnapTrade"
        : c.disabled === false
          ? "Connected"
          : "Status unknown",
  };
}
export function sumMoney(values: Money[]): Money {
  const valid = values.filter(
    (v) => v.amount !== null && Number.isFinite(v.amount),
  );
  if (!valid.length && values.some((v) => v.amount === null))
    return { amount: null };
  return {
    amount: valid.reduce((sum, v) => sum + (v.amount ?? 0), 0),
  };
}
