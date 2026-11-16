// The operations of the model-type work, gathered so that the operation layer registers them with one line.
import { manualOperations } from './manual.ts';
import type { Operation, Studio } from './operations.ts';
import { ratingTableOperations } from './rating-tables.ts';

export function typeOperations(studio: Studio): Operation[] {
  return [...manualOperations(studio), ...ratingTableOperations(studio)];
}
