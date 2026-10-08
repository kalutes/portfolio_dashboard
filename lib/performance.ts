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
