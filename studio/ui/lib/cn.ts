import { cx } from 'class-variance-authority';
import { extendTailwindMerge } from 'tailwind-merge';

// The theme (styles/theme.css) has its own size, radius and shadow names; the merger must know them, or it would take
// `text-h1` for a colour and drop it next to `text-ink`.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['13', '14', '16', '20', '28', 'caption', 'ui', 'prose', 'h3', 'h2', 'h1', 'display', 'metric', 'metric-sm'] }],
      rounded: [{ rounded: ['chip', 'field', 'nav', 'card', 'sheet', 'composer', 'none'] }],
      shadow: [{ shadow: ['lift', 'modal', 'composer', 'menu', 'none'] }],
    },
  },
});

export const cn = (...inputs: Parameters<typeof cx>) => merge(cx(...inputs));
