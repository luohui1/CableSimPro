// The routes of the type screens. They hang under the parent the router gives, so the router keeps their paths as literal
// types and a link anywhere (an Agent card, the side column) is checked against them.
import { createRoute, lazyRouteComponent, type AnyRoute } from '@tanstack/react-router';

const LibraryScreen = lazyRouteComponent(() => import('./library-screen'), 'LibraryScreen');
const SeriesScreen = lazyRouteComponent(() => import('./series-screen'), 'SeriesScreen');
const ImportScreen = lazyRouteComponent(() => import('./import-screen'), 'ImportScreen');
const CreateScreen = lazyRouteComponent(() => import('./create-screen'), 'CreateScreen');

/** A new size can be made for a series already in the library, and the page can open on the way that starts from a standard. */
const newSearch = (search: Record<string, unknown>): { series?: string; from?: 'standard' } => ({
  ...(typeof search.series === 'string' ? { series: search.series } : {}),
  ...(search.from === 'standard' ? { from: 'standard' as const } : {}),
});

/** Which size of a series, and which of its versions, the address points at; both are optional, the newest of the first size is the default. */
const seriesSearch = (search: Record<string, unknown>): { spec?: string; version?: number } => ({
  ...(typeof search.spec === 'string' ? { spec: search.spec } : {}),
  ...(typeof search.version === 'number' && Number.isInteger(search.version) && search.version > 0 ? { version: search.version } : {}),
});

export function typeRoutes<Parent extends AnyRoute>(parent: Parent) {
  const library = createRoute({ getParentRoute: () => parent, path: '/library', component: LibraryScreen });
  const creating = createRoute({ getParentRoute: () => parent, path: '/library/new', validateSearch: newSearch, component: CreateScreen });
  const importing = createRoute({ getParentRoute: () => parent, path: '/library/import', component: ImportScreen });
  const series = createRoute({ getParentRoute: () => parent, path: '/library/$seriesId', validateSearch: seriesSearch, component: SeriesScreen });
  return [library, creating, importing, series] as const;
}
