import {defineConfig} from 'vite';
export default defineConfig({
 server:{proxy:{'/api':'http://127.0.0.1:8000'}},
 build:{rollupOptions:{output:{manualChunks:{
  three:['three'],charts:['echarts/core','echarts/charts','echarts/components','echarts/renderers'],
  dock:['dockview-react'],canvas:['konva','react-konva']
 }}}}
});
