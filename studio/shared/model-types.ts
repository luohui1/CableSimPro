// Contracts of the model-type operations: creating a series or a specification by hand, ampacity tables kept on a
// specification, the initial structure a standard gives, and the GB 50217 correction. They sit beside the
// contracts of types.ts and only build on them.
import type { Derivation, SeriesDeclaration, SpecView } from './types.ts';

// ---- Creating a series or a specification by hand ----

/** How a version's structure came in when it was typed rather than imported; the entry is where "人工填写" is recorded. */
export interface ManualDerivation extends Derivation {
  entry: 'manual';
  entered_by: string;
  entered_at: string;
}

export interface SeriesCreated { series: string; name: string; description: string; declaration: SeriesDeclaration }
export interface SpecCreated { spec: string; version: number; view: SpecView }
