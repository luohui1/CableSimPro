// Light or dark: both are in design/tokens.css, chosen by data-theme on the document.
import { create } from 'zustand';

type Theme = 'light' | 'dark';
const KEY = 'cable-studio.theme';

const stored = (): Theme => {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};

const initial = stored();
apply(initial);

export const useTheme = create<{ theme: Theme; toggle: () => void }>(set => ({
  theme: initial,
  toggle: () => set(state => {
    const theme: Theme = state.theme === 'light' ? 'dark' : 'light';
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private browsing: the choice lasts for this session only.
    }
    return { theme };
  }),
}));
