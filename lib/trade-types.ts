export type HistoricalTrade = {
  id: string;
  date: string;
  symbol: string;
  description: string;
  account: string;
  institution: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number | null;
  amount: number | null;
  dateBasis: string;
  source: string;
  notes: string;
};
export type TradeHistory = {
  available: boolean;
  importedAt: string | null;
  trades: HistoricalTrade[];
  sync?: { attemptedAt: string | null; pending: number; failed: number };
};

export function filterTrades(
  trades: HistoricalTrade[],
  query: string,
  side: string,
  account: string,
) {
  const text = query.trim().toLocaleLowerCase("en-US");
  return trades.filter(
    (t) =>
      (!side || t.side === side) &&
      (!account || `${t.institution} · ${t.account}` === account) &&
      (!text ||
        [t.symbol, t.description, t.account, t.institution, t.date].some(
          (value) => value.toLocaleLowerCase("en-US").includes(text),
        )),
  );
}
