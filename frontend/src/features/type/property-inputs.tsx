import { text } from '@/api/client';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { at, displayed, fieldSource, pointer, type NumericInput } from '@/lib/domain-fields';
import { sourceKind } from '@/lib/selection-view';
import type { LayerRow } from './layers';
import { useTypeWorkspace } from './provider';

function Numeric({ spec, integer }: { spec: NumericInput; integer?: boolean }) {
  const state = useTypeWorkspace(), source = fieldSource(state.document!, spec.path);
  return <NumberField label={spec.label} value={displayed(state.document, spec)} unit={spec.unit} precision={spec.precision} min={spec.min} minExclusive={spec.minExclusive} max={spec.max} required={spec.required} integer={integer}
    error={state.fieldError?.path === spec.path ? state.fieldError.message : undefined}
    locked={state.locked(spec.path)} disabled={state.busy} draftText={state.draft?.fields[spec.path]?.value} onDraftChange={value => state.setField(spec, value)}
    onCommit={value => state.edit(spec.path, value === null ? null : (value - (spec.offset || 0)) / (spec.scale || 1))} source={sourceKind(source)} sourceDetail={text(source.reference) || undefined} />;
}
export function StructurePropertyInputs({ row }: { row: LayerRow }) {
  const state = useTypeWorkspace(), root = row.path.slice(0, row.path.lastIndexOf('/'));
  const conductor = row.target.role === 'conductor', form = text(at(state.document, root + '/form'));
  const field = (key: string, label: string, unit: string, scale = 1, precision = 3, required = false, min = 0): NumericInput => ({ path: root + '/' + key, label, unit, scale, precision, required, min, minExclusive: min === 0 });
  return <>
    <details className="type-property-detail"><summary>构造与用料</summary><div className="type-property-fields">
      <Select label={conductor ? '导体构造' : '层构造'} value={form || 'unspecified'} disabled={state.busy || state.locked(root + '/form')}
        options={(conductor ? [['unspecified', '未给定'], ['solid_round', '实心圆形'], ['stranded_round', '圆绞合'], ['stranded_round_compacted', '紧压圆形'], ['segmental', '分割导体'], ['sectoral', '扇形'], ['hollow', '中空圆形']] : [['unspecified', '未给定'], ['smooth', '平滑层'], ['wires', '丝层'], ['tape', '带层'], ['corrugated', '波纹层']]).map(([value, label]) => ({ value, label }))}
        onChange={value => state.edit(root + '/form', value)} />
      {conductor && <><Numeric spec={field('nominal_area', '标称截面', 'mm²', 1e6, 1, true)} /><Numeric spec={field('r20', '20 °C 导体电阻', 'Ω/km', 1000, 5)} /></>}
      {['stranded_round', 'wires'].includes(form) && <><Numeric integer spec={field('wire_count', '单丝根数', '根', 1, 0, true, 1)} /><Numeric spec={field('wire_diameter', '单丝直径', 'mm', 1000, 3, true)} /><Numeric spec={field('lay_length', '绞距', 'mm', 1000, 2, true)} /></>}
      {conductor && ['stranded_round_compacted', 'segmental'].includes(form) && <Numeric spec={field('lay_factor', '导体用料绞入系数', '1', 1, 4, false, 1)} />}
      {!conductor && form === 'tape' && <><Numeric spec={field('tape_width', '带宽', 'mm', 1000, 2, true)} /><Numeric spec={{ ...field('overlap', '搭盖比例', '%', 100, 1, true), minExclusive: false, max: 100 }} /><Numeric spec={field('lay_length', '带层节距', 'mm', 1000, 2)} /></>}
      {conductor && form === 'hollow' && <Numeric spec={field('inner_diameter', '导体内径', 'mm', 1000, 3, true)} />}
    </div></details>
    <details className="type-property-detail"><summary>材料参数</summary><div className="type-property-fields">
      <Numeric spec={{ path: pointer('materials', row.material.id, 'density'), label: '材料密度', unit: 'kg/m³', precision: 1, min: 0, minExclusive: true }} />
    </div></details>
  </>;
}
