/** Display-only cleanup. Original names and provenance remain in the saved document. */
export function cleanLabel(value: string) { return value.replace(/（[^）]*演示[^）]*）|\([^)]*演示[^)]*\)/g, '').trim(); }
