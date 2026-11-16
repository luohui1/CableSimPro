// Contracts of the rating workbench that the host answers beyond the shared ones (types.ts).
import type { Conditions, Installation, LayoutOption } from './types.ts';

/**
 * What a new project starts from for one cable of the product library: the laying templates its core count allows, and the
 * installation and conditions the method starts from. The form of a new project is filled with these, never with numbers
 * of its own.
 */
export interface RatingStart {
  model: { id: string; name: string; construction: string };
  layouts: LayoutOption[];
  installation: Installation;
  conditions: Conditions;
}
