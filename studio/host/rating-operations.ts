// Operations of the rating workbench that only a person's screen needs: the starting point of a new project. They have no
// agent tool name, so the agent's tool set is the one it had.
import { obj, str } from '@earendil-works/pi-schema';
import type { RatingStart } from '../shared/rating-types.ts';
import type { Conditions, Installation } from '../shared/types.ts';
import type { Operation, Studio } from './operations.ts';

export function ratingOperations(studio: Studio): Operation[] {
  return [
    { id: 'rating.start', title: '新建工程的起点', kind: 'read', parameters: obj({ model_id: str({ description: '型号库标识' }) }),
      description: '一个型号新建工程时的起点：它的芯数允许的敷设方式，以及方法从哪组敷设和工况起步。',
      execute: async (params: { model_id: string }): Promise<RatingStart> => {
        const cable = studio.library.entry(params.model_id);
        const defaults = await studio.core.call<{ installation: Installation; conditions: Conditions }>('cable.defaults', { cable });
        return { model: { id: cable.id, name: cable.name, construction: cable.summary.construction },
          layouts: await studio.layouts(cable.summary.construction), ...defaults };
      } },
  ];
}
