import { memo, useEffect, useMemo, useState } from 'react';
import { prewarmCad } from '@/features/cad';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { NumberField } from '@/components/ui/number-field';
import { EmptyState, ErrorState, StaleBanner, InlineEmpty } from '@/components/states';
import { missingTypeInputs } from './missing';
import { CableSection } from '@/features/drawing';
import { cableShape, targetId } from '@/features/drawing/cable-geometry';
import { displayed, fieldSource } from '@/lib/domain-fields';
import { sourceKind } from '@/lib/selection-view';
import { formatNumber } from '@/lib/format';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { layerRows, type LayerRow } from './layers';
import { useTypeWorkspace } from './provider';
import { TypeGeometry } from './geometry';
import { TypeQuantities } from './quantities';
import { cleanLabel, materialLabel } from './labels';
import { dimensionBasis } from './dimension-basis';
import { StructureActions } from './structure-actions';
import { MaterialResourceCell } from './resource-bindings';
import { MaterialBatchBindings, MaterialBatchDensity } from './material-batch';
import { Checkbox } from '@/components/ui/checkbox';
import { StructureIssue } from './structure-issue';

export function TypeNumericField({ row }: { row: LayerRow }) {
  const state = useTypeWorkspace(), doc = state.document!, provenance = fieldSource(doc, row.path);
  return <NumberField path={row.path} label={row.spec.label} value={displayed(doc, row.spec)} unit={row.spec.unit} precision={row.spec.precision} min={0} minExclusive required
    error={state.fieldError?.path === row.path ? state.fieldError.message : undefined}
    locked={state.locked(row.path)} disabled={state.busy} draftText={state.draft?.fields[row.path]?.value} onDraftChange={value => state.setField(row.spec, value)}
    onCommit={value => { if (value !== null) state.edit(row.path, value / (row.spec.scale || 1)); }} source={sourceKind(provenance)} sourceDetail={dimensionBasis(provenance.reference)} />;
}
export const LayerTable = memo(function LayerTable({ rows, selected, onSelect, compact = false }: { rows: LayerRow[]; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void; compact?: boolean }) {
  const state = useTypeWorkspace();
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const materialIds = [...new Set(rows.map(r => r.material.id))];
  const selectedId = selected ? targetId(selected) : undefined;
  useEffect(() => {
    const row = selectedId ? document.getElementById(`row-型号分层-${selectedId}`) : null;
    if (row) row.scrollIntoView({ block: row.getBoundingClientRect().bottom > window.innerHeight ? 'center' : 'nearest', inline: 'nearest' });
  }, [selectedId]);
  return <>{!compact && <div className="type-material-actions"><MaterialBatchBindings rows={rows} selectedIds={selectedMaterials} /><MaterialBatchDensity rows={rows} selectedIds={selectedMaterials} /></div>}<DataTable label="型号分层" selectedId={selected ? targetId(selected) : undefined} onSelect={row => onSelect(row.target)} rowLabel={row => `${row.number} ${row.label}`} showGroups={false}
    groups={[{ id: 'layers', label: '结构层', rows }]} columns={[
      { id: 'number', label: '序号', numeric: true, render: row => <span className="type-layer-select" onClick={e => e.stopPropagation()}>{!compact && !state.readOnly && <Checkbox aria-label={`选择全部${materialLabel(row.material.label)}层`} checked={selectedMaterials.includes(row.material.id)} onCheckedChange={checked => setSelectedMaterials(current => checked ? [...new Set([...current, row.material.id])] : current.filter(id => id !== row.material.id))} />}{row.number}</span> },
      { id: 'name', label: compact ? '层次' : '层次与材料', wrap: true, render: row => <div className="type-layer-identity"><span>{row.label}</span>{!compact && <MaterialResourceCell id={row.material.id} name={materialLabel(cleanLabel(row.material.label))} />}</div> },
      { id: 'dimension', label: '尺寸', unit: 'mm', numeric: true, render: row => <div className="type-layer-input" onClick={event => { event.stopPropagation(); onSelect(row.target); }} onFocusCapture={() => onSelect(row.target)}><TypeNumericField row={row} /></div> },
      ...(!compact ? [{ id: 'outer', label: '绘图外径', unit: 'mm', numeric: true, render: (row: LayerRow) => <span className="type-readonly-value">{formatNumber(row.outerM === null ? null : row.outerM * 2000, 2)}{row.outerM !== null && <SourceBadge kind="derived" detail="当前结构尺寸逐层累加的截面绘图尺寸；原始实体与用料见保存的结构推导。" />}</span> }] : []),
      { id: 'source', label: '来源', render: row => { const source = fieldSource(state.document!, row.path), kind = sourceKind(source) || (source.kind === 'demo' ? 'demo' : undefined); return kind ? <span className="type-layer-source"><SourceBadge kind={kind} detail={dimensionBasis(source.reference)} /></span> : <span className="muted">未提供</span>; } },
    ]} />{!compact && !state.readOnly && <label className="type-confirm type-material-select-all"><Checkbox checked={selectedMaterials.length === materialIds.length ? true : selectedMaterials.length ? 'indeterminate' : false} onCheckedChange={checked => setSelectedMaterials(checked ? materialIds : [])} />选择全部设计材料{selectedMaterials.length > 0 && ` · ${rows.filter(r => selectedMaterials.includes(r.material.id)).length} 层已选`}</label>}</>;
});
export function TypeStructure({ tab, cable, selected, onSelect }: { tab: string; cable: CableType | null; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  const displayMaterials = useMemo(() => state.document?.materials.map(material => {
    const label = materialLabel(material.label);
    return label === material.label ? material : { ...material, label };
  }) || [], [state.document?.materials]);
  if (!state.document || !cable) return <EmptyState title="型号没有结构" description="当前型号未提供电缆与结构层。" />;
  let rows: LayerRow[];
  try { rows = layerRows(state.document, cable); } catch (error) { return <ErrorState title="结构不可绘制" description={error instanceof Error ? error.message : String(error)} />; }
  if (tab === 'quantities') return <TypeQuantities cable={cable} />;
  if (tab === 'three') return <div className="type-canvas-frame"><StructureActions cable={cable} selected={selected} onSelect={onSelect} /><TypeGeometry cable={cable} selected={selected} onSelect={onSelect} /></div>;
  const incomplete = missingTypeInputs(state.document).some(item => !item.path.includes('/rating/'));
  let diagnostic = ''; if (!incomplete) { try { cableShape(cable, state.document.materials); } catch (error) { diagnostic = error instanceof Error ? error.message : String(error); } }
  const section = incomplete ? <InlineEmpty title="结构尺寸待补齐，请在分层表填写。" /> : diagnostic ? <StructureIssue cable={cable} diagnostic={diagnostic} /> : <CableSection cableType={cable} materials={displayMaterials} selectedObject={selected} onSelectionChange={onSelect}
    state={state.workspace?.raw.historical ? 'historical' : 'success'} editable={!state.readOnly && !state.busy} selectedLayerOnly onCommand={command => { if (command === 'save') void state.save(); if (command === 'undo') void state.undo(); if (command === 'redo') void state.redo(); }}
    isLocked={target => { const row = rows.find(row => row.id === targetId(target)); return !row || state.locked(row.path); }}
    onDimensionChange={edit => { const row = rows.find(row => row.id === targetId(edit.target)); if (!row) throw new Error('所选结构层已不存在'); state.edit(row.path, edit.valueM); }} />;
  return <><StructureActions cable={cable} selected={selected} onSelect={onSelect} />{state.workspace?.raw.historical === true && tab === 'table' && <StaleBanner description="历史型号输入保持只读。" />}
    {tab === 'table' ? <LayerTable rows={rows} selected={selected} onSelect={onSelect} /> : <div className="type-structure-split">{section}<LayerTable rows={rows} selected={selected} onSelect={onSelect} compact /></div>}
  </>;
}
/** 工作窗口画布：电缆截面（可直接拖改尺寸）或三维剥切，上方是增删结构层的操作。 */
export function TypeCanvas({ view, cable, selected, onSelect }: { view: 'section' | 'three'; cable: CableType | null; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  const displayMaterials = useMemo(() => state.document?.materials.map(material => {
    const label = materialLabel(material.label);
    return label === material.label ? material : { ...material, label };
  }) || [], [state.document?.materials]);
  useEffect(() => {
    // A 2D-only visit must not initialize WASM while the table is becoming
    // usable. Prepare CAD immediately when its view is actually requested.
    if (view === 'three') prewarmCad();
  }, [view]);
  if (!state.document || !cable) return <EmptyState title="型号没有结构" description="当前型号未提供电缆与结构层。" />;
  let rows: LayerRow[];
  try { rows = layerRows(state.document, cable); } catch (error) { return <ErrorState title="结构不可绘制" description={error instanceof Error ? error.message : String(error)} />; }
  const incomplete = missingTypeInputs(state.document).some(item => !item.path.includes('/rating/'));
  let diagnostic = ''; if (!incomplete) { try { cableShape(cable, state.document.materials); } catch (error) { diagnostic = error instanceof Error ? error.message : String(error); } }
  return <div className="type-canvas-frame">
    <StructureActions cable={cable} selected={selected} onSelect={onSelect} />
    {incomplete ? <InlineEmpty title="结构尺寸待补齐，请在分层表填写。" /> : view === 'three' ? <TypeGeometry cable={cable} selected={selected} onSelect={onSelect} /> : diagnostic ? <StructureIssue cable={cable} diagnostic={diagnostic} /> : <CableSection cableType={cable} materials={displayMaterials} selectedObject={selected} onSelectionChange={onSelect}
      state={state.workspace?.raw.historical ? 'historical' : 'success'} editable={!state.readOnly && !state.busy} selectedLayerOnly onCommand={command => { if (command === 'save') void state.save(); if (command === 'undo') void state.undo(); if (command === 'redo') void state.redo(); }}
      isLocked={target => { const row = rows.find(row => row.id === targetId(target)); return !row || state.locked(row.path); }}
      onDimensionChange={edit => { const row = rows.find(row => row.id === targetId(edit.target)); if (!row) throw new Error('所选结构层已不存在'); state.edit(row.path, edit.valueM); }} />}
  </div>;
}
