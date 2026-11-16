// The routes of the type screens. They hang under the parent the router gives, so the router keeps their paths as literal
// types and a link anywhere (an Agent card, the side column) is checked against them.
import { createRoute, lazyRouteComponent, type AnyRoute } from '@tanstack/react-router';

const LibraryScreen = lazyRouteComponent(() => import('./library-screen'), 'LibraryScreen');
const SeriesScreen = lazyRouteComponent(() => import('./series-screen'), 'SeriesScreen');

/** Which size of a series, and which of its versions, the address points at; both are optional, the newest of the first size is the default. */
const seriesSearch = (search: Record<string, unknown>): { spec?: string; version?: number } => ({
  ...(typeof search.spec === 'string' ? { spec: search.spec } : {}),
  ...(typeof search.version === 'number' && Number.isInteger(search.version) && search.version > 0 ? { version: search.version } : {}),
});

export function typeRoutes<Parent extends AnyRoute>(parent: Parent) {
  const library = createRoute({ getParentRoute: () => parent, path: '/library', component: LibraryScreen });
  const series = createRoute({ getParentRoute: () => parent, path: '/library/$seriesId', validateSearch: seriesSearch, component: SeriesScreen });
  return [library, series] as const;
}
