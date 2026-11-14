import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The workbench is served by the host in normal use (npm run build, npm start).
// `npm run dev` adds hot reload and forwards API calls to the running host.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1', port: 8201, proxy: { '/api': 'http://127.0.0.1:8200' } },
});
