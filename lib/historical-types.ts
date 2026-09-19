export type HistoryPoint = {
  day: string;
  total: number | null;
  known: number;
  missing: number;
  estimated: number;
  stale: boolean;
};
export type HistoricalSeries = {
  revision: string;
  retrievedAt: string;
  points: HistoryPoint[];
};
export type HistoricalDetail = {
  day: string;
  holdings: {
    symbol: string;
    quantity: number | null;
    value: number | null;
    method: string;
    previous: string | null;
    next: string | null;
  }[];
};
export function validHistoryDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
