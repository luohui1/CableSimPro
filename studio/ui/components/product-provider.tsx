import { createTheme, MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { useTheme } from '@/state/theme';

const theme = createTheme({
  primaryColor: 'blue', primaryShade: 7, defaultRadius: 'md',
  fontFamily: 'Noto Sans SC Variable, Segoe UI, Microsoft YaHei, sans-serif',
  fontFamilyMonospace: 'IBM Plex Mono, monospace',
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
  headings: { fontWeight: '600', sizes: { h1: { fontSize: '24px', lineHeight: '1.4' }, h2: { fontSize: '20px', lineHeight: '1.4' }, h3: { fontSize: '16px', lineHeight: '1.5' } } },
  components: { Button: { defaultProps: { size: 'sm' } }, TextInput: { defaultProps: { size: 'sm' } }, Select: { defaultProps: { size: 'sm' } }, Textarea: { defaultProps: { size: 'sm' } } },
});

export function ProductProvider({ children }: { children: ReactNode }) {
  const { theme: colorScheme } = useTheme();
  return <MantineProvider theme={theme} forceColorScheme={colorScheme}>{children}</MantineProvider>;
}
