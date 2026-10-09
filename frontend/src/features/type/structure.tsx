import { useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { NumberField } from '@/components/ui/number-field';
import { EmptyState, ErrorState, StaleBanner } from '@/components/states';
import { CableSection } from '@/features/drawing';
import { targetId } from '@/features/drawing/cable-geometry';
import { at, displayed, fieldSource } from '@/lib/domain-fields';
import { numeric } from '@/api/client';
import { sourceKind } from '@/lib/selection-view';
import { formatNumber } from '@/lib/format';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { layerRows, type LayerRow } from './layers';
import { useTypeWorkspace } from './provider';
import { TypeGeometry } from './geometry';
import { TypeQuantities } from './quantities';
import { cleanLabel } from './labels';
import { StructureActions } from './structure-actions';

export function TypeNumericField({ row }: { row: LayerRow }) {
  const state = useTypeWorkspace(), doc = state.document!, provenance = fieldSource(doc, row.path);
  return <NumberField path={row.path} label={row.spec.label} value={displayed(doc, row.spec)} unit={row.spec.unit} precision={row.spec.precision} min={0} minExclusive required
    error={state.fieldError?.path === row.path ? state.fieldError.message : undefined}
    locked={state.locked(row.path)} disabled={state.busy} draftText={state.draft?.fields[row.path]?.value} onDraftChange={value => state.setField(row.spec, value)}
    onCommit={value => { if (value !== null) state.edit(row.path, value / (row.spec.scale || 1)); }} source={sourceKind(provenance)} sourceDetail={typeof provenance.reference === 'string' ? provenance.reference : undefined} />;
}
export function LayerTable({ rows, selected, onSelect, compact = false }: { rows: LayerRow[]; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void; compact?: boolean }) {
  const state = useTypeWorkspace();
  const selectedId = selected ? targetId(selected) : undefined;
  useEffect(() => {
    const row = selectedId ? document.getElementById(`row-型号分层-${selectedId}`) : null;
    if (row) row.scrollIntoView({ block: row.getBoundingClientRect().bottom > window.innerHeight ? 'center' : 'nearest', inline: 'nearest' });
  }, [selectedId]);
  return <DataTable label="型号分层" selectedId={selected ? targetId(selected) : undefined} onSelect={row => onSelect(row.target)} rowLabel={row => `${row.number} ${row.label}`} showGroups={false}
    groups={[{ id: 'layers', label: '结构层', rows }]} columns={[
      { id: 'number', label: '序号', numeric: true, render: row => row.number },
      { id: 'name', label: '层次', render: row => row.label },
      ...(!compact ? [{ id: 'material', label: '材料', render: (row: LayerRow) => cleanLabel(row.material.label) }] : []),
      { id: 'dimension', label: '尺寸', unit: 'mm', numeric: true, render: row => <div className="type-layer-input" onClick={event => { event.stopPropagation(); onSelect(row.target); }} onFocusCapture={() => onSelect(row.target)}><span className="muted">{row.target.role === 'conductor' ? row.spec.scale === 500 ? '扇高' : '直径' : '厚度'}</span><TypeNumericField row={row} /></div> },
      ...(!compact ? [{ id: 'outer', label: '绘图外径', unit: 'mm', numeric: true, render: (row: LayerRow) => <span className="type-readonly-value">{formatNumber(row.outerM === null ? null : row.outerM * 2000, 2)}{row.outerM !== null && <SourceBadge kind="derived" detail="当前结构尺寸逐层累加的截面绘图尺寸；原始实体与用料见保存的结构推导。" />}</span> }] : []),
      { id: 'source', label: '来源', render: row => { const source = fieldSource(state.document!, row.path), kind = sourceKind(source) || (source.kind === 'demo' ? 'demo' : undefined); return kind ? <span className="type-layer-source"><SourceBadge kind={kind} detail={typeof source.reference === 'string' ? source.reference : undefined} /></span> : <span className="muted">未提供</span>; } },
    ]} />;
}
export function TypeStructure({ tab, cable, selected, onSelect }: { tab: string; cable: CableType | null; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  if (!state.document || !cable) return <EmptyState title="型号没有结构" description="当前型号未提供电缆与结构层。" />;
  let rows: LayerRow[];
  try { rows = layerRows(state.document, cable); } catch (error) { return <ErrorState title="结构不可绘制" description={error instanceof Error ? error.message : String(error)} />; }
  if (tab === 'quantities') return <TypeQuantities cable={cable} />;
  if (tab === 'three') return <div className="type-canvas-frame"><StructureActions cable={cable} selected={selected} onSelect={onSelect} /><TypeGeometry cable={cable} selected={selected} onSelect={onSelect} /></div>;
  const section = <CableSection cableType={cable} materials={state.document.materials} selectedObject={selected} onSelectionChange={onSelect}
    state={state.workspace?.raw.historical ? 'historical' : 'success'} editable={!state.readOnly && !state.busy} showDimensions onCommand={command => { if (command === 'save') void state.save(); if (command === 'undo') void state.undo(); }}
    isLocked={target => { const row = rows.find(row => row.id === targetId(target)); return !row || state.locked(row.path); }}
    onDimensionChange={edit => { const row = rows.find(row => row.id === targetId(edit.target)); if (!row) throw new Error('所选结构层已不存在'); state.edit(row.path, edit.valueM); }} />;
  return <><StructureActions cable={cable} selected={selected} onSelect={onSelect} />{state.workspace?.raw.historical === true && tab === 'table' && <StaleBanner description="历史型号输入保持只读。" />}
    {tab === 'table' ? <LayerTable rows={rows} selected={selected} onSelect={onSelect} /> : <div className="type-structure-split">{section}<LayerTable rows={rows} selected={selected} onSelect={onSelect} compact /></div>}
    {state.dirty && <p className="type-notice">结构修改待保存；已保存的外径、用料和校核结果已标为历史。</p>}
  </>;
}
/** 工作窗口画布：电缆截面（可直接拖改尺寸）或三维剥切，上方是增删结构层的操作。 */
export function TypeCanvas({ view, cable, selected, onSelect }: { view: 'section' | 'three'; cable: CableType | null; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  if (!state.document || !cable) return <EmptyState title="型号没有结构" description="当前型号未提供电缆与结构层。" />;
  let rows: LayerRow[];
  try { rows = layerRows(state.document, cable); } catch (error) { return <ErrorState title="结构不可绘制" description={error instanceof Error ? error.message : String(error)} />; }
  return <div className="type-canvas-frame">
    <StructureActions cable={cable} selected={selected} onSelect={onSelect} />
    {view === 'three' ? <TypeGeometry cable={cable} selected={selected} onSelect={onSelect} /> : <CableSection cableType={cable} materials={state.document.materials} selectedObject={selected} onSelectionChange={onSelect}
      state={state.workspace?.raw.historical ? 'historical' : 'success'} editable={!state.readOnly && !state.busy} showDimensions onCommand={command => { if (command === 'save') void state.save(); if (command === 'undo') void state.undo(); }}
      isLocked={target => { const row = rows.find(row => row.id === targetId(target)); return !row || state.locked(row.path); }}
      onDimensionChange={edit => { const row = rows.find(row => row.id === targetId(edit.target)); if (!row) throw new Error('所选结构层已不存在'); state.edit(row.path, edit.valueM); }} />}
  </div>;
}
export function nominalArea(document: unknown, row: LayerRow): number | null { return row.target.scope === 'core' && row.target.role === 'conductor' ? numeric(at(document, row.path.replace(/diameter$/, 'nominal_area'))) : null; }
