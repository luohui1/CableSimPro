import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const tokensPath = fileURLToPath(new URL('../design/tokens.css', import.meta.url));

// The workbench is served by the host in normal use (npm run build, npm start).
// `npm run dev` adds hot reload and forwards API calls to the running host.
export default defineConfig({
  plugins: [
    react(),
    {
      // design/tokens.css is the one rule file for colour, type, radius and spacing.
      // Its values are used verbatim; the fonts it names are bundled by this package.
      name: 'cable-studio-design-tokens',
      enforce: 'pre',
      resolveId(id) {
        return id === 'virtual:design-tokens.css' ? '\0virtual:design-tokens.css' : null;
      },
      load(id) {
        if (id !== '\0virtual:design-tokens.css') return null;
        this.addWatchFile(tokensPath);
        return readFileSync(tokensPath, 'utf8').replace(/^@import[^;]+;\s*$/gm, '');
      },
    },
  ],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 8201, proxy: { '/api': 'http://127.0.0.1:8200' }, fs: { allow: ['..'] } },
});
