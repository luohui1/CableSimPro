import { useQuery } from '@tanstack/react-query';
import { array, optionalRecord, record, text } from '@/api/client';
import { runArtifact, typeEvidence } from './api';
import { useTypeWorkspace } from './provider';
import { displayName } from '@/lib/display-names';
import { versionLabel } from './design-summary';
import type { StatusKind } from '@/components/status-mark';

export function useTypeEvidence() {
  const state = useTypeWorkspace();
  return useQuery({ queryKey: ['type-evidence', state.workspace?.id], queryFn: async ({ signal }) => {
    try { return await typeEvidence(state.workspace!.id, AbortSignal.any([signal,AbortSignal.timeout(20000)])); }
    catch(error) { if(error instanceof Error && error.name==='TimeoutError') throw new Error('保存结果读取超过 20 秒，请重新读取。'); throw error; }
  }, retry:false, enabled: !!state.workspace,
    refetchInterval: query => query.state.data?.some(item => pendingRun(item.run)) ? 2000 : false });
}
export function containsArtifact(run: Record<string, unknown>, schema: string) {
  const cases = optionalRecord(run.output).cases;
  return Array.isArray(cases) && cases.some(value => optionalRecord(value).status === 'succeeded' && Object.values(optionalRecord(optionalRecord(value).artifacts)).some(artifact => optionalRecord(artifact).schema === schema));
}
export function chooseEvidence(groups: Awaited<ReturnType<typeof typeEvidence>> | undefined, schema: string, runId?: string, revision?: number) {
  const entries = groups || [];
  const found = runId ? entries.find(item => item.run.id === runId)
    : entries.find(item => ['succeeded', 'partial'].includes(text(item.run.status)) && containsArtifact(item.run, schema) && (revision === undefined || optionalRecord(item.run.snapshot).workspace_revision === revision));
  if (!found) return null;
  const artifact = runArtifact(found.run, schema);
  if (!artifact) throw new Error('所选运行未保存本模块工件');
  return { ...found, artifact };
}
export function artifactRows(artifact: Record<string, unknown>) { return array(artifact.rows, '结果行').map(value => record(value, '结果行')); }
export function currentEvidence(run: Record<string, unknown>, revision: number | undefined, dirty: boolean) {
  return !dirty && run.integrity === 'verified' && ['succeeded', 'partial'].includes(text(run.status)) && run.freshness === 'current' && optionalRecord(run.snapshot).workspace_revision === revision;
}
export function methodLabel(run: Record<string, unknown>) {
  const method = optionalRecord(optionalRecord(run.snapshot).definition).method;
  const pin = optionalRecord(method);
  return [displayName(text(pin.plugin_id), '计算方法'), versionLabel(text(pin.version))].join(' · ');
}

/** 型号浏览器里模块的结果状态：current 有当前结果，stale 有结果但输入已变，none 尚未计算；其余模块不判断。 */
const MODULE_EVIDENCE: Record<string, { schema: string; capability?: string }> = {
  structure: { schema: 'cablesim.cad-model/1' },
  electrical: { schema: 'cablesim.type-analysis/1', capability: 'electrical' },
  'short-circuit': { schema: 'cablesim.type-analysis/1', capability: 'short-circuit' },
  'standard-check': { schema: 'cablesim.standard-check/1' },
  requirements: { schema: 'cablesim.standard-check/1' },
};
export function moduleEvidenceState(groups: Awaited<ReturnType<typeof typeEvidence>> | undefined, module: string, revision: number | undefined, dirty: boolean): 'current' | 'stale' | 'none' | undefined {
  const rule = MODULE_EVIDENCE[module];
  if (!rule || !groups) return undefined;
  const entries = groups.filter(item => item.run.integrity === 'verified' && ['succeeded', 'partial'].includes(text(item.run.status)) && containsArtifact(item.run, rule.schema) && (!rule.capability || optionalRecord(optionalRecord(item.study.definition).method).capability === rule.capability));
  if (!entries.length) return 'none';
  return entries.some(item => currentEvidence(item.run, revision, dirty)) ? 'current' : 'stale';
}

