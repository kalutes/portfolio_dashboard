import type { Money, normalizePosition } from "./normalize";

type Position = ReturnType<typeof normalizePosition>;
export type AllocationInput = {
  balances: Money[] | null;
  positions: Position[] | null;
};
export function allocationBySymbol(accounts: AllocationInput[]) {
  const symbols = new Map<string, { symbol: string; amount: number }>();
  let partial = false;
  function add(symbol: string, value: Money, cash = false) {
    if (
      value.amount === null ||
      !Number.isFinite(value.amount) ||
      !symbol.trim()
    ) {
      partial = true;
      return;
    }
    const key = cash ? "cash" : `symbol:${symbol}`;
    symbols.set(key, {
      symbol: cash ? "Cash" : symbol,
      amount: (symbols.get(key)?.amount ?? 0) + value.amount,
    });
  }
  for (const account of accounts) {
    if (!account.balances?.length || !account.positions) partial = true;
    let hasCash = false;
    for (const balance of account.balances ?? []) {
      add("Cash", balance, true);
      if (balance.amount !== null && Number.isFinite(balance.amount))
        hasCash = true;
    }
    for (const position of account.positions ?? []) {
      if (position.cashEquivalent) {
        // SnapTrade cash already includes cash equivalents. Only use their known
        // value as a partial fallback when this account has no cash balance.
        if (!hasCash) {
          partial = true;
          add("Cash", position.value, true);
        }
      } else add(position.symbol, position.value);
    }
  }
  const rows = [...symbols.values()]
    .filter((row) => row.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.symbol.localeCompare(b.symbol));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const chartable =
    Number.isFinite(total) && total > 0 && rows.every((row) => row.amount >= 0);
  return {
    partial,
    total,
    chartable,
    rows: rows.map((row) => ({
      ...row,
      percent: chartable ? (row.amount / total) * 100 : null,
    })),
  };
}
