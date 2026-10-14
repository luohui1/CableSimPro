// Keep this dispatch free of view dependencies so route entry can start the
// selected module before the workbench's component graph finishes loading.
export const typeModuleLoaders = {
  requirements: () => import('./requirements').then(m => ({default:m.TypeRequirements})),
  'standard-check': () => import('./standard-check').then(m => ({default:m.TypeStandardCheck})),
  electrical: () => import('./analysis').then(m => ({default:m.TypeAnalysis})),
  'rating-table': () => import('./rating-table').then(m => ({default:m.TypeRatingTable})),
  comparison: () => import('./comparison').then(m => ({default:m.TypeComparison})),
  specification: () => import('./specification').then(m => ({default:m.TypeSpecification})),
};
export function preloadTypeModule(module:string) {
  return typeModuleLoaders[(module==='short-circuit'?'electrical':module) as keyof typeof typeModuleLoaders]?.();
}
