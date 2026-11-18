import { displayNames } from '@/lib/display-names';

/** Display-only cleanup. Original names and provenance remain in the saved document. */
export function cleanLabel(value: string) { return value.replace(/（[^）]*演示[^）]*）|\([^)]*演示[^)]*\)/g, '').trim(); }

/** Display registered names without changing material facts or unknown user labels. */
export function materialLabel(value: string) { return Object.hasOwn(displayNames, value) ? (displayNames[value] ?? value) : value; }
