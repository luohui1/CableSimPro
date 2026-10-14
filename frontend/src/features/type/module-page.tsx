import { ErrorState } from '@/components/states';
import { deferredView } from '@/components/deferred-view';
import {typeModuleLoaders as loaders} from './module-loader';
const TypeRequirements=deferredView(loaders.requirements), TypeStandardCheck=deferredView(loaders['standard-check']);
const TypeAnalysis=deferredView(loaders.electrical), TypeRatingTable=deferredView(loaders['rating-table']);
const TypeComparison=deferredView(loaders.comparison), TypeSpecification=deferredView(loaders.specification);
export function TypeModulePage({ module, tab }: { module: string; tab: string }) {
  if (module === 'requirements') return <TypeRequirements tab={tab} />;
  if (module === 'standard-check') return <TypeStandardCheck />;
  if (module === 'electrical' || module === 'short-circuit') return <TypeAnalysis key={module} module={module} tab={tab} />;
  if (module === 'rating-table') return <TypeRatingTable tab={tab} />;
  if (module === 'comparison') return <TypeComparison tab={tab} />;
  if (module === 'specification') return <TypeSpecification tab={tab} />;
  return <ErrorState title="此型号模块不可用" description="请返回结构设计，或从浏览栏选择已有模块。" />;
}
