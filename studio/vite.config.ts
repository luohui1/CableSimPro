import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const tokensPath = path('../design/tokens.css');

// The workbench is served by the host in normal use (npm run build, npm start).
// `npm run dev` adds hot reload and forwards API calls to the running host.
export default defineConfig({
  plugins: [
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
    tailwindcss(),
    react(),
    // The React Compiler memoises components and hooks, so the code carries no hand-written memoisation.
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: { alias: { '@': path('./ui'), '@shared': path('./shared') } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000 },
  server: { host: '127.0.0.1', port: 8201, proxy: { '/api': 'http://127.0.0.1:8200', '/reports': 'http://127.0.0.1:8200' }, fs: { allow: ['..'] } },
});
