import "server-only";
import type { loadPortfolio, Section } from "../portfolio";
import type { ManualAccount, ManualHolding, ManualSnapshot } from "./types";
import { withManualStore } from "./store";
import { getYahooQuote, type Quote } from "./quotes";

type Detail = Awaited<ReturnType<typeof loadPortfolio>>["details"][number];
export type ManualDetail = Detail & { manual: true; notes: string[] };
function section<T>(data: T, retrievedAt: string): Section<T> {
  return { data, retrievedAt, error: null };
}
export function manualAccountDetail(
  account: ManualAccount,
  holdings: ManualHolding[],
  errors: Set<string>,
  now = new Date(),
): ManualDetail {
  const notes: string[] = [];
  const valuations = holdings.map((holding) => {
    const hasQuote = holding.quotePrice !== null && !!holding.quoteAsOf;
    const quoteValue = hasQuote ? holding.quotePrice! * holding.quantity : null;
    // A more recent explicit manual valuation wins over an older quote.
    const useQuote =
      quoteValue !== null &&
      Number.isFinite(quoteValue) &&
      (!holding.manualAsOf ||
        Date.parse(holding.quoteAsOf!) >= Date.parse(holding.manualAsOf));
    const amount = useQuote ? quoteValue : holding.manualValue;
    const asOf = useQuote ? holding.quoteAsOf : holding.manualAsOf;
    if (errors.has(holding.id))
      notes.push(
        `${holding.symbol}: Yahoo quote unavailable; ${amount === null ? "value unavailable" : "showing last-known value"}.`,
      );
    if (!asOf || now.getTime() - Date.parse(asOf) > 86400000)
      notes.push(
        `${holding.symbol}: ${asOf ? "valuation is over 24 hours old" : "valuation date unavailable"}.`,
      );
    return { holding, amount, asOf, useQuote };
  });
  const total = valuations.every((v) => v.amount !== null)
    ? valuations.reduce((n, v) => n + v.amount!, 0)
    : null;
  const cashRows = valuations.filter((v) => v.holding.cashEquivalent);
  const cash = cashRows.every((v) => v.amount !== null)
    ? cashRows.reduce((n, v) => n + v.amount!, 0)
    : null;
  const dated = valuations
    .map((v) => v.asOf)
    .filter((v): v is string => !!v)
    .sort();
  const asOf = dated.length === valuations.length ? (dated[0] ?? null) : null;
  const retrievedAt = now.toISOString();
  if (total === null)
    notes.push(
      "Account total unavailable because one or more holdings have no valuation.",
    );
  const money = (amount: number | null) => ({ amount });
  return {
    manual: true,
    notes,
    account: {
      id: `manual:${account.id}`,
      connectionId: "",
      name: account.name,
      institution: account.institution,
      suffix: null,
      type: "Manual account",
      total: money(total),
      holdingsAt: asOf,
      holdingsUnavailable: false,
      syncing: false,
    },
    balances: section([money(cash)], retrievedAt),
    positions: section(
      {
        asOf,
        rows: valuations.map((v) => ({
          symbol: v.holding.symbol,
          costBasis: money(v.holding.costBasis),
          acquiredDate: v.holding.acquiredDate,
          lots: [],
          cashEquivalent: v.holding.cashEquivalent,
          description: `${v.holding.description || v.holding.symbol} · ${v.useQuote ? "Yahoo" : "Manual"} · ${v.asOf?.slice(0, 10) ?? "Undated"}`,
          kind: "other",
          units: v.holding.quantity,
          price: money(v.useQuote ? v.holding.quotePrice : null),
          value: money(v.amount),
        })),
      },
      retrievedAt,
    ),
  };
}
export async function refreshManualQuotes(
  snapshot: ManualSnapshot,
  getQuote: (symbol: string) => Promise<Quote> = getYahooQuote,
  saveQuote: (holding: ManualHolding, quote: Quote) => void = (h, q) =>
    withManualStore((s) => s.saveQuote(h, q)),
  now = new Date(),
) {
  const holdings = snapshot.holdings.map((h) => ({ ...h }));
  const errors = new Set<string>();
  const due = holdings.filter(
    (h) =>
      h.quoteSymbol &&
      (!h.quoteRetrievedAt ||
        now.getTime() - Date.parse(h.quoteRetrievedAt) >= 300000),
  );
  const symbols = [...new Set(due.map((h) => h.quoteSymbol))];
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      let quote: Quote | null = null;
      try {
        quote = await getQuote(symbol);
      } catch {
        /* Retain only explicitly labeled known values. */
      }
      for (const holding of due.filter((h) => h.quoteSymbol === symbol)) {
        if (!quote) {
          errors.add(holding.id);
          continue;
        }
        try {
          saveQuote(holding, quote);
        } catch {
          errors.add(holding.id);
        }
        Object.assign(holding, {
          quotePrice: quote.price,
          quoteAsOf: quote.asOf,
          quoteRetrievedAt: quote.retrievedAt,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, symbols.length) }, worker),
  );
  return { holdings, errors };
}
export async function loadManualPortfolio() {
  try {
    const snapshot = withManualStore((store) => store.snapshot());
    const { holdings, errors } = await refreshManualQuotes(snapshot);
    return {
      details: snapshot.accounts.map((a) =>
        manualAccountDetail(
          a,
          holdings.filter((h) => h.accountId === a.id),
          errors,
        ),
      ),
      error: null,
    };
  } catch {
    return {
      details: [] as ManualDetail[],
      error:
        "Manual holdings could not be loaded. Check the database path and directory permissions.",
    };
  }
}
