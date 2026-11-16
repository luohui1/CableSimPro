import 'virtual:design-tokens.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/app.css';
import './state/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { TipProvider } from './components/tooltip';
import { router } from './router';
import { queryClient } from './state/queries';

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <TipProvider>
      <RouterProvider router={router} />
    </TipProvider>
  </QueryClientProvider>,
);
