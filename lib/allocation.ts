import type { Money, normalizePosition } from "./normalize";

import { unrealizedPerformance } from "./performance";

type Position = ReturnType<typeof normalizePosition>;
export type AllocationInput = {
  balances: Money[] | null;
  positions: Position[] | null;
};
export function allocationBySymbol(accounts: AllocationInput[]) {
  const symbols = new Map<
    string,
    {
      symbol: string;
      amount: number;
      costBasis: number | null;
      isCash: boolean;
    }
  >();
  let partial = false;
  function add(
    symbol: string,
    value: Money,
    cash = false,
    basis: number | null = null,
  ) {
    if (!symbol.trim()) {
      partial = true;
      return;
    }
    const key = cash ? "cash" : `symbol:${symbol}`;
    const previous = symbols.get(key);
    const validValue = value.amount !== null && Number.isFinite(value.amount);
    const validBasis = basis !== null && Number.isFinite(basis) && basis >= 0;
    if (!validValue) partial = true;
    symbols.set(key, {
      symbol: cash ? "Cash" : symbol,
      amount: (previous?.amount ?? 0) + (validValue ? value.amount! : 0),
      costBasis:
        !cash &&
        validValue &&
        validBasis &&
        (!previous || previous.costBasis !== null)
          ? (previous?.costBasis ?? 0) + basis!
          : null,
      isCash: cash,
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
      } else
        add(position.symbol, position.value, false, position.costBasis.amount);
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
      ...unrealizedPerformance(row.amount, row.costBasis),
      percent: chartable ? (row.amount / total) * 100 : null,
    })),
  };
}

export type AllocationRow = ReturnType<
  typeof allocationBySymbol
>["rows"][number];
export function allocationSegments(
  row: AllocationRow,
): { kind: "basis" | "gain" | "value" | "cash"; amount: number }[] {
  if (row.isCash) return [{ kind: "cash", amount: row.amount }];
  if (row.costBasis === null || row.gain === null)
    return [{ kind: "value", amount: row.amount }];
  // A loss is not part of current value. Preserve slice size and show the loss in details.
  if (row.gain <= 0) return [{ kind: "basis", amount: row.amount }];
  const parts: { kind: "basis" | "gain"; amount: number }[] = [
    { kind: "basis", amount: row.costBasis },
    { kind: "gain", amount: row.gain },
  ];
  return parts.filter((part) => part.amount > 0);
}
