import { cableLayerGrid, contractFields, runRecordsContent } from './heavy-components';

/**
 * 空闲时预下载常用页面与重组件的代码块（参考 LobeChat src/spa/initialize/routePreload.ts）：
 * 首次点开研究、参数表单、分层表或运行记录时不再等下载。省流量模式下跳过。
 */
export function preloadCommonChunks() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (!navigator.onLine || connection?.saveData) return;
  // Speculative downloads may lose the network after this check. The actual
  // page load still owns its error state; idle work must not reject globally.
  void import('@/components/study-provider').catch(() => {});
  void import('@/pages/study-workspace').catch(() => {});
  void contractFields.preload();
  void cableLayerGrid.preload();
  void runRecordsContent.preload();
}
