// The Agent page as a page of its own, built separately from the old platform's front end and shown in a frame inside it: its styles
// cannot reach the old pages and theirs cannot reach it. It takes the platform's colours, fonts and radii from the same design/tokens.css.
import 'virtual:design-tokens.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/ibm-plex-mono/400.css';
import '../styles/app.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient, useHostEvents } from '@/state/queries';
import { useTheme } from '@/state/theme';
import { AgentPage } from './agent-page';
import { MESSAGE_SOURCE } from './open';

type Theme = 'light' | 'dark';
const asTheme = (value: unknown): Theme => (value === 'dark' ? 'dark' : 'light');

/** The platform around the frame decides light or dark; the frame follows it, from the address it was opened with and then from messages. */
function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  useTheme.setState({ theme });
}
setTheme(asTheme(new URLSearchParams(window.location.search).get('theme')));

function Root() {
  useHostEvents();
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = event.data as { source?: string; type?: string; theme?: unknown };
      if (message?.source === MESSAGE_SOURCE && message.type === 'theme') setTheme(asTheme(message.theme));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  return <><Outlet /><Toaster position="top-right" /></>;
}

const rootRoute = createRootRoute({ component: Root });
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <AgentPage key="new" /> });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$sessionId', component: ChatPage });
function ChatPage() {
  const { sessionId } = chatRoute.useParams();
  return <AgentPage key={sessionId} sessionId={sessionId} />;
}
// A hash history: the page is a static file the platform serves, so the address of a conversation lives after the #. The routes are the
// ones Cable Studio's router registers, so its page code (which navigates by those addresses) is typed against them as it is.
const router = createRouter({ routeTree: rootRoute.addChildren([landingRoute, chatRoute]), history: createHashHistory() });

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delay={350} closeDelay={60}>
      <RouterProvider router={router} />
    </TooltipProvider>
  </QueryClientProvider>,
);