const MODULE_ARTIFACTS: Record<string, string> = { structure: 'x-cablesim.cad-model', electrical: 'x-cablesim.type-electrical', 'short-circuit': 'x-cablesim.type-short-circuit', requirements: 'x-cablesim.standard-check', 'standard-check': 'x-cablesim.standard-check', 'rating-table': 'x-cablesim.iec60287-trace' };
function pendingRun(run: Record<string, unknown>) { return ['accepted', 'running', 'validating', 'queued'].includes(text(run.status)); }
export function latestModuleRun(groups: Awaited<ReturnType<typeof typeEvidence>> | undefined, module: string, methods: Record<string, unknown>[] | undefined) {
  return groups?.filter(({ run, study }) => {
    const definition = optionalRecord(optionalRecord(run.snapshot).definition), pin = optionalRecord(definition.method || optionalRecord(study.definition).method);
    if (module === 'rating-table') {
      const cases = optionalRecord(definition.driver).cases;
      return Array.isArray(cases) && cases.length > 0 && cases.every(c => optionalRecord(optionalRecord(c).metadata).kind === 'type-rating-table');
    }
    const rule = MODULE_EVIDENCE[module]; if (!rule || rule.capability && pin.capability !== rule.capability) return false;
    if (containsArtifact(run, rule.schema)) return true;
    return methods?.some(method => optionalRecord(method.method).plugin_id === pin.plugin_id && Array.isArray(method.capabilities)
      && method.capabilities.some(c => optionalRecord(c).id === pin.capability && Array.isArray(optionalRecord(c).artifacts)
        && (optionalRecord(c).artifacts as unknown[]).some(a => optionalRecord(a).type === MODULE_ARTIFACTS[module])));
  }).sort((a, b) => text(b.run.created).localeCompare(text(a.run.created)))[0]?.run;
}
export function commandResultLabel(value: { kind: StatusKind; label: string }, run?: Record<string, unknown>, dirty = false) {
  if (dirty) return '有未保存修改';
  if (value.kind === 'unknown') return value.label === '未运行' ? '尚未运行' : value.label;
  if (value.kind === 'historical') { const version = text(optionalRecord(optionalRecord(optionalRecord(run?.snapshot).definition).method).version); return '已过期' + (version ? ' · 方法 ' + versionLabel(version) : ''); }
  if (value.kind === 'current' && run?.integrity === 'verified' && ['succeeded', 'partial'].includes(text(run.status))) {
    const date = new Date(text(run.created));
    if (Number.isFinite(date.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `最近运行 ${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} · ${run.status === 'partial' ? '部分成功' : '成功'}`;
    }
  }
  return value.label;
}
export function moduleResultStatus(groups: Awaited<ReturnType<typeof typeEvidence>> | undefined, module: string, revision: number | undefined, dirty: boolean, methods: Record<string, unknown>[] | undefined): { kind: StatusKind; label: string; reason: string } {
  if (module === 'comparison') return { kind: 'unknown', label: '未接入', reason: '方案对比引用各方案的保存结果，尚无独立保存的对照工件状态接口。' };
  if (!groups || !methods) return { kind: 'unknown', label: '未接入', reason: '结果或方法目录尚未读取；当前不能判断本模块结果状态。' };
  const latest = latestModuleRun(groups, module, methods);
  if (latest && optionalRecord(latest.snapshot).workspace_revision === revision) {
    if (pendingRun(latest)) return { kind: 'running', label: '运行中', reason: '正在使用保存输入运行；完成后更新本模块结果。' };
    if (['failed', 'cancelled', 'stopped'].includes(text(latest.status))) return { kind: 'error', label: '失败', reason: text(optionalRecord(latest.error).message) || '最近运行未取得有效结果，请检查方法与输入后重试。' };
  }
  let result = moduleEvidenceState(groups, module, revision, dirty);
  if (module === 'rating-table') {
    const entries = groups.filter(item => {
      const cases = optionalRecord(optionalRecord(optionalRecord(item.run.snapshot).definition).driver).cases, output = optionalRecord(item.run.output).cases;
      return item.run.integrity === 'verified' && ['succeeded', 'partial'].includes(text(item.run.status))
        && Array.isArray(cases) && cases.length > 0 && cases.every(c => optionalRecord(optionalRecord(c).metadata).kind === 'type-rating-table')
        && Array.isArray(output) && output.some(c => optionalRecord(c).status === 'succeeded' && Object.entries(optionalRecord(optionalRecord(c).artifacts)).some(([key, artifact]) => key === 'x-cablesim.iec60287-trace' && Object.keys(optionalRecord(artifact)).length > 0));
    });
    result = entries.length ? entries.some(item => currentEvidence(item.run, revision, dirty)) ? 'current' : 'stale' : 'none';
  }
  if (result === 'current') return { kind: 'current', label: '当前', reason: '保存结果完整性已通过，且对应当前保存输入与方法。' };
  if (result === 'stale') return { kind: 'historical', label: '过期', reason: '已有保存结果；型号输入或方法已变化，需要重新运行。' };
  const artifact = MODULE_ARTIFACTS[module];
  const installed = artifact && methods.some(method => method.platform_supported !== false && Array.isArray(method.capabilities) && method.capabilities.some(c => optionalRecord(c).input_schema === 'cablesim.domain/1' && Array.isArray(optionalRecord(c).artifacts) && (optionalRecord(c).artifacts as unknown[]).some(a => optionalRecord(a).type === artifact)));
  return installed ? { kind: 'unknown', label: '未运行', reason: '已接入可用方法，尚无本模块完整性通过的保存结果。' } : { kind: 'unknown', label: '未接入', reason: '尚无当前平台可用的本模块计算方法；未采用其他模块结果。' };
}
