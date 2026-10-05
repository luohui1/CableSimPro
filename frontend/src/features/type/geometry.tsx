import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, array, message, optionalRecord, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { CadViewport, type CadModel } from '@/features/cad';
import { commitFields } from '@/lib/domain-fields';
import { useTypeWorkspace } from './provider';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { layerId } from '@/features/cad/geometry-contract';
import { layerRows } from './layers';
import { chooseEvidence } from './evidence';
import { typeEvidence } from './api';
import { methodForArtifact } from './run-control';

export async function geometryMethod(signal?: AbortSignal): Promise<components['schemas']['Method']> {
  return methodForArtifact('x-cablesim.cad-model', signal, 'geometry');
}
function previewModel(value: unknown): CadModel {
  const model = record(value, 'CAD 工件');
  if (model.schema !== 'cablesim.cad-model/1' || model.brep_unit !== 'mm' || model.axis !== '+Z' || !/^[0-9a-f]{64}$/.test(text(model.input_sha256))) throw new ApiError(502, 'CAD 工件契约或输入摘要不完整');
  array(model.layers, 'CAD 结构层');
  return model as unknown as CadModel;
}
export function TypeGeometry({ cable, selected, onSelect }: { cable: CableType; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  const [stable, setStable] = useState(state.document);
  useEffect(() => { const timeout = window.setTimeout(() => { try { setStable(state.draft ? commitFields(state.draft) : state.document); } catch { /* Invalid draft cannot replace the last valid display. */ } }, 300); return () => clearTimeout(timeout); }, [state.document, state.draft]);
  const preview = useQuery({ queryKey: ['type-preview', state.workspace?.id, state.workspace?.revision, cable.id, stable], enabled: !!stable && !!state.workspace && !state.readOnly,
    queryFn: async ({ signal }) => {
      const method = await geometryMethod(signal);
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: stable!, method, parameters: { cable_type_id: cable.id, include_exact: false } }, signal }));
      if (!result || result.effect !== 'preview' || result.base_revision !== state.workspace!.revision) throw new ApiError(409, '几何预览基准与型号输入不一致');
      return { model: previewModel(result.artifacts['x-cablesim.cad-model']), method };
    }, retry: false });
  const saved = useQuery({ queryKey: ['type-historical-preview', state.workspace?.id, state.workspace?.revision], enabled: !!state.workspace && state.readOnly,
    queryFn: async ({ signal }) => {
      if (state.workspace?.raw.historical) {
        const saved = chooseEvidence(await typeEvidence(state.workspace.id, signal), 'cablesim.cad-model/1', undefined, state.workspace.revision);
        if (!saved) throw new ApiError(501, '历史型号未保存 CAD 工件；未以当前输入替代');
        return { model: previewModel(saved.artifact), method: optionalRecord(optionalRecord(saved.run.snapshot).definition).method as components['schemas']['Method'] };
      }
      const method = await geometryMethod(signal);
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: state.document!, method, parameters: { cable_type_id: cable.id, include_exact: false } }, signal }));
      if (!result) throw new ApiError(502, '历史型号预览未返回工件'); return { model: previewModel(result.artifacts['x-cablesim.cad-model']), method };
    }, retry: false });
  const active = state.readOnly ? saved : preview;
  const rows = state.document ? layerRows(state.document, cable) : [];
  const pickedLayer = selected ? active.data?.model.layers.find(layer => layer.role === selected.role) : undefined;
  return <CadViewport geometry={active.data?.model || null} state={active.error ? 'error' : active.isPending ? 'loading' : state.workspace?.raw.historical ? 'historical' : 'success'} error={active.error ? message(active.error) : undefined}
    selectedObject={pickedLayer ? { kind: 'layer', id: layerId(pickedLayer) } : null} onSelectionChange={selection => { const layer = selection ? active.data?.model.layers.find(layer => layerId(layer) === selection.id) : undefined; onSelect(layer ? rows.find(row => row.target.role === layer.role)?.target || null : null); }} onRetry={() => void active.refetch()}
    loadExact={active.data && !state.workspace?.raw.historical ? async (_model, signal) => {
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: stable!, method: active.data!.method, parameters: { cable_type_id: cable.id, include_exact: true } }, signal }));
      if (!result) throw new ApiError(502, '精确几何未返回工件'); return previewModel(result.artifacts['x-cablesim.cad-model']);
    } : undefined} />;
}
