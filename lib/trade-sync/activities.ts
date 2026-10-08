import "server-only";
import type {
  AccountUniversalActivity,
  PersonalApiKeyAuth,
  Snaptrade,
} from "snaptrade-typescript-sdk";
import { setTimeout } from "node:timers/promises";
import { validHistoryDay } from "../historical-types";

export type Activity = {
  id: string;
  type: string;
  date: string | null;
  settlement: string | null;
  symbol: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  currency: string;
  side: "BUY" | "SELL" | null;
  optionAction: string;
  issue: string | null;
};
export type ActivityClient = Pick<
  Snaptrade<PersonalApiKeyAuth>["accountInformation"],
  "getAccountActivities"
>;
const nonTrades = new Set([
  "DEPOSIT",
  "SPINOFF",
  "REALIZEDGAINLOSS",
  "DIVIDEND",
  "SUBSTITUTE_DIVIDEND",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "INTEREST",
  "FEE",
  "TAX",
  "TRANSFER",
  "EXTERNAL_ASSET_TRANSFER_IN",
  "EXTERNAL_ASSET_TRANSFER_OUT",
  "SPLIT",
  "ADJUSTMENT",
  "STOCK_DIVIDEND",
]);
function day(value: unknown) {
  const result = typeof value === "string" ? value.slice(0, 10) : "";
  return validHistoryDay(result) ? result : null;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.abs(value)
    : null;
}
export function normalizeActivity(
  raw: AccountUniversalActivity,
): Activity | null {
  const type = String(raw.type ?? "").toUpperCase();
  if (nonTrades.has(type)) return null;
  const side =
    type === "BUY" || type === "REI" || type === "DIVIDENDREINVEST"
      ? "BUY"
      : type === "SELL"
        ? "SELL"
        : null;
  const date = day(raw.trade_date),
    settlement = day(raw.settlement_date);
  const symbol = (raw.option_symbol?.ticker || raw.symbol?.symbol || "")
    .trim()
    .toUpperCase();
  const quantity = number(raw.units),
    price = number(raw.price),
    amount = number(raw.amount);
  const currency = raw.currency?.code || "";
  return {
    id: raw.id || "",
    type,
    date: date || settlement,
    settlement,
    symbol,
    quantity,
    price,
    amount,
    currency,
    fee: number(raw.fee),
    side,
    optionAction: raw.option_type || "",
    issue: !side
      ? "Unsupported activity type; review required"
      : !raw.id || !symbol || !(date || settlement) || !quantity
        ? "Missing trade identity, date, symbol or quantity"
        : currency !== "USD"
          ? "Currency is not confirmed USD"
          : null,
  };
}

// Fetch every page before accepting an account. Full reads also catch older corrections.
// Never persist SDK responses or use brokerage descriptions as application data.
export async function fetchActivities(
  client: ActivityClient,
  accountId: string,
  sleep: (ms: number) => Promise<unknown> = setTimeout,
): Promise<Activity[]> {
  const result: Activity[] = [],
    seen = new Set<string>();
  let offset = 0,
    expected: number | undefined;
  for (let page = 0; page < 100; page++) {
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await client.getAccountActivities({
          accountId,
          offset,
          limit: 1000,
        });
        break;
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (attempt >= 3 || (status !== 429 && !(status && status >= 500)))
          throw new Error("Activity request failed");
        await sleep(1000 * 2 ** attempt);
      }
    }
    const { data, pagination } = response.data;
    if (!Array.isArray(data)) throw new Error("Invalid activity page");
    if (pagination?.offset !== undefined && pagination.offset !== offset)
      throw new Error("Invalid activity offset");
    if (pagination?.total !== undefined) {
      if (
        !Number.isInteger(pagination.total) ||
        pagination.total < 0 ||
        (expected !== undefined && expected !== pagination.total)
      )
        throw new Error("Activity history changed during pagination");
      expected = pagination.total;
    }
    for (const raw of data) {
      if (raw.id && seen.has(raw.id))
        throw new Error("Repeated activity page or ID");
      if (raw.id) seen.add(raw.id);
      const item = normalizeActivity(raw);
      if (item) result.push(item);
    }
    offset += data.length;
    if (expected !== undefined && offset > expected)
      throw new Error("Invalid activity count");
    if (
      expected !== undefined
        ? offset === expected
        : data.length < (pagination?.limit || 1000)
    )
      return result;
    if (!data.length) throw new Error("Incomplete activity history");
  }
  throw new Error("Activity pagination limit exceeded");
}
