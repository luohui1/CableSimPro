import { message, optionalRecord, text } from '@/api/client';
import type { StudyRow } from '@/api/research';
import { displayName } from '@/lib/display-names';
import { studyState } from '@/lib/study-state';
import type { StatusKind } from './status-mark';
import { VersionNotice } from './version-notice';

/** §5.5: one projection for the selected study, shared by every workbench region. */
export function studyPresentation(study: StudyRow, run?: Record<string, unknown>, edits = 0, error?: unknown, loading = false) {
  const normalized = run?.status === 'queued' ? { ...run, status: 'accepted' } : run;
  const state = studyState(study, normalized);
  const reasons = [study.raw, run].flatMap(value => {
    const values = optionalRecord(optionalRecord(value).version_status).reasons;
    return (Array.isArray(values) ? values : []).map(optionalRecord);
  });
  const details = [...new Set(reasons.map(reason => {
    const versions = `${text(reason.from_version)} → ${text(reason.to_version)}`;
    if (reason.code === 'METHOD_VERSION_CHANGED') return `方法 ${displayName(text(reason.id))} ${versions}${reason.from_version === reason.to_version ? '（发行内容变化）' : ''}`;
    if (reason.code === 'MODEL_VERSION_CHANGED') return `引用型号 ${versions}`;
    if (reason.code === 'METHOD_UNAVAILABLE') return `方法 ${displayName(text(reason.id))} 当前不可用`;
    return text(reason.message) || '输入或引用版本已变化';
  }))];
  if (run?.freshness === 'historical' && !details.length) details.push('工程输入或研究配置已修改');
  const created = text(run?.created);
  const when = created ? new Date(created).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
  const failure = (Array.isArray(optionalRecord(run?.output).cases) ? optionalRecord(run?.output).cases as unknown[] : [])
    .map(optionalRecord).find(item => item.status === 'failed');
  const failureReason = text(optionalRecord(failure?.error).message) || text(failure?.message) || '请查看运行记录中的失败原因';
  const code = edits ? 'dirty' : error ? 'failed' : loading && !run ? 'loading' : state.code;
  const label = edits ? '未保存' : error ? '失败' : code === 'loading' ? '读取中' : state.label;
  const mark: StatusKind = edits ? 'draft' : error ? 'error' : code === 'loading' ? 'running' : state.mark;
  const reason = edits ? `${edits} 处未保存修改` : error ? message(error) : code === 'outdated' ? details.join('；') || '输入或方法版本已变化'
    : code === 'loading' ? '正在读取保存运行' : code === 'not_run' ? '尚未运行，请预检并运行' : code === 'running' ? '运行中，保存结果保留' : code === 'failed' ? failureReason : `最近运行 ${when} · ${state.label}`;
  const staleValue = code === 'outdated' ? {version_status:{status:'stale',reasons}} : run || study.raw;
  return {code,label,mark,reason,staleValue,historical:code === 'outdated'};
}
export type StudyPresentation = ReturnType<typeof studyPresentation>;

/** Reuse the existing revision checks, human scope confirmation and polling. */
export function StudyRecalculate(props: Parameters<typeof VersionNotice>[0]) {
  return <span className="study-recalculate"><VersionNotice {...props} /></span>;
}
