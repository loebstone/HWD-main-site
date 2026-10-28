/** Friendly address only; retain full display names for attribution and records. */
export function nameOf(identity: { goesBy?: string | null; displayName: string }): string {
  const goesBy = identity.goesBy?.trim();
  if (goesBy) return goesBy;

  const displayName = identity.displayName.trim();
  const comma = displayName.indexOf(",");
  const givenNames = comma >= 0 ? displayName.slice(comma + 1).trim() : displayName;
  return givenNames.split(/\s+/)[0] || "";
}
