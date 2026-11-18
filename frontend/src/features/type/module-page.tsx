import { Suspense } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { typeModuleViews } from './module-loader';
const TypeRequirements=typeModuleViews.requirements.Component, TypeStandardCheck=typeModuleViews['standard-check'].Component;
const TypeAnalysis=typeModuleViews.electrical.Component, TypeRatingTable=typeModuleViews['rating-table'].Component;
const TypeComparison=typeModuleViews.comparison.Component, TypeSpecification=typeModuleViews.specification.Component;
export function TypeModulePage({ module, tab }: { module: string; tab: string }) {
  // This lightweight dispatcher belongs to the shell bundle; delaying it would
  // create another loading boundary before the already preloaded module.
  return <Suspense fallback={<LoadingState title="正在加载视图" />}><ModuleContent module={module} tab={tab} /></Suspense>;
}
function ModuleContent({ module, tab }: { module: string; tab: string }) {
  if (module === 'requirements') return <TypeRequirements tab={tab} />;
  if (module === 'standard-check') return <TypeStandardCheck />;
  if (module === 'electrical' || module === 'short-circuit') return <TypeAnalysis key={module} module={module} tab={tab} />;
  if (module === 'rating-table') return <TypeRatingTable tab={tab} />;
  if (module === 'comparison') return <TypeComparison tab={tab} />;
  if (module === 'specification') return <TypeSpecification tab={tab} />;
  return <ErrorState title="此型号模块不可用" description="请返回结构设计，或从浏览栏选择已有模块。" />;
}
