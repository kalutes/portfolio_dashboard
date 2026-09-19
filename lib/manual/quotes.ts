import "server-only";

export type Quote = {
  price: number;
  asOf: string;
  retrievedAt: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid quote response");
  return value as Record<string, unknown>;
}
export function parseYahooQuote(
  value: unknown,
  expectedSymbol: string,
  now = new Date(),
): Quote {
  const chart = object(object(value).chart);
  if (chart.error || !Array.isArray(chart.result) || chart.result.length !== 1)
    throw new Error("Quote unavailable");
  const meta = object(object(chart.result[0]).meta);
  if (
    typeof meta.symbol !== "string" ||
    meta.symbol.toUpperCase() !== expectedSymbol.toUpperCase()
  )
    throw new Error("Unexpected quote symbol");
  if (
    typeof meta.regularMarketPrice !== "number" ||
    !Number.isFinite(meta.regularMarketPrice) ||
    meta.regularMarketPrice <= 0
  )
    throw new Error("Invalid quote price");
  if (
    typeof meta.regularMarketTime !== "number" ||
    !Number.isFinite(meta.regularMarketTime) ||
    meta.regularMarketTime <= 0 ||
    meta.regularMarketTime * 1000 > now.getTime() + 300000
  )
    throw new Error("Invalid quote time");
  return {
    price: meta.regularMarketPrice,
    asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
    retrievedAt: now.toISOString(),
  };
}
export async function getYahooQuote(symbol: string): Promise<Quote> {
  const response = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error("Yahoo quote request failed");
  return parseYahooQuote(await response.json(), symbol);
}
