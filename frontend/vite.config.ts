import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tokensPath = fileURLToPath(new URL('../design/tokens.css', import.meta.url));
const proxy = { '/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:8040', changeOrigin: true } };

export default defineConfig({
  plugins: [
    {
      name: 'cablesim-design-tokens',
      enforce: 'pre',
      resolveId(id) {
        return id === 'virtual:design-tokens.css' ? '\0virtual:design-tokens.css' : null;
      },
      load(id) {
        if (id !== '\0virtual:design-tokens.css') return null;
        this.addWatchFile(tokensPath);
        // The canonical token values are used verbatim. Fonts belong to this package.
        return readFileSync(tokensPath, 'utf8').replace(/^@import[^;]+;\s*$/gm, '');
      },
      handleHotUpdate(context) {
        if (context.file.replaceAll('\\', '/') === tokensPath.replaceAll('\\', '/')) {
          context.server.ws.send({ type: 'full-reload' });
        }
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', proxy },
});
