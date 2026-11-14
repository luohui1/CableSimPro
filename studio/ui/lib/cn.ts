import { cx } from 'class-variance-authority';
import { extendTailwindMerge } from 'tailwind-merge';

// The rule set has its own size, radius and shadow names (see styles/app.css); the merger must know them.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['13', '14', '16', '20', '28'] }],
      rounded: [{ rounded: ['chip', 'field', 'nav', 'card', 'sheet', 'full', 'none'] }],
      shadow: [{ shadow: ['lift', 'modal', 'none'] }],
    },
  },
});

export const cn = (...inputs: Parameters<typeof cx>) => merge(cx(...inputs));
