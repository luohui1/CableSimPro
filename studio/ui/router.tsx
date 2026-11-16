// Routes are written in code; nothing is generated. The address holds what a link should reopen: the conversation, the series
// and size. The rating workbench writes its own routes (the project and the run record being looked at).
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, useNavigate } from '@tanstack/react-router';
import { Notice } from '@/components/notice';
import { ratingRoutes } from '@/rating/routes';
import { Shell } from '@/shell/shell';
import { useHostEvents } from '@/state/queries';
const AgentPage = lazyRouteComponent(() => import('@/agent/agent-page'), 'AgentPage');
const ProductLibrary = lazyRouteComponent(() => import('@/pages/library'), 'ProductLibrary');
const ImportLibrary = lazyRouteComponent(() => import('@/pages/import'), 'ImportLibrary');
const SeriesWorkspace = lazyRouteComponent(() => import('@/pages/series'), 'SeriesWorkspace');
const Gallery = lazyRouteComponent(() => import('@/pages/gallery'), 'Gallery');

function Root() {
  useHostEvents();
  return <>
    <Shell />
    <Notice />
  </>;
}

const rootRoute = createRootRoute({ component: Root });
// Agent mode is the home of the application; the workbench is one switch away.
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <AgentPage key="new" /> });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$sessionId', component: ChatPage });
function ChatPage() {
  const { sessionId } = chatRoute.useParams();
  return <AgentPage key={sessionId} sessionId={sessionId} />;
}
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library', component: ProductLibrary });
const importRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library/import', component: ImportLibrary });
const seriesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library/$seriesId',
  validateSearch: (search: Record<string, unknown>): { spec?: string; version?: number } => ({ ...(typeof search.spec === 'string' ? { spec: search.spec } : {}),
    ...(typeof search.version === 'number' && Number.isInteger(search.version) && search.version > 0 ? { version: search.version } : {}) }),
  component: SeriesPage });
function SeriesPage() {
  const { seriesId } = seriesRoute.useParams();
  const { spec, version } = seriesRoute.useSearch();
  const navigate = useNavigate();
  return <SeriesWorkspace key={seriesId} id={seriesId} spec={spec} version={version} onInspect={(spec, version) => void navigate({ to: '/library/$seriesId', params: { seriesId }, search: { spec, version } })} />;
}
const galleryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/gallery', component: Gallery });

export const router = createRouter({ routeTree: rootRoute.addChildren([landingRoute, chatRoute, libraryRoute, importRoute, seriesRoute, ...ratingRoutes(rootRoute), galleryRoute]) });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
