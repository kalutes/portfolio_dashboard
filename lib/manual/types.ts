export type ManualAccount = {
  id: string;
  name: string;
  institution: string;
};
export type ManualHolding = {
  id: string;
  accountId: string;
  symbol: string;
  description: string;
  quantity: number;
  cashEquivalent: boolean;
  quoteSymbol: string;
  manualValue: number | null;
  manualAsOf: string | null;
  costBasis: number | null;
  acquiredDate: string | null;
  quotePrice: number | null;
  quoteAsOf: string | null;
  quoteRetrievedAt: string | null;
};
export type ManualSnapshot = {
  accounts: ManualAccount[];
  holdings: ManualHolding[];
};
export class ManualInputError extends Error {}

function field(data: FormData, name: string, required = true, max = 120) {
  const raw = data.get(name);
  if (raw !== null && typeof raw !== "string")
    throw new ManualInputError("Invalid form input.");
  const value = (raw ?? "").trim();
  if ((required && !value) || value.length > max)
    throw new ManualInputError(
      `${name}: enter a value of at most ${max} characters.`,
    );
  return value;
}
function decimal(value: string, label: string) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
    throw new ManualInputError(
      `${label}: enter a plain number without commas.`,
    );
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e15)
    throw new ManualInputError(
      `${label}: value is outside the supported range.`,
    );
  return number;
}
export function accountInput(
  data: FormData,
): Omit<ManualAccount, "id"> & { id: string } {
  return {
    id: field(data, "id", false, 64),
    name: field(data, "name"),
    institution: field(data, "institution"),
  };
}
export function holdingInput(data: FormData) {
  const manualValueText = field(data, "manualValue", false, 40);
  const manualAsOf = field(data, "manualAsOf", false, 10);
  const quoteSymbol = field(data, "quoteSymbol", false, 40);
  const basisText = field(data, "costBasis", false, 40);
  const costBasis = basisText ? decimal(basisText, "Cost basis") : null;
  const acquiredDate = field(data, "acquiredDate", false, 10);
  if (costBasis !== null && costBasis < 0)
    throw new ManualInputError("Total cost basis must be zero or positive.");
  if (
    acquiredDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(acquiredDate) ||
      !Number.isFinite(Date.parse(acquiredDate)) ||
      new Date(acquiredDate).toISOString().slice(0, 10) !== acquiredDate ||
      acquiredDate > new Date().toISOString().slice(0, 10))
  )
    throw new ManualInputError("Enter a valid, non-future acquisition date.");
  if (
    acquiredDate &&
    manualValueText &&
    manualAsOf &&
    acquiredDate > manualAsOf
  )
    throw new ManualInputError(
      "Acquisition date cannot be after the manual valuation date.",
    );
  if (quoteSymbol && !/^[A-Za-z0-9.^=_-]+$/.test(quoteSymbol))
    throw new ManualInputError("Quote symbol contains unsupported characters.");
  if (!manualValueText && !quoteSymbol)
    throw new ManualInputError("Enter a manual total value or a quote symbol.");
  if (
    manualValueText &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(manualAsOf) ||
      !Number.isFinite(Date.parse(manualAsOf)) ||
      new Date(manualAsOf).toISOString().slice(0, 10) !== manualAsOf ||
      manualAsOf > new Date().toISOString().slice(0, 10))
  )
    throw new ManualInputError("Enter a valid, non-future valuation date.");
  const quantity = decimal(field(data, "quantity", true, 40), "Quantity");
  if (quoteSymbol && quantity === 0)
    throw new ManualInputError("A quoted holding needs a nonzero quantity.");
  return {
    id: field(data, "id", false, 64),
    accountId: field(data, "accountId", true, 64),
    symbol: field(data, "symbol", true, 80),
    description: field(data, "description", false, 240),
    quantity,
    cashEquivalent: data.get("cashEquivalent") === "on",
    quoteSymbol,
    manualValue: manualValueText
      ? decimal(manualValueText, "Manual value")
      : null,
    manualAsOf: manualValueText ? manualAsOf : null,
    costBasis,
    acquiredDate: acquiredDate || null,
  };
}
