export type AccountExclusion = { accountId: string; reason: string };

/** Inclusion is configured in the private database, never inferred from names. */
export function accountExclusionReason(
  account: { id: string },
  exclusions: readonly AccountExclusion[],
): string | null {
  return (
    exclusions.find((entry) => entry.accountId === account.id)?.reason ?? null
  );
}
