import { ErrorState } from '@/components/states';
import { TypeStandardCheck } from './standard-check';
import { TypeAnalysis } from './analysis';
import { TypeRatingTable } from './rating-table';
import { TypeComparison } from './comparison';
import { TypeSpecification } from './specification';
import { TypeRequirements } from './requirements';
export function TypeModulePage({ module, tab }: { module: string; tab: string }) {
  if (module === 'requirements') return <TypeRequirements tab={tab} />;
  if (module === 'standard-check') return <TypeStandardCheck />;
  if (module === 'electrical' || module === 'short-circuit') return <TypeAnalysis key={module} module={module} tab={tab} />;
  if (module === 'rating-table') return <TypeRatingTable tab={tab} />;
  if (module === 'comparison') return <TypeComparison tab={tab} />;
  if (module === 'specification') return <TypeSpecification tab={tab} />;
  return <ErrorState title="此模块待迁移" description="仍可从原样板查看已有输入与结果。" />;
}
