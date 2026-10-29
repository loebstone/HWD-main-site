/** Default only a genuinely blank new form, not a reset that is still being applied. */
export function blankFormGroupDefault(
  open: boolean, current: string, documentGroupId: string | null | undefined,
  filteredGroupId: string | undefined, firstGroupId: string | undefined,
): string | undefined {
  return open && !current && !documentGroupId && !filteredGroupId ? firstGroupId : undefined;
}
