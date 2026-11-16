// What the rating workbench reads besides the project itself (state/queries): where a new project starts from.
import { useQuery } from '@tanstack/react-query';
import type { RatingStart } from '@shared/rating-types';
import { api } from '@/state/api';

/** The laying templates and starting values for one cable of the library; nothing is asked until a cable is chosen. */
export const useStart = (model: string | undefined) => useQuery({
  queryKey: ['rating', 'start', model],
  queryFn: () => api.op<RatingStart>('rating.start', { model_id: model as string }),
  enabled: Boolean(model),
  staleTime: Infinity,
  retry: false,
});
