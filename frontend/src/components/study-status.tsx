import { message, optionalRecord, text } from '@/api/client';
import type { StudyRow } from '@/api/research';
import { displayName } from '@/lib/display-names';
import { studyState } from '@/lib/study-state';
import type { StatusKind } from './status-mark';
import { VersionNotice } from './version-notice';
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/status-vocabulary';
import { useEffect, useState } from 'react';
import { studyErrorDescription } from './study-error-state';

/** Acknowledge once per installed release, across studies sharing that method. */
export function useMethodPresentationNotice(study: StudyRow, run: Record<string, unknown> | undefined) {
  const [notice, setNotice] = useState('');
  const notices = [run || study.raw].flatMap(value => {
    const rows = optionalRecord(optionalRecord(value).version_status).notices;
    return (Array.isArray(rows) ? rows : []).map(optionalRecord);
  }).filter(row => row.code === 'METHOD_PRESENTATION_UPDATED' && text(row.to_digest));
  useEffect(() => {
    setNotice('');
    const pending = notices.filter(row => !localStorage.getItem(`method-description:${text(row.id)}:${text(row.to_digest)}`));
    if (!pending.length) return;
    setNotice('方法说明已更新，保存结果仍有效。');
  }, [study.id, run?.id, notices.map(row => text(row.id) + ':' + text(row.to_digest)).join('|')]);
  return notice ? {description:notice, dismiss:() => {
    notices.forEach(row => localStorage.setItem(`method-description:${text(row.id)}:${text(row.to_digest)}`, 'acknowledged'));
    setNotice('');
  }} : undefined;
}

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
    if (reason.code === 'METHOD_VERSION_CHANGED') return reason.from_version === reason.to_version
      ? '方法发行内容已更新（版本号未变），结果需重算'
      : `方法 ${displayName(text(reason.id))} 已更新（${versions}），结果需重算`;
    if (reason.code === 'MODEL_VERSION_CHANGED') return `引用型号 ${versions}`;
    if (reason.code === 'METHOD_UNAVAILABLE') return `方法 ${displayName(text(reason.id))} 当前不可用`;
    return text(reason.message) || '输入或引用版本已变化';
  }))];
  if (run?.freshness === 'historical' && !details.length) details.push('工程输入或研究配置已修改');
  const created = text(run?.created);
  const when = formatDateTime(created);
  const failure = (Array.isArray(optionalRecord(run?.output).cases) ? optionalRecord(run?.output).cases as unknown[] : [])
    .map(optionalRecord).find(item => item.status === 'failed');
  const failureReason = text(optionalRecord(failure?.error).message) || text(failure?.message) || '请查看运行记录中的失败原因';
  const code = edits ? 'dirty' : error ? 'failed' : loading && !run ? 'loading' : state.code;
  const label = edits ? `${edits} 处未保存` : error ? statusLabel('failed', '失败') : code === 'loading' ? '读取中' : state.label;
  const mark: StatusKind = edits ? 'draft' : error ? 'error' : code === 'loading' ? 'running' : state.mark;
  const reason = edits ? `${edits} 处未保存修改` : error ? message(error) : code === 'outdated' ? details.join('；') || '输入或方法版本已变化'
    : code === 'loading' ? '正在读取保存运行' : code === 'not_run' ? '尚未运行，请预检并运行' : code === 'running' ? '运行中，保存结果保留' : code === 'failed' ? failureReason : `最近运行 ${when} · ${state.label}`;
  const staleValue = code === 'outdated' ? {version_status:{status:'stale',reasons}} : run || study.raw;
  const releaseDetails = reasons.filter(reason => reason.code === 'METHOD_VERSION_CHANGED').map(reason => `原发行摘要：${text(reason.from_release_digest) || text(reason.from_digest) || '记录未提供'}；当前发行摘要：${text(reason.to_release_digest) || text(reason.to_digest) || '记录未提供'}`).join('\n');
  return {code,label,mark,reason:studyErrorDescription(reason),releaseDetails,staleValue,historical:code === 'outdated'};
}
export type StudyPresentation = ReturnType<typeof studyPresentation>;

/** Reuse the existing revision checks, human scope confirmation and polling. */
export function StudyRecalculate(props: Parameters<typeof VersionNotice>[0]) {
  return <span className="study-recalculate"><VersionNotice {...props} /></span>;
}
