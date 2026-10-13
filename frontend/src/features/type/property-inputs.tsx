import { text } from '@/api/client';
import { NumberField } from '@/components/ui/number-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { at, displayed, fieldSource, pointer, type NumericInput } from '@/lib/domain-fields';
import { sourceKind } from '@/lib/selection-view';
import type { LayerRow } from './layers';
import { useTypeWorkspace } from './provider';
import { DensityInput } from './density-input';

function Numeric({ spec, integer }: { spec: NumericInput; integer?: boolean }) {
  const state = useTypeWorkspace(), source = fieldSource(state.document!, spec.path);
  return <NumberField path={spec.path} label={spec.label} value={displayed(state.document, spec)} unit={spec.unit} precision={spec.precision} min={spec.min} minExclusive={spec.minExclusive} max={spec.max} required={spec.required} integer={integer}
    error={state.fieldError?.path === spec.path ? state.fieldError.message : undefined}
    locked={state.locked(spec.path)} disabled={state.busy} draftText={state.draft?.fields[spec.path]?.value} onDraftChange={value => state.setField(spec, value)}
    onCommit={value => state.edit(spec.path, value === null ? null : (value - (spec.offset || 0)) / (spec.scale || 1))} source={sourceKind(source)} sourceDetail={text(source.reference) || undefined} />;
}
export function TypeRatingInputs() {
  const state = useTypeWorkspace(), cable = state.document!.cable_types[0];
  return <div className="type-property-fields" aria-label="额定电压输入">{(['u0', 'u'] as const).map(key => <Numeric key={key} spec={{ path: pointer('cable_types', cable.id, 'rating', key), label: key === 'u0' ? '额定电压 U₀' : '额定电压 U', unit: 'kV', scale: .001, precision: 1, required: true, min: 0, minExclusive: true }} />)}</div>;
}
export function StructurePropertyInputs({ row }: { row: LayerRow }) {
  const state = useTypeWorkspace(), root = row.path.slice(0, row.path.lastIndexOf('/'));
  const conductor = row.target.role === 'conductor', form = text(at(state.document, root + '/form'));
  const field = (key: string, label: string, unit: string, scale = 1, precision = 3, required = false, min = 0): NumericInput => ({ path: root + '/' + key, label, unit, scale, precision, required, min, minExclusive: min === 0 });
  return <>
    <details className="type-property-detail"><summary>构造与用料</summary><div className="type-property-fields">
      <Select label={conductor ? '导体构造' : '层构造'} value={form || 'unspecified'} disabled={state.busy || state.locked(root + '/form')}
        options={(conductor ? [['unspecified', '未给定'], ['solid_round', '实心圆形'], ['stranded_round', '圆绞合'], ['stranded_round_compacted', '紧压圆形'], ['segmental', '分割导体'], ['sectoral', '扇形'], ['hollow', '中空圆形']] : [['unspecified', '未给定'], ['smooth', '平滑层'], ['wires', '丝层'], ['tape', '带层'], ['corrugated', '波纹层']]).map(([value, label]) => ({ value, label }))}
        onChange={value => { state.edit(root + '/form', value); if (conductor && value !== 'sectoral') { state.edit(root + '/sector_angle_deg', null); state.edit(root + '/sector_rotation_deg', null); } if (!conductor && value !== 'tape') state.edit(root + '/padding_thickness', null); }} />
      {conductor && <><Numeric spec={field('nominal_area', '标称截面', 'mm²', 1e6, 1, true)} /><Numeric spec={field('r20', '20 °C 导体电阻', 'Ω/km', 1000, 5)} /></>}
      {['stranded_round', 'wires'].includes(form) && <><Numeric integer spec={field('wire_count', '单丝根数', '根', 1, 0, true, 1)} /><Numeric spec={field('wire_diameter', '单丝直径', 'mm', 1000, 3, true)} /><Numeric spec={field('lay_length', '绞距', 'mm', 1000, 2, true)} /></>}
      {conductor && ['stranded_round_compacted', 'segmental', 'sectoral'].includes(form) && <Numeric spec={field('lay_factor', '导体用料绞入系数', '—', 1, 4, false, 1)} />}
      {conductor && form === 'sectoral' && <><Numeric spec={{ ...field('sector_angle_deg', '扇形夹角', '°', 1, 1, true), max: 180 }} />
        <Numeric spec={{ ...field('sector_rotation_deg', '扇形朝向', '°', 1, 1, true, -360), max: 360 }} /></>}
      {!conductor && form === 'tape' && <><Select path={root + '/tape_application'} label="绕包方式" value={text(at(state.document, root + '/tape_application')) || 'unspecified'}
        disabled={state.busy || state.locked(root + '/tape_application')} options={[{ value: 'unspecified', label: '未给定' }, { value: 'helical_overlap', label: '单带搭盖绕包' }, { value: 'two_tape_gap', label: '双带间隙绕包' }, { value: 'longitudinal', label: '纵包' }]}
        onChange={value => state.edit(root + '/tape_application', value === 'unspecified' ? null : value)} />
        <Numeric spec={field('nominal_tape_thickness', '单带标称厚度', 'mm', 1000, 3, ['armour', 'metallic_screen'].includes(row.target.role))} />
        <Numeric integer spec={field('tape_count', '带材层数', '层', 1, 0, true, 1)} /><Numeric spec={field('tape_width', '带宽', 'mm', 1000, 2, true)} />
        {text(at(state.document, root + '/tape_application')) === 'two_tape_gap'
          ? <Numeric spec={{ ...field('tape_gap', '最大轴向间隙', 'mm', 1000, 2, true), minExclusive: false }} />
          : <Numeric spec={{ ...field('overlap', '搭盖比例', '%', 100, 1, true), minExclusive: false, max: 99.9 }} />}
        <Numeric spec={field('lay_length', '带层节距', 'mm', 1000, 2)} />
        {row.target.role === 'bedding' && <Numeric spec={{ ...field('padding_thickness', '所含附加垫层厚度', 'mm', 1000, 2), minExclusive: false }} />}
      </>}
      {!conductor && form === 'wires' && <Numeric spec={{ ...field('reverse_binder_thickness', '反向扎带厚度（无则填0）', 'mm', 1000, 3, row.target.role === 'armour'), minExclusive: false }} />}
      {conductor && form === 'hollow' && <Numeric spec={field('inner_diameter', '导体内径', 'mm', 1000, 3, true)} />}
      {conductor && row.target.scope === 'core' && <>{['x', 'z'].map(axis => <Numeric key={axis} spec={{
        path: root.slice(0, root.lastIndexOf('/')) + '/' + axis,
        label: `芯位置 ${axis}`, unit: 'mm', scale: 1000, precision: 3, required: true }} />)}</>}
    </div></details>
    <details className="type-property-detail"><summary>材料参数</summary><div className="type-property-fields">
      <label>材料名称<Input aria-label="材料名称" value={row.material.label} disabled={state.readOnly || state.busy || state.locked(pointer('materials', row.material.id, 'label'))}
        onChange={event => { if (event.target.value.trim()) state.edit(pointer('materials', row.material.id, 'label'), event.target.value); }} /></label>
      <Select label="材料标准类别" value={text(at(state.document, pointer('materials', row.material.id, 'standard_kind'))) || 'unspecified'}
        disabled={state.busy || state.locked(pointer('materials', row.material.id, 'standard_kind'))}
        options={[['unspecified', '未给定'], ['copper_bare', '裸铜'], ['copper_coated', '镀层铜'], ['aluminium', '铝'], ['aluminium_alloy', '铝合金'], ['steel_galvanized', '镀锌钢'], ['steel_stainless_nonmagnetic', '非磁性不锈钢'], ['lead', '铅'], ['XLPE', '交联聚乙烯'], ['PVC', '聚氯乙烯'], ['EPR', '乙丙橡胶'], ['HEPR', '硬乙丙橡胶'], ['other', '其他']].map(([value, label]) => ({ value, label }))}
        onChange={value => state.edit(pointer('materials', row.material.id, 'standard_kind'), value === 'unspecified' ? null : value)} />
      <DensityInput materialId={row.material.id} />
    </div></details>
  </>;
}
