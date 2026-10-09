import { optionalRecord, text } from '@/api/client';
import { isVersionStale, versionReasons } from '@/lib/version-status';

/** Reuses host freshness; never hides immutable saved results. */
export function FieldHistoryNotice({ run }: { run?: Record<string, unknown> }) {
  if (!run || (!isVersionStale(run) && run.freshness !== 'historical')) return null;
  const reasons = optionalRecord(run.version_status).reasons;
  const versions = (Array.isArray(reasons) ? reasons.map(optionalRecord) : []).filter(row => row.code === 'METHOD_VERSION_CHANGED');
  const detail = versions.length ? versions.map(row => `方法版本变化 ${text(row.from_version)} → ${text(row.to_version)}`).join('；')
    : versionReasons(run).join('；') || '输入或研究配置已变化';
  return <p role="status" className="field-history">历史 · {detail}；重算前保留此保存结果。</p>;
}
