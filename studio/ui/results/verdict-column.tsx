// The right column: the conclusion on top, then one reading order downward.
import { useState } from 'react';
import { TabPanel, Tabs } from '@/components/tabs';
import type { Ramp } from '@/lib/ramp';
import type { Scene } from '@/canvas/scene';
import type { DomainDocument, RunRecord } from '@shared/types';
import { Attribution } from './attribution';
import { MethodPage, ObjectPage, RunTable } from './details';
import type { Rating } from './rating';
import { VerdictHead } from './verdict-head';

type Page = 'why' | 'object' | 'method';

export function VerdictColumn({ record, rating, scene, document, stale, ramp, selected, loading }: {
  record: RunRecord | undefined;
  rating: Rating | null;
  scene: Scene | null;
  document: DomainDocument | null;
  stale: boolean;
  ramp: Ramp;
  selected: string | null;
  loading: boolean;
}) {
  const [page, setPage] = useState<Page>('why');
  if (loading) return <Message title="正在读取" />;
  if (!record) return <Message title="还没有运行记录" body="点右上角的“运行校核”，结论会出现在这里。" />;
  if (record.kind !== 'rating') return <RunTable record={record} />;
  if (!rating || !scene || !document) {
    const issue = record.summary?.error ?? record.summary?.operating?.error;
    return <Message title="这次校核没有结果" body={issue?.message ?? '运行记录里没有可显示的结果。'} />;
  }
  const name = (cable: string) => scene.cables.find(item => item.id === cable)?.name ?? cable;
  const screenName = scene.shape.rings.some(ring => ring.role === 'metallic_sheath') ? '金属套' : '金属屏蔽';
  const state = rating.states.find(item => item.id === selected) ?? null;
  return <div className="flex h-full min-h-0 flex-col">
    <VerdictHead rating={rating} card={record.method_card} stale={stale} ramp={ramp} name={name} />
    <Tabs className="min-h-0 flex-1" value={page} onChange={setPage} items={[
      { value: 'why', label: '为什么是这个数' },
      { value: 'object', label: '对象' },
      { value: 'method', label: '方法' },
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
