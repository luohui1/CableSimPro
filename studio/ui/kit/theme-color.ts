// A colour of the theme as a value, for what draws outside CSS (the three.js renderer of the 3D viewport, a canvas): read
// from the token on the root element, again whenever the theme changes. Pass the token name: '--fill', '--ground'.
import { useEffect, useState } from 'react';
import { useTheme } from '@/state/theme';

const read = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

export function useThemeColor(token: string): string {
  const theme = useTheme(state => state.theme);
  const [colour, setColour] = useState(() => read(token));
  // data-theme is set on the root before the theme's state changes, so reading after the render gets the new colour.
  useEffect(() => setColour(read(token)), [theme, token]);
  return colour;
}
