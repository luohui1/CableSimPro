import { useState } from 'react';
import { ApiError, message, numeric, optionalRecord, record, text, array } from '@/api/client';
import { CommandAction } from './command-slot';
import { DataTable } from '@/components/data-table';
import { InlineEmpty, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { SourceBadge } from '@/components/source-badge';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import type { CableType } from '@/features/drawing/types';
import { useTypeWorkspace } from './provider';
import { chooseEvidence, currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { typePath, useTypeNavigation } from './navigation';
import { TypeRunControl } from './run-control';
import { geometryMethod } from './geometry';
import { layerRows } from './layers';
import { cleanLabel } from './labels';
import { useTypeInspector } from './inspector';
import { quantityLayer, quantityMissingInputs } from './quantity-inputs';
import { SavedRunPicker } from './saved-run-picker';

type QuantityRow = Record<string, unknown> & { id: string };
export function TypeQuantities({ cable }: { cable: CableType }) {
  const state = useTypeWorkspace(), evidence = useTypeEvidence(), navigation = useTypeNavigation(), inspector = useTypeInspector();
  const [running, setRunning] = useState(false), [selected, setSelected] = useState('');
  let saved: ReturnType<typeof chooseEvidence> = null, layers: QuantityRow[] = [], error = '';
  try {
    saved = chooseEvidence(evidence.data, 'cablesim.cad-model/1', navigation.location.run, navigation.location.revision);
    if (saved) {
      if (!(numeric(saved.artifact.length_m)! > 0) || !(numeric(saved.artifact.outer_diameter_m)! > 0) || saved.artifact.cable_type_id !== cable.id) throw new ApiError(502, '结构工件缺少有效长度、外径或对应型号');
      layers = array(saved.artifact.layers, '结构推导层').map((value, index) => {
        const layer = record(value, '结构推导层');
        if (!text(layer.label) || !(numeric(layer.outer_radius_m)! > 0) || !Array.isArray(layer.quantity_missing)) throw new ApiError(502, '结构层缺少尺寸、名称或缺项声明');
        return { ...layer, id: String(index) };
      });
    }
  } catch (failure) { error = message(failure); }
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.inputDirty);
  const source = saved ? methodLabel(saved.run) + '；保存实体积分与输入快照' : '';
  const inputs = layerRows(state.document!, cable);
  function locate(layer: typeof inputs[number], field?: string) {
    navigation.navigate(typePath(state.workspace!.id, 'structure', 'table', navigation.location.theme) + '&layer=' + encodeURIComponent(layer.id) + (field ? '&field=' + encodeURIComponent(field) : ''));
  }
  function choose(row: QuantityRow) {
    setSelected(row.id);
    const layer = quantityLayer(inputs, row);
    const missing = layer ? quantityMissingInputs(state.document!, layer, row.quantity_missing) : [];
    inspector.show(cleanLabel(text(row.label)), [{ label: '保存推导', items: [
      { label: '外径', value: formatNumber(numeric(row.outer_radius_m)! * 2000, 2), unit: 'mm', source: 'derived', sourceDetail: source },
      { label: '建模长度', value: formatNumber(numeric(saved!.artifact.length_m), 3), unit: 'm' },
      { label: '材料体积', value: row.material_volume_m3 == null ? '缺项' : formatNumber(numeric(row.material_volume_m3), 6), unit: 'm³', source: 'derived' },
      { label: '单位长度用料', value: row.mass_kg_per_km == null ? '缺项' : formatNumber(numeric(row.mass_kg_per_km), 2), unit: 'kg/km', source: 'derived' },
      { label: '依据', value: text(row.quantity_basis) || text(row.representation) || '实体积分' },
      { label: '缺项', value: (row.quantity_missing as string[]).join('、') || '无' },
    ] }, ...(layer ? [{ label: '修正输入', items: missing.length ? missing.map(item => ({ label: item.label, value: <Button variant="ghost" size="compact" onClick={() => locate(layer, item.path)}>定位字段</Button> })) : [{ label: '结构层', value: <Button variant="ghost" size="compact" onClick={() => locate(layer)}>定位结构层</Button> }] }] : [])]);
  }
  const bodyState = running || evidence.isPending ? 'loading' : error || evidence.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  return <div className="type-page" data-type-page="quantities" data-type-state={bodyState}>
    <CommandAction><TypeRunControl channel="geometry" label="更新结构推导" onBusy={setRunning} locateIssue={reason => {
      const layer = inputs.find(row => reason.includes('波纹') && row.target.role === 'metallic_sheath');
      return layer ? <Button size="compact" onClick={() => locate(layer)}>定位金属护套</Button> : null;
    }} definition={async () => ({ title: state.document!.name + ' · 结构推导', input_source: 'domain', method: await geometryMethod(), parameters: { cable_type_id: cable.id } })} /></CommandAction>
    {saved && <div className="type-result-toolbar"><SavedRunPicker schema="cablesim.cad-model/1" /></div>}
    {bodyState === 'loading' ? <LoadingState title="正在读取或推导实体用料" /> : bodyState === 'error' ? <ErrorState title="结构推导不可用" description={error || message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取</Button>} /> : !saved ? <InlineEmpty title="尚无保存的结构推导，使用命令栏更新。" /> : <>
      {!current && <StaleBanner description="以下为历史推导；保存修改后点击“更新结构推导”。" />}
      <div className="type-result-summary"><span>成品外径 <strong>{formatNumber(numeric(saved.artifact.outer_diameter_m)! * 1000, 2)}</strong><span className="unit">mm</span></span>
        <span>理论用料 <strong>{saved.artifact.mass_kg_per_km == null ? '缺项' : formatNumber(numeric(saved.artifact.mass_kg_per_km), 2)}</strong><span className="unit">kg/km</span></span>
        <span>建模长度 {formatNumber(numeric(saved.artifact.length_m), 3)} m</span><SourceBadge kind="derived" detail={source} /></div>
      <DataTable label="外径与用料" selectedId={selected} onSelect={choose} showGroups={false} groups={[{ id: 'layers', label: '结构推导', rows: layers }]} rowLabel={row => cleanLabel(text(row.label))} columns={[
        { id: 'layer', label: '层次', render: row => cleanLabel(text(row.label)) },
        { id: 'outer', label: '实体外径', unit: 'mm', numeric: true, render: row => formatNumber(numeric(row.outer_radius_m)! * 2000, 2) },
        { id: 'volume', label: '材料体积', unit: 'm³', numeric: true, render: row => row.material_volume_m3 == null ? '缺项' : formatNumber(numeric(row.material_volume_m3), 6) },
        { id: 'mass', label: '单位长度用料', unit: 'kg/km', numeric: true, render: row => row.mass_kg_per_km == null ? '缺项' : formatNumber(numeric(row.mass_kg_per_km), 2) },
        { id: 'basis', label: '依据与缺项', wrap: true, render: row => (row.quantity_missing as string[]).length ? (row.quantity_missing as string[]).join('、') : text(row.quantity_basis) || '保存的实体积分' },
      ]} />
      <details className="type-meta"><summary>范围与近似</summary><ul>{array(optionalRecord(saved.run.output).limitations, '方法范围').map((item, index) => <li key={index}>{String(item)}</li>)}</ul></details>
    </>}
  </div>;
}
