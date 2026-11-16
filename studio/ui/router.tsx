// Routes are written in code; nothing is generated. The address holds what a link should reopen: the conversation, the series
// and size. The rating workbench writes its own routes (the project and the run record being looked at).
import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router';
import { ratingRoutes } from '@/rating/routes';
import { Shell } from '@/shell/shell';
import { useHostEvents } from '@/state/queries';
import { typeRoutes } from '@/types/routes';
const AgentPage = lazyRouteComponent(() => import('@/agent/agent-page'), 'AgentPage');
const Gallery = lazyRouteComponent(() => import('@/pages/gallery'), 'Gallery');

function Root() {
  useHostEvents();
  return <Shell />;
}

const rootRoute = createRootRoute({ component: Root });
// Agent mode is the home of the application; the workbench is one switch away.
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <AgentPage key="new" /> });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$sessionId', component: ChatPage });
function ChatPage() {
  const { sessionId } = chatRoute.useParams();
  return <AgentPage key={sessionId} sessionId={sessionId} />;
}
const galleryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/gallery', component: Gallery });

export const router = createRouter({ routeTree: rootRoute.addChildren([landingRoute, chatRoute, ...typeRoutes(rootRoute), ...ratingRoutes(rootRoute), galleryRoute]) });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
