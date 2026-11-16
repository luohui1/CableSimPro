// The routes of the type screens. They hang under the parent the router gives, so the router keeps their paths as literal
// types and a link anywhere (an Agent card, the side column) is checked against them.
import { createRoute, lazyRouteComponent, type AnyRoute } from '@tanstack/react-router';

const LibraryScreen = lazyRouteComponent(() => import('./library-screen'), 'LibraryScreen');

export function typeRoutes<Parent extends AnyRoute>(parent: Parent) {
  const library = createRoute({ getParentRoute: () => parent, path: '/library', component: LibraryScreen });
  return [library] as const;
}
