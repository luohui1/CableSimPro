import { numeric, optionalRecord, text } from '@/api/client';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { containsArtifact, useTypeEvidence } from './evidence';
import { typePath, useTypeNavigation } from './navigation';

export function SavedRunPicker({ schema }: { schema: string }) {
  const { location, navigate } = useTypeNavigation(), evidence = useTypeEvidence();
  const runs = evidence.data?.filter(item => item.run.integrity === 'verified' && containsArtifact(item.run, schema)) || [];
  if (!runs.length) return null;
  return <><Select label="保存运行" value={location.run || 'latest'} onChange={value => navigate(typePath(location.wid!, location.module, location.tab, location.theme) + (value === 'latest' ? '' : '&run=' + encodeURIComponent(value)))} options={[
    { value: 'latest', label: '最近保存运行' },
    ...runs.map(({ study, run }) => {
      const time = new Date(text(run.created));
      return { value: text(run.id), label: `${text(optionalRecord(study.definition).title) || '型号计算'} · 运行 ${numeric(run.sequence) ?? '—'} · ${Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间未提供'}` };
    }),
  ]} />{!evidence.historyComplete&&<Button variant="ghost" size="compact" loading={evidence.isFetching} onClick={()=>evidence.readHistory()}>全部保存运行</Button>}</>;
}
