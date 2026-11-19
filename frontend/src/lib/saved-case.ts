/** A requested saved case is an exact identity, never permission to show a neighbour. */
export function pickSavedCase<T extends { case_id?: unknown }>(
  cases: readonly T[], preferredCase?: string, referenceCase?: string,
): T | undefined {
  if (preferredCase) return cases.find(item => item.case_id === preferredCase);
  return (referenceCase ? cases.find(item => item.case_id === referenceCase) : undefined) || cases[0];
}
