import { preloadable } from './preloadable';

/** 需要按需加载的重组件集中在这里，页面与空闲预加载共用同一个加载入口。 */
export const contractFields = preloadable(() => import('@/components/buzzform-contract-fields').then(module => ({ default: module.BuzzformContractFields })));
export const cableLayerGrid = preloadable(() => import('@/components/cable-layer-grid'));
export const runRecordsContent = preloadable(() => import('@/components/run-records-content'));
export const studySweep = preloadable(() => import('@/components/study-sweep').then(module => ({ default: module.StudySweep })));
export const seriesChart = preloadable(() => import('@/components/series-chart').then(module => ({ default: module.SeriesChart })));
