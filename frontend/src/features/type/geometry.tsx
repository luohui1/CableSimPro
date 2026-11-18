import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, array, message, optionalRecord, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { CadViewport, type CadModel } from '@/features/cad';
import { at, commitFields, type DomainDocument } from '@/lib/domain-fields';
import { useTypeWorkspace } from './provider';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { layerId } from '@/features/cad/geometry-contract';
import { layerRows, type LayerRow } from './layers';
import { chooseEvidence } from './evidence';
import { typeEvidence } from './api';
import { methodForArtifact } from './run-control';
import { corrugatedDisplay, hasCorrugatedSheath, sectionEnvelope } from './display-envelope';
import { LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { typePath, useTypeNavigation } from './navigation';
import { downloadBlob } from '@/lib/download';

function matchesTarget(layer: CadModel['layers'][number], target: LayerTarget) {
  const source = layer.source_target;
  return source ? source.scope === target.scope && source.role === target.role
    && (target.scope === 'common' || source.core_id === target.coreId) : layer.role === target.role;
}

export async function geometryMethod(signal?: AbortSignal): Promise<components['schemas']['Method']> {
  return methodForArtifact('x-cablesim.cad-model', signal, 'geometry');
}
function previewModel(value: unknown): CadModel {
  const model = record(value, 'CAD 工件');
  if (model.schema !== 'cablesim.cad-model/1' || model.brep_unit !== 'mm' || model.axis !== '+Z' || !/^[0-9a-f]{64}$/.test(text(model.input_sha256))) throw new ApiError(502, 'CAD 工件契约或输入摘要不完整');
  array(model.layers, 'CAD 结构层');
  return model as unknown as CadModel;
}

type ScreenGeometryIssue = { row: LayerRow; path: string; labels: string[] };
function screenGeometryIssue(error: unknown, input: DomainDocument | undefined, cableId: string, rows: LayerRow[]): ScreenGeometryIssue | null {
  if (!(error instanceof ApiError) || error.status !== 422 || !input) return null;
  const cable = input.cable_types.find(item => item.id === cableId);
  if (!cable) return null;
  let issue: ScreenGeometryIssue | null = null;
  for (const row of rows) {
    if (row.target.role !== 'metallic_screen') continue;
    const root = row.path.slice(0, row.path.lastIndexOf('/')), layer = optionalRecord(at(input, root));
    if (layer.form !== 'tape' || layer.tape_application !== 'helical_overlap') continue;
    // Match the actual entity emitted by the geometry method, including its
    // single-core form. Do not guess a layer from a partial error substring.
    const entity = cable.id + '/' + (row.target.scope === 'core' && cable.cores.length > 1 ? row.target.coreId + '/' : '') + row.target.role;
    const reported = error.message === entity + '.tape_width必须是范围内的正数' ? 'tape_width'
      : error.message === entity + '.overlap：重叠绕包需明确 0–1 的搭盖率' ? 'overlap' : null;
    if (!reported || layer[reported] != null) continue;
    const labels = ([['tape_width', '带宽'], ['overlap', '搭盖比例']] as const)
      .filter(([key]) => layer[key] == null).map(([, label]) => label);
    // An ambiguous entity remains the original error, never another layer.
    if (issue) return null;
    issue = { row, path: root + '/' + reported, labels };
  }
  return issue;
}

export function TypeGeometry({ cable, selected, onSelect }: { cable: CableType; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace(), navigation = useTypeNavigation();
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [viewportMounted, setViewportMounted] = useState(false);
  useEffect(() => {
    // Commit and paint the engineer's table and commands before native GL
    // allocation/tessellation. The pending view still requires a real first draw.
    let second: number | undefined;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setViewportMounted(true)); });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  }, []);
  const [stable, setStable] = useState(state.document);
  useEffect(() => { const timeout = window.setTimeout(() => { try { setStable(state.draft ? commitFields(state.draft) : state.document); } catch { /* Invalid draft cannot replace the last valid display. */ } }, 300); return () => clearTimeout(timeout); }, [state.document, state.draft]);
  const preview = useQuery({ queryKey: ['type-preview', state.workspace?.id, state.workspace?.revision, cable.id, stable], enabled: !!stable && !!state.workspace && !state.readOnly,
    queryFn: async ({ signal }) => {
      const method = await geometryMethod(signal);
      const currentCable = stable!.cable_types.find(value => value.id === cable.id)!;
      if (hasCorrugatedSheath(currentCable)) return { model: await corrugatedDisplay(stable!, currentCable), method };
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: stable!, method, parameters: { cable_type_id: cable.id, include_exact: false } }, signal }));
      if (!result || result.effect !== 'preview' || result.base_revision !== state.workspace!.revision) throw new ApiError(409, '几何预览基准与型号输入不一致');
      return { model: previewModel(result.artifacts['x-cablesim.cad-model']), method };
    }, retry: false, staleTime: Infinity, gcTime: 180000 });
  const saved = useQuery({ queryKey: ['type-historical-preview', state.workspace?.id, state.workspace?.revision], enabled: !!state.workspace && state.readOnly,
    queryFn: async ({ signal }) => {
      if (state.workspace?.raw.historical) {
        const saved = chooseEvidence(await typeEvidence(state.workspace.id, signal), 'cablesim.cad-model/1', undefined, state.workspace.revision);
        if (!saved) throw new ApiError(501, '历史型号未保存 CAD 工件；未以当前输入替代');
        return { model: previewModel(saved.artifact), method: optionalRecord(optionalRecord(saved.run.snapshot).definition).method as components['schemas']['Method'] };
      }
      const method = await geometryMethod(signal);
      if (hasCorrugatedSheath(cable)) return { model: await corrugatedDisplay(state.document!, cable), method };
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: state.document!, method, parameters: { cable_type_id: cable.id, include_exact: false } }, signal }));
      if (!result) throw new ApiError(502, '历史型号预览未返回工件'); return { model: previewModel(result.artifacts['x-cablesim.cad-model']), method };
    }, retry: false });
  const active = state.readOnly ? saved : preview;
  const envelope = useQuery({ queryKey: ['type-section-envelope', cable.id, stable], enabled: !!stable && !hasCorrugatedSheath(cable),
    queryFn: () => sectionEnvelope(stable!, stable!.cable_types.find(value => value.id === cable.id)!), retry: false, staleTime: Infinity });
  const model = active.data?.model || envelope.data;
  const rows = state.document ? layerRows(state.document, cable) : [];
  const pickedLayer = selected ? model?.layers.find(layer => matchesTarget(layer, selected)) : undefined;
  const diagnostic = active.error ? message(active.error) : '';
  const inputIssue = screenGeometryIssue(active.error, state.readOnly ? state.document : stable, cable.id, rows);
  const issueLocked = !!inputIssue && state.locked(inputIssue.path);
  const issueMessage = inputIssue ? `${inputIssue.row.label}的${inputIssue.labels.join('、')}缺失。${state.readOnly ? '所选输入只读，请查看缺项层。' : issueLocked ? '此字段已锁定，请查看缺项层。' : '请在“构造与用料”填写有依据的实际值。'}` : undefined;
  useEffect(() => { setDiagnosticOpen(false); }, [diagnostic, state.workspace?.id, state.workspace?.revision, cable.id]);
  function locateInput() {
    const issue = inputIssue;
    if (!issue || !state.workspace) return;
    const { location } = navigation;
    const query = new URLSearchParams({ layer: issue.row.id, field: issue.path });
    if (location.run) query.set('run', location.run);
    if (location.revision !== undefined) query.set('revision', String(location.revision));
    onSelect({ ...issue.row.target });
    navigation.navigate(typePath(state.workspace.id, 'structure', 'three', location.theme) + '&' + query.toString());
  }
  if (!viewportMounted) return <LoadingState title="正在打开三维视口" />;
  return <><CadViewport hasSavedInput={!!state.workspace} layerLabels="selected" geometry={model || null} state={active.error ? 'error' : active.isPending ? 'loading' : state.workspace?.raw.historical ? 'historical' : 'success'} error={active.error ? issueMessage || diagnostic.replace(/core\/\d+\.layers/g, '线芯结构层') : undefined}
    resultStatus={hasCorrugatedSheath(cable) ? '波纹按等效厚度显示' : !active.data && model ? active.error ? '截面包络 · 原始几何未取得' : '截面包络 · 正在细化；间隙填充待显示' : null}
    selectedObject={pickedLayer ? { kind: 'layer', id: layerId(pickedLayer) } : null} onSelectionChange={selection => { const layer = selection ? model?.layers.find(layer => layerId(layer) === selection.id) : undefined; onSelect(layer ? rows.find(row => matchesTarget(layer, row.target))?.target || null : null); }} onRetry={() => void active.refetch()}
    loadExact={active.data && !hasCorrugatedSheath(cable) && !state.workspace?.raw.historical ? async (_model, signal) => {
      const result = await responseData(api.POST('/api/workspaces/{wid}/geometry-preview', { params: { path: { wid: state.workspace!.id } }, body: { expected_revision: state.workspace!.revision, document: stable!, method: active.data!.method, parameters: { cable_type_id: cable.id, include_exact: true } }, signal }));
      if (!result) throw new ApiError(502, '精确几何未返回工件'); return previewModel(result.artifacts['x-cablesim.cad-model']);
    } : undefined} />
    {inputIssue && <div className="type-geometry-help" role="group" aria-label="三维输入缺项">
      <Button size="compact" onClick={locateInput}>{state.readOnly || issueLocked ? '查看缺项层' : '定位屏蔽层输入'}</Button>
      <Button size="compact" variant="ghost" onClick={() => setDiagnosticOpen(true)}>技术信息</Button>
    </div>}
    <Dialog open={!!inputIssue && diagnosticOpen} onOpenChange={setDiagnosticOpen} title="技术信息" description="几何预览接口返回 HTTP 422。输入条件未满足方法要求，原始几何尚未取得。"
      actions={<Button onClick={() => { if (inputIssue && active.error instanceof ApiError) downloadBlob(new Blob([active.error.message], { type: 'text/plain;charset=utf-8' }), '三维预览原始诊断.txt'); }}>下载原始诊断</Button>}>
      <p className="cell-wrap">{issueMessage}</p>
      <p className="cell-wrap">可下载本次接口返回的原始错误信息，交给工程师或维护人员核对。此操作不修改输入，也不重新运行方法。</p>
    </Dialog>
  </>;
}
