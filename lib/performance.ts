import type { normalizePosition } from "./normalize";

/** Unrealized price gain only; missing/negative basis is not a zero-cost holding. */
export function unrealizedPerformance(
  value: number | null,
  basis: number | null,
) {
  const costBasis =
    basis !== null && Number.isFinite(basis) && basis >= 0 ? basis : null;
  const difference =
    value !== null && Number.isFinite(value) && costBasis !== null
      ? value - costBasis
      : null;
  const gain =
    difference !== null && Number.isFinite(difference) ? difference : null;
  const ratio =
    gain !== null && costBasis !== null && costBasis > 0
      ? (gain / costBasis) * 100
      : null;
  return {
    costBasis,
    gain,
    gainPercent: ratio !== null && Number.isFinite(ratio) ? ratio : null,
  };
}

export function gainPercent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "Unavailable"
    : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Display-only estimate. Never replace missing source basis in the database. */
export function positionPerformance(
  position: Pick<
    ReturnType<typeof normalizePosition>,
    "value" | "costBasis" | "units" | "lots"
  >,
) {
  const value = position.value.amount;
  const reported = unrealizedPerformance(value, position.costBasis.amount);
  if (reported.costBasis !== null)
    return { ...reported, basisEstimated: false, missingBasisValue: 0 };

  let knownBasis = 0,
    missingFraction = 1;
  const units = position.units;
  const lots = position.lots;
  const quantifiableLots = lots.filter(
    (lot) =>
      lot.quantity !== null &&
      Number.isFinite(lot.quantity) &&
      lot.quantity >= 0,
  );
  if (
    units !== null &&
    Number.isFinite(units) &&
    units > 0 &&
    lots.length &&
    quantifiableLots.reduce((sum, lot) => sum + lot.quantity!, 0) <=
      units * (1 + 1e-12)
  ) {
    let knownUnits = 0;
    for (const lot of quantifiableLots) {
      const basis = lot.costBasis.amount;
      if (
        lot.quantity! > 0 &&
        basis !== null &&
        Number.isFinite(basis) &&
        basis >= 0
      ) {
        knownUnits += lot.quantity!;
        knownBasis += basis;
      }
    }
    missingFraction = Math.max(0, (units - knownUnits) / units);
    if (Math.abs(units - knownUnits) <= units * 1e-12) missingFraction = 0;
  }
  const missingBasisValue =
    missingFraction === 0
      ? 0
      : value !== null && Number.isFinite(value) && value >= 0
        ? value * missingFraction
        : null;
  const estimatedBasis =
    missingBasisValue === null ? null : knownBasis + missingBasisValue;
  return {
    ...unrealizedPerformance(value, estimatedBasis),
    basisEstimated: missingFraction > 0,
    missingBasisValue,
  };
}
