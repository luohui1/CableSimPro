import { preloadable } from '@/lib/preloadable';

// Route preloading and the visible module read the same tracked promise. A
// second React.lazy wrapper would suspend even after this import had completed.
// Only the selected view is downloaded; this registry imports no view eagerly.
export const typeModuleViews = {
  requirements: preloadable(() => import('./requirements').then(m => ({default:m.TypeRequirements}))),
  'standard-check': preloadable(() => import('./standard-check').then(m => ({default:m.TypeStandardCheck}))),
  electrical: preloadable(() => import('./analysis').then(m => ({default:m.TypeAnalysis}))),
  'rating-table': preloadable(() => import('./rating-table').then(m => ({default:m.TypeRatingTable}))),
  comparison: preloadable(() => import('./comparison').then(m => ({default:m.TypeComparison}))),
  specification: preloadable(() => import('./specification').then(m => ({default:m.TypeSpecification}))),
};
export function preloadTypeModule(module:string) {
  return typeModuleViews[(module==='short-circuit'?'electrical':module) as keyof typeof typeModuleViews]?.preload();
}
