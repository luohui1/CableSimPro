import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import 'virtual:design-tokens.css';
import './styles/theme.css';
import './styles/research.css';
import { router } from './router';
import { preferences } from './lib/preferences';

document.documentElement.dataset.reducedMotion = preferences().reducedMotion ? 'true' : 'false';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>,
);
