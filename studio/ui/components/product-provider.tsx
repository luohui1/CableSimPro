import { createTheme, MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { useTheme } from '@/state/theme';

const theme = createTheme({
  primaryColor: 'blue', primaryShade: 7, defaultRadius: 'sm',
  fontFamily: 'Segoe UI, Noto Sans SC Variable, Microsoft YaHei, sans-serif',
  fontFamilyMonospace: 'IBM Plex Mono, monospace',
  fontSizes: { xs: '.75rem', sm: '.8125rem', md: '.875rem', lg: '1rem', xl: '1.25rem' },
  headings: { fontWeight: '600', sizes: { h1: { fontSize: '1.5rem', lineHeight: '1.4' }, h2: { fontSize: '1.25rem', lineHeight: '1.4' }, h3: { fontSize: '1rem', lineHeight: '1.5' } } },
  components: { Button: { defaultProps: { size: 'sm' } }, TextInput: { defaultProps: { size: 'sm' } }, Select: { defaultProps: { size: 'sm' } }, Textarea: { defaultProps: { size: 'sm' } }, Badge: { defaultProps: { radius: 'sm', fw: 500 } } },
});

export function ProductProvider({ children }: { children: ReactNode }) {
  const { theme: colorScheme } = useTheme();
  return <MantineProvider theme={theme} forceColorScheme={colorScheme}>{children}</MantineProvider>;
}
