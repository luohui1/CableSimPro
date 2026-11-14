// The right column: the conclusion on top, then one reading order downward.
import { useState } from 'react';
import { Segmented } from '@/components/segmented';
import { TabPanel, Tabs } from '@/components/tabs';
import { cn } from '@/lib/cn';
import type { Ramp } from '@/lib/ramp';
import type { Scene } from '@/canvas/scene';
import { useView } from '@/state/view';
import { compact, fixed } from '@shared/format';
import type { DomainDocument, RunRecord } from '@shared/types';
import { Attribution } from './attribution';
import { MethodPage, ObjectPage, RunTable } from './details';
import type { Rating } from './rating';
import { VerdictHead } from './verdict-head';

type Page = 'why' | 'object' | 'method';

export function VerdictColumn({ record, rating, scene, document, stale, draft, computing, failure, ramp, selected, loading }: {
  record: RunRecord | undefined;
  rating: Rating | null;
  scene: Scene | null;
  document: DomainDocument | null;
  stale: boolean;
  /** The result is for the present inputs and has not been kept as a record. */
  draft: boolean;
  /** A new result for changed inputs is on its way; what is shown is the previous one. */
  computing: boolean;
  /** Why the present inputs give no result, in the host's words. */
  failure: string | null;
  ramp: Ramp;
  selected: string | null;
  loading: boolean;
}) {
  const [page, setPage] = useState<Page>('why');
  const mode = useView(state => state.mode);
  if (failure) return <Message title="现在的输入算不出结果" body={failure} />;
  if (loading) return <Message title="正在计算" />;
  if (!record) return <Message title="输入还不完整" body="补齐上面“已知”里的内容，结论会出现在这里。" />;
  if (record.kind !== 'rating') return <RunTable record={record} />;
  if (!rating || !scene || !document) {
    const issue = record.summary?.error ?? record.summary?.operating?.error;
    return <Message title="这次校核没有结果" body={issue?.message ?? '运行记录里没有可显示的结果。'} />;
  }
  const name = (cable: string) => scene.cables.find(item => item.id === cable)?.name ?? cable;
  const screenName = scene.shape.rings.some(ring => ring.role === 'metallic_sheath') ? '金属套' : '金属屏蔽';
  const state = rating.states.find(item => item.id === selected) ?? null;
  return <div className={cn('flex h-full min-h-0 flex-col transition-opacity duration-std ease-std', computing && 'opacity-50')}>
    <VerdictHead rating={rating} card={record.method_card} stale={stale} draft={draft} computing={computing} ramp={ramp} name={name} />
    {/* Below the answer: the grounds for it. The switch chooses the moment the drawing and these pages show. */}
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 pt-4 pb-1">
      <span className="text-13 font-strong text-ink-2">依据</span>
      <Segmented label="图和下面的数显示哪个时刻" value={mode} onChange={useView.getState().setMode} options={[
        { value: 'load', label: `现在 ${compact(rating.load)} A` },
        { value: 'rated', label: `带满 ${fixed(rating.ampacity)} A` },
      ]} />
    </div>
    <Tabs className="min-h-0 flex-1" value={page} onChange={setPage} items={[
      { value: 'why', label: '为什么是这个数' },
      { value: 'object', label: '选中的电缆' },
      { value: 'method', label: '算法和可信度' },
    ]}>
      <TabPanel value="why" className="overflow-y-auto"><Attribution rating={rating} ramp={ramp} name={name} screenName={screenName} /></TabPanel>
      <TabPanel value="object" className="overflow-y-auto">
        <ObjectPage state={state} name={state ? name(state.id) : null} shape={scene.shape} materials={document.materials} screenName={screenName} />
      </TabPanel>
      <TabPanel value="method" className="overflow-y-auto">{record.method_card && <MethodPage card={record.method_card} record={record} />}</TabPanel>
    </Tabs>
  </div>;
}

function Message({ title, body }: { title: string; body?: string }) {
  return <div className="flex h-full flex-col justify-center px-8">
    <h2 className="m-0 text-16 font-strong text-ink">{title}</h2>
    {body && <p className="m-0 mt-2 text-14 text-ink-2">{body}</p>}
  </div>;
}
