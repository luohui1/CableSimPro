// What a tab says while its result is not there: not computed yet, out of date, or failed. The one way out is the calculation.
import type { ReactNode } from 'react';
import type { ProductResult } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { EmptyState } from '@/kit/workbench/premise';

export function ResultGate({ result, name, onCompute, busy, children }: {
  result: ProductResult | undefined;
  name: string;
  onCompute: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const state = !result ? { title: `${name}还没有计算`, text: '这一版还没有算过。' }
    : !result.current ? { title: `${name}需要重算`, text: '结构或执行标准已变化，这个结果对不上现在的版本。' }
      : result.error ? { title: `${name}没有算出来`, text: result.error.message } : null;
  if (!state) return <>{children}</>;
  return <EmptyState className="py-12" icon={result?.error ? 'status/error' : 'run/run'} title={state.title} description={state.text}
    action={<Button variant="outline" disabled={busy} onClick={onCompute}><Icon name="run/run" data-icon="inline-start" />计算与核对</Button>} />;
}
