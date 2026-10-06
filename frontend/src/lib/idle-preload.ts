import { cableLayerGrid, contractFields, runRecordsContent } from './heavy-components';

/**
 * 空闲时预下载常用页面与重组件的代码块（参考 LobeChat src/spa/initialize/routePreload.ts）：
 * 首次点开研究、参数表单、分层表或运行记录时不再等下载。省流量模式下跳过。
 */
export function preloadCommonChunks() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  void import('@/components/study-provider');
  void import('@/pages/study-workspace');
  void contractFields.preload();
  void cableLayerGrid.preload();
  void runRecordsContent.preload();
}
