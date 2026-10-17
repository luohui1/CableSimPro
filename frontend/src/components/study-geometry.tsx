import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, array, message, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { methodCatalog } from '@/api/research';
import type { components } from '@/api/generated/schema';
import type { CadScene } from '@/features/cad';
import { SceneWorkspace } from '@/features/scene';
import type { SectionSelection } from '@/features/drawing';
import { commitFields, type DomainDocument } from '@/lib/domain-fields';
import { useStudy } from './study-provider';

type Prepared = { document: DomainDocument | undefined; revision: number; error: string };

export function StudyGeometry({ document, sectionId, historical, selected, onSelect }: {
  document: DomainDocument;
  sectionId: string;
  historical: boolean;
  selected: SectionSelection;
  onSelect: (selection: SectionSelection) => void;
}) {
  const context = useStudy();
  const prepared = useMemo<Prepared>(() => {
    const revision = context.domainDraft?.revision ?? numeric(context.workspace.revision) ?? 0;
    try {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('工程修订身份不可用。');
      return { document: !historical && context.domainDraft ? commitFields(context.domainDraft) : document, revision, error: '' };
    } catch (problem) {
      return { document: undefined, revision, error: message(problem) };
    }
  }, [document, context.domainDraft, historical, context.workspace.revision]);
  const [stable, setStable] = useState(prepared);
  useEffect(() => {
    const timer = setTimeout(() => setStable(prepared), 300);
    return () => clearTimeout(timer);
  }, [prepared]);
  const settling = stable !== prepared;
  const preview = useQuery({
    queryKey: ['study-scene', context.study.workspace, context.study.id, stable, sectionId, historical],
    enabled: !!sectionId && !!stable.document && !historical && !settling,
    queryFn: async ({ signal }) => {
      if (!stable.document || historical) throw new ApiError(409, '没有可预览的当前工程输入。');
      let method: components['schemas']['Method'] | undefined;
      for (const item of await methodCatalog(signal)) {
        if (item.platform_supported === false) continue;
        const cap = array(item.capabilities, '能力').map(value => record(value, '能力')).find(cap =>
          cap.analysis === 'geometry' && cap.input_schema === 'cablesim.domain/1' &&
          array(cap.artifacts, '工件声明').some(value => optionalRecord(value).type === 'x-cablesim.cad-scene'));
        const pin = optionalRecord(item.method);
        if (cap && text(pin.release_digest)) { method = { ...pin, capability: text(cap.id) } as components['schemas']['Method']; break; }
      }
      if (!method) throw new ApiError(501, '没有当前平台支持的敷设 CAD 能力');
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', {
        params: { path: { wid: context.study.workspace } },
        body: { expected_revision: stable.revision, document: stable.document, method, parameters: { section_id: sectionId, include_exact: false } },
        signal,
      }));
      if (!result || result.effect !== 'preview' || result.base_revision !== stable.revision) throw new ApiError(409, '场景预览与当前输入修订不一致');
      const scene = record(result.artifacts['x-cablesim.cad-scene'], '场景工件');
      if (scene.schema !== 'cablesim.cad-scene/1' || scene.extrusion_axis !== '+Y' || scene.brep_unit !== 'mm' || !/^[a-f0-9]{64}$/.test(text(scene.input_sha256))) throw new ApiError(502, '三维场景契约或输入摘要不完整');
      return scene as unknown as CadScene;
    },
    retry: false,
  });
  const error = historical ? '此固定运行未保存三维场景工件；不能重新计算当前几何冒充历史场景。'
    : prepared.error || (!settling && preview.error ? message(preview.error) : '');
  const pending = settling || preview.isPending || preview.isFetching;
  return <SceneWorkspace
    scene={!error && !pending ? preview.data || null : null}
    source={{ workspace_id: context.study.workspace, study_id: context.study.id, section_id: sectionId, workspace_revision: stable.revision }}
    viewKey={JSON.stringify([context.study.workspace, context.study.id, sectionId, historical ? 'historical' : 'current', 'scene'])}
    state={!sectionId ? 'empty' : error ? 'error' : pending ? 'loading' : 'success'} error={error}
    onRetry={() => void preview.refetch()}
    selected={selected ? { kind: 'object', id: selected.id } : null}
    onSelect={value => {
      const object = preview.data?.objects.find(item => item.id === value?.id);
      onSelect(object && ['cable', 'enclosure', 'backfill', 'soil'].includes(object.kind)
        ? { kind: object.kind as NonNullable<SectionSelection>['kind'], id: object.id } : null);
    }}
  />;
}
