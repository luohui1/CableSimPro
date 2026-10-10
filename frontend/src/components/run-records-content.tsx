import { BackgroundRuns, type BackgroundRun } from './ai/background-runs';
import { ToolTimeline, type ToolTimelineItem } from './ai/tool-timeline';
import { VersionNotice } from './version-notice';
import { isVersionStale } from '@/lib/version-status';
import { displayName } from '@/lib/display-names';
import { optionalRecord, text } from '@/api/client';
import { useState } from 'react';
import { Button } from './ui/button';
import { RunRecordsComparison } from './run-records-comparison';
import { runStates } from './study-workbench-config';
import { savedRunLabel } from '@/features/field/run-label';
import { StudyRemoteProgress } from './study-run-control';

const statusLabel = (status: string) => runStates[status]?.label || status;
const time = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '时间未提供';
export default function RunRecordsContent({runs, selectedId, onSelect, workspace, studyId, disabledReason}: {
  runs: Record<string, unknown>[]; selectedId?: string; onSelect: (id: string) => void; workspace?: string; studyId?: string; disabledReason?: string;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [comparing, setComparing] = useState<string[]>([]);
  const items: BackgroundRun[] = [...runs].reverse().map(run => {
    const status = text(run.status), historical = run.freshness === 'historical' || isVersionStale(run);
    const method = optionalRecord(run.method || optionalRecord(optionalRecord(run.snapshot).definition).method);
    return { id: text(run.id), label: savedRunLabel(run), status: ['accepted','queued'].includes(status) ? 'queued' : ['running','validating'].includes(status) ? 'running' : ['succeeded','partial'].includes(status) ? 'complete' : 'failed',
      detail: [historical ? '历史结果' : '', statusLabel(status), displayName(text(method.plugin_id))].filter(Boolean).join(' · '),
      updatedAt: run.finished ? time(run.finished) : undefined };
  });
  const selected = runs.find(run => run.id === selectedId) || runs.at(-1);
  const timeline: ToolTimelineItem[] = selected ? [
    {id:'accepted', verb:'受理运行', status:'complete', time:time(selected.created)},
    ...(selected.finished ? [{id:'finished', verb:statusLabel(text(selected.status)), status:(selected.status === 'failed' ? 'failed' : 'complete') as ToolTimelineItem['status'], time:time(selected.finished)}] : [{id:'current', verb:statusLabel(text(selected.status)), status:(['running','validating'].includes(text(selected.status)) ? 'running' : 'pending') as ToolTimelineItem['status']}]),
  ] : [];
  return <div className="run-records-content" aria-label="研究运行记录">
    {selected && <StudyRemoteProgress run={selected} />}
    {workspace && <section aria-label="选择运行对比"><h3>对比两次运行</h3>
      <div className="run-comparison-choices">{[...runs].reverse().map(run => <label className="inspector-lead" key={text(run.id)}>
        <input type="checkbox" data-run-id={text(run.id)} aria-label={`对比 ${savedRunLabel(run)} · ${statusLabel(text(run.status))}`} checked={chosen.includes(text(run.id))}
          disabled={!['succeeded','partial','failed'].includes(text(run.status)) || chosen.length === 2 && !chosen.includes(text(run.id))}
          onChange={event => { setChosen(ids => event.target.checked ? [...ids, text(run.id)] : ids.filter(id => id !== run.id)); setComparing([]); }} />
        {savedRunLabel(run)} · {statusLabel(text(run.status))}
      </label>)}</div>
      <Button size="compact" disabled={chosen.length !== 2} onClick={() => setComparing([...chosen])}>对比所选运行</Button>
      {comparing.length === 2 && <RunRecordsComparison workspace={workspace} ids={comparing} />}
    </section>}
    <BackgroundRuns items={items} onOpen={onSelect} />
    {!!timeline.length && <ToolTimeline title="运行时间线" items={timeline} />}
    {workspace && studyId && [...runs].reverse().filter(isVersionStale).map(run => <div key={text(run.id)} className="stale-banner"><span>{time(run.created)}</span><VersionNotice value={run} target={{wid:workspace,sid:studyId,module:text(optionalRecord(run.snapshot).module)||undefined}} disabledReason={disabledReason} onComplete={next => onSelect(text(next.id))} /></div>)}
  </div>;
}
