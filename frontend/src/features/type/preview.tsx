import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/600.css';
import 'virtual:design-tokens.css';
import '@/styles/theme.css';
import { createTypeRoutes } from './routes';

// Isolated integration entry; the production router imports createTypeRoutes from index.ts.
const root = createRootRoute({ component: Outlet });
const router = createRouter({ routeTree: root.addChildren([...createTypeRoutes(root)]), defaultPreload: 'intent' });
const queries = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queries}><RouterProvider router={router} /></QueryClientProvider>);
