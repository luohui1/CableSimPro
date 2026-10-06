import { BackgroundRuns, type BackgroundRun } from './ai/background-runs';
import { ToolTimeline, type ToolTimelineItem } from './ai/tool-timeline';
import { VersionNotice } from './version-notice';
import { isVersionStale } from '@/lib/version-status';
import { displayName } from '@/lib/display-names';
import { optionalRecord, text } from '@/api/client';

const statusLabels: Record<string, string> = { accepted: '排队', queued: '排队', validating: '执行中', running: '执行中', succeeded: '成功', partial: '部分成功', failed: '失败', cancelled: '已停止', canceled: '已停止' };
const time = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString('zh-CN') : '时间未提供';
export default function RunRecordsContent({runs, selectedId, onSelect, workspace, studyId, disabledReason}: {
  runs: Record<string, unknown>[]; selectedId?: string; onSelect: (id: string) => void; workspace?: string; studyId?: string; disabledReason?: string;
}) {
  const items: BackgroundRun[] = [...runs].reverse().map(run => {
    const status = text(run.status), historical = run.freshness === 'historical' || isVersionStale(run);
    const method = optionalRecord(run.method || optionalRecord(optionalRecord(run.snapshot).definition).method);
    return { id: text(run.id), label: time(run.created), status: ['accepted','queued'].includes(status) ? 'queued' : ['running','validating'].includes(status) ? 'running' : ['succeeded','partial'].includes(status) ? 'complete' : 'failed',
      detail: [historical ? '历史结果' : '', statusLabels[status] || '未知状态', displayName(text(method.plugin_id))].filter(Boolean).join(' · '),
      updatedAt: run.finished ? time(run.finished) : undefined };
  });
  const selected = runs.find(run => run.id === selectedId) || runs.at(-1);
  const timeline: ToolTimelineItem[] = selected ? [
    {id:'accepted', verb:'受理运行', status:'complete', time:time(selected.created)},
    ...(selected.finished ? [{id:'finished', verb:statusLabels[text(selected.status)] || '运行结束', status:(selected.status === 'failed' ? 'failed' : 'complete') as ToolTimelineItem['status'], time:time(selected.finished)}] : [{id:'current', verb:statusLabels[text(selected.status)] || '等待服务状态', status:(['running','validating'].includes(text(selected.status)) ? 'running' : 'pending') as ToolTimelineItem['status']}]),
  ] : [];
  return <div className="run-records-content" aria-label="研究运行记录">
    <BackgroundRuns items={items} onOpen={onSelect} />
    {!!timeline.length && <ToolTimeline title="运行时间线" items={timeline} />}
    {workspace && studyId && [...runs].reverse().filter(isVersionStale).map(run => <div key={text(run.id)} className="stale-banner"><span>{time(run.created)}</span><VersionNotice value={run} target={{wid:workspace,sid:studyId,module:text(optionalRecord(run.snapshot).module)||undefined}} disabledReason={disabledReason} onComplete={next => onSelect(text(next.id))} /></div>)}
  </div>;
}
