import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const tokensPath = path('../design/tokens.css');

// The Agent page of the fused product, built as a page of its own (npm run build:fusion) and served by the old platform at /agent-app/.
// It is shown in a frame inside the platform's own page, so nothing it styles reaches the platform's pages. Its API is the sidecar's,
// reached through the platform at /agent-sidecar.
export default defineConfig({
  base: '/agent-app/',
  plugins: [
    {
      // design/tokens.css is the one rule file for colour, type, radius and spacing, the same file the platform's own pages use.
      name: 'fusion-design-tokens',
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
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: {
      '@': path('./ui'), '@shared': path('./shared'),
      // The platform's own pages set their Latin text in the CJK face (Inter is not part of them); this page does the same, so the two read alike.
      '@fontsource-variable/inter': path('./ui/fusion/no-font.css'),
    },
  },
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('/agent-sidecar') },
  build: { outDir: 'dist-fusion', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000, rollupOptions: { input: path('./fusion.html') } },
  server: { host: '127.0.0.1', port: 8202, proxy: { '/agent-sidecar': 'http://127.0.0.1:8100' }, fs: { allow: ['..'] } },
});
