import { cx } from 'class-variance-authority';
import { extendTailwindMerge } from 'tailwind-merge';

// The theme (styles/theme.css) has its own type, radius, shadow and measure names. The merger learns them as scales, so
// every utility built on a scale knows them: `text-h1` is a size, not a colour beside `text-ink`; `rounded-b-sheet` and
// `max-w-thread` replace their own kind.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['13', '14', '16', '20', '28', 'caption', 'ui', 'prose', 'h3', 'h2', 'h1', 'display', 'metric', 'metric-sm'],
      radius: ['chip', 'field', 'nav', 'card', 'sheet', 'composer'],
      shadow: ['lift', 'modal', 'composer', 'menu'],
      container: ['thread', 'prose', 'page'],
    },
  },
});

export const cn = (...inputs: Parameters<typeof cx>) => merge(cx(...inputs));
