// The routes of the rating workbench, written here and handed to the router under its root. The address holds what a link
// should reopen: the cable a new project starts with (/workbench?model=<library id>), the project and the run record shown
// (/p/<project>?run=<record>).
import { createRoute, lazyRouteComponent, type AnyRoute } from '@tanstack/react-router';

export function ratingRoutes<Parent extends AnyRoute>(parent: Parent) {
  const entry = createRoute({
    getParentRoute: () => parent,
    path: '/workbench',
    validateSearch: (search: Record<string, unknown>): { model?: string; new?: true } => ({
      ...(typeof search.model === 'string' && search.model ? { model: search.model } : {}),
      ...(search.new === true || search.new === 'true' ? { new: true as const } : {}),
    }),
    component: lazyRouteComponent(() => import('./entry-page'), 'EntryPage'),
  });
  const project = createRoute({
    getParentRoute: () => parent,
    path: '/p/$projectId',
    validateSearch: (search: Record<string, unknown>): { run?: string } => (typeof search.run === 'string' ? { run: search.run } : {}),
    component: lazyRouteComponent(() => import('./project-page'), 'ProjectPage'),
  });
  return [entry, project] as const;
}
