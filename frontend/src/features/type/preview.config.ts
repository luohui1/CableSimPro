import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../../vite.config.ts';
export default mergeConfig(baseConfig, defineConfig({
  plugins: [{ name: 'type-preview-entry', configurePreviewServer(server) { server.middlewares.use((request, _response, next) => { if (!request.url?.startsWith('/api') && !request.url?.startsWith('/assets/') && !request.url?.endsWith('.wasm')) request.url = '/src/features/type/preview.html'; next(); }); } }],
  build: { outDir: fileURLToPath(new URL('../../../../.data/frontend-type/build', import.meta.url)), emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('./preview.html', import.meta.url)) } },
}));
