import type { Money } from "./normalize";

// Compact Intl currency defaults differ between Node/browser ICU versions.
// Keep chart labels deterministic during SSR and hydration.
export function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  const units = ["", "K", "M", "B", "T"];
  let scaled = Math.abs(value);
  let unit = 0;
  while (scaled >= 999.95 && unit < units.length - 1) {
    scaled /= 1000;
    unit++;
  }
  const digits = scaled.toFixed(1).replace(/\.0$/, "");
  const sign = value < 0 && Number(digits) !== 0 ? "-" : "";
  return `${sign}$${digits}${units[unit]}`;
}

export function money(value: Money | number | null) {
  const amount = typeof value === "number" ? value : value?.amount;
  if (amount === null || amount === undefined || !Number.isFinite(amount))
    return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
export function number(value: number | null) {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(value);
}
export function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value)) + " UTC"
    : "Unknown";
}
