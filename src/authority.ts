export type AuthorityTier = string;

export const DEFAULT_AUTHORITY_LADDER: AuthorityTier[] = [
  "corrected",
  "validated",
  "codified",
  "decided",
  "working",
  "hypothesis",
  "inferred",
  "canonical",
];

export function authorityRank(
  a: AuthorityTier,
  ladder: AuthorityTier[] = DEFAULT_AUTHORITY_LADDER,
): number {
  const rank = ladder.indexOf(a);
  return rank < 0 ? ladder.length : rank;
}

export function authorityStrength(
  a: AuthorityTier,
  ladder: AuthorityTier[] = DEFAULT_AUTHORITY_LADDER,
): number {
  const rank = authorityRank(a, ladder);
  if (rank === ladder.length) return 0;
  return ladder.length <= 1 ? 1 : 1 - rank / (ladder.length - 1);
}

export function compareByAuthorityThenRecency(
  a: { authority?: string; updatedAt?: string },
  b: { authority?: string; updatedAt?: string },
  ladder: AuthorityTier[] = DEFAULT_AUTHORITY_LADDER,
): number {
  const authority = authorityRank(a.authority ?? "", ladder) - authorityRank(b.authority ?? "", ladder);
  if (authority) return authority;
  const aTime = Date.parse(a.updatedAt ?? "");
  const bTime = Date.parse(b.updatedAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return bTime - aTime;
  if (Number.isFinite(aTime)) return -1;
  if (Number.isFinite(bTime)) return 1;
  return 0;
}
