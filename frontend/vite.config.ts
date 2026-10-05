import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tokensPath = fileURLToPath(new URL('../design/tokens.css', import.meta.url));
const proxy = { '/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:8040', changeOrigin: true } };

export default defineConfig({
  plugins: [
    {
      name: 'cablesim-production-cad-assets',
      apply: 'build',
      async buildStart() {
        const checker = fileURLToPath(new URL('./src/features/cad/prepare-runtime.mjs', import.meta.url));
        const cache = fileURLToPath(new URL('./src/features/cad/node_modules/.cache/cablesim-occt/', import.meta.url));
        try {
          const { validateRuntime } = await import(pathToFileURL(checker).href);
          await validateRuntime(cache);
        } catch (error) {
          this.error('OCCT 发布资产缺失或校验失败。请在仓库根目录运行：\n'
            + 'python frontend/src/features/cad/native/prepare.py --jobs 4\n'
            + '完成后重新运行 python scripts/run_demo.py。\n' + String(error));
        }
      },
    },
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
