import { useQuery } from '@tanstack/react-query';
import { array, optionalRecord, record, text } from '@/api/client';
import { runArtifact, typeEvidence } from './api';
import { useTypeWorkspace } from './provider';

export function useTypeEvidence() {
  const state = useTypeWorkspace();
  return useQuery({ queryKey: ['type-evidence', state.workspace?.id], queryFn: ({ signal }) => typeEvidence(state.workspace!.id, signal), enabled: !!state.workspace });
}
export function containsArtifact(run: Record<string, unknown>, schema: string) {
  const cases = optionalRecord(run.output).cases;
  return Array.isArray(cases) && cases.some(value => Object.values(optionalRecord(optionalRecord(value).artifacts)).some(artifact => optionalRecord(artifact).schema === schema));
}
export function chooseEvidence(groups: Awaited<ReturnType<typeof typeEvidence>> | undefined, schema: string, runId?: string, revision?: number) {
  const entries = groups || [];
  const found = runId ? entries.find(item => item.run.id === runId)
    : entries.find(item => containsArtifact(item.run, schema) && (revision === undefined || optionalRecord(item.run.snapshot).workspace_revision === revision));
  if (!found) return null;
  const artifact = runArtifact(found.run, schema);
  if (!artifact) throw new Error('所选运行未保存本模块工件');
  return { ...found, artifact };
}
export function artifactRows(artifact: Record<string, unknown>) { return array(artifact.rows, '结果行').map(value => record(value, '结果行')); }
export function currentEvidence(run: Record<string, unknown>, revision: number | undefined, dirty: boolean) {
  return !dirty && run.freshness === 'current' && optionalRecord(run.snapshot).workspace_revision === revision;
}
export function methodLabel(run: Record<string, unknown>) {
  const method = optionalRecord(optionalRecord(run.snapshot).definition).method;
  return [text(optionalRecord(method).plugin_id), text(optionalRecord(method).version)].filter(Boolean).join(' · ');
}
