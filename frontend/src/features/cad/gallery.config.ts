import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../../vite.config.ts';

export default mergeConfig(baseConfig, {
  base: '/',
  build: {
    outDir: fileURLToPath(new URL('../../../../.data/frontend-canvas/build', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./gallery.html', import.meta.url)) },
  },
});
