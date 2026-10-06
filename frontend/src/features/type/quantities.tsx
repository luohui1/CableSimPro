import { message, numeric, optionalRecord, record, text, array } from '@/api/client';
import { CommandAction } from './command-slot';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { SourceBadge } from '@/components/source-badge';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import type { CableType } from '@/features/drawing/types';
import { useTypeWorkspace } from './provider';
import { chooseEvidence, currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { useTypeNavigation } from './navigation';
import { TypeRunControl } from './run-control';
import { geometryMethod } from './geometry';
import { layerNames } from '@/features/drawing/cable-geometry';

export function TypeQuantities({ cable }: { cable: CableType }) {
  const state = useTypeWorkspace(), evidence = useTypeEvidence(), { location } = useTypeNavigation();
  if (evidence.isPending) return <LoadingState title="正在读取结构推导" />;
  if (evidence.error) return <ErrorState title="结构推导读取失败" description={message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取</Button>} />;
  let saved;
  try { saved = chooseEvidence(evidence.data, 'cablesim.cad-model/1', location.run, location.revision); }
  catch (error) { return <ErrorState title="结构结果不可用" description={message(error)} />; }
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.dirty);
  const source = saved ? methodLabel(saved.run) + '；已保存原始实体与输入快照' : '';
  const layers: (Record<string, unknown> & { id: string })[] = saved ? array(saved.artifact.layers, '结构推导层').map((value, index) => ({ ...record(value, '结构推导层'), id: String(index) })) : [];
  return <div className="type-page" data-type-page="quantities" data-type-state={saved ? current ? 'success' : 'historical' : 'empty'}>
    <CommandAction><TypeRunControl channel="geometry" label="更新结构推导" definition={async () => ({ title: state.document!.name + ' · 结构推导', input_source: 'domain', method: await geometryMethod(), parameters: { cable_type_id: cable.id } })} /></CommandAction>
    {saved && !current && <StaleBanner description="结构输入或方法已变化；此处保留原运行结果。" />}
    {!saved ? <EmptyState title="尚无保存的结构推导" description="更新结构推导后查看原始实体外径、体积与用料。" /> : <>
      <div className="type-result-summary"><span>成品外径 <strong>{formatNumber(numeric(saved.artifact.outer_diameter_m) === null ? null : numeric(saved.artifact.outer_diameter_m)! * 1000, 2)}</strong><span className="unit">mm</span></span>
        <span>理论用料 <strong>{formatNumber(numeric(saved.artifact.mass_kg_per_km), 2)}</strong><span className="unit">kg/km</span></span><SourceBadge kind="derived" detail={source} /></div>
      <DataTable label="外径与用料" showGroups={false} groups={[{ id: 'layers', label: '结构推导', rows: layers }]} rowLabel={row => layerNames[text(row.role)] || text(row.label) || '结构层'} columns={[
        { id: 'layer', label: '层次', render: row => layerNames[text(row.role)] || text(row.label) || '结构层' },
        { id: 'outer', label: '原始实体外径', unit: 'mm', numeric: true, render: row => formatNumber(numeric(row.outer_radius_m) === null ? null : numeric(row.outer_radius_m)! * 2000, 2) },
        { id: 'volume', label: '材料体积', unit: 'm³', numeric: true, render: row => formatNumber(numeric(row.material_volume_m3), 6) },
        { id: 'mass', label: '理论用料', unit: 'kg/km', numeric: true, render: row => formatNumber(numeric(row.mass_kg_per_km), 2) },
        { id: 'basis', label: '依据与缺项', wrap: true, render: row => Array.isArray(row.quantity_missing) && row.quantity_missing.length ? row.quantity_missing.join('、') : text(row.quantity_basis) || text(row.representation) || '保存的实体积分' },
        { id: 'source', label: '来源', render: () => <SourceBadge kind="derived" detail={source} /> },
      ]} />
      <details className="type-meta"><summary>范围与近似</summary><ul>{array(optionalRecord(saved.run.output).limitations, '方法范围').map((item, index) => <li key={index}>{String(item)}</li>)}</ul></details>
    </>}
  </div>;
}
