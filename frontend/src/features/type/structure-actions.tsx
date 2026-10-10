import { useState } from 'react';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { cableShape, layerNames } from '@/features/drawing/cable-geometry';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { commitFields, pointer } from '@/lib/domain-fields';
import { useTypeWorkspace } from './provider';

const commonRoles = ['filler', 'bedding', 'separator', 'binder', 'metallic_screen', 'metallic_sheath', 'armour', 'oversheath'];
const coreRoles = ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'metallic_sheath', 'separator', 'binder'];
const measured = ['minimum_thickness', 'maximum_thickness', 'mean_thickness', 'minimum_tape_thickness', 'minimum_overlap', 'mean_wire_diameter'];

export function StructureActions({ cable, selected, onSelect }: { cable: CableType; selected: LayerTarget | null; onSelect: (target: LayerTarget) => void }) {
  const state = useTypeWorkspace();
  const [mode, setMode] = useState<'layer' | 'core' | null>(null), [error, setError] = useState('');
  const [scope, setScope] = useState('common'), [role, setRole] = useState(''), [material, setMaterial] = useState('');
  const [form, setForm] = useState('unspecified'), [thickness, setThickness] = useState<number | null>(null);
  const [source, setSource] = useState(cable.cores[0]?.id || ''), [x, setX] = useState<number | null>(null), [z, setZ] = useState<number | null>(null);
  const layers = scope === 'common' ? cable.common_layers : cable.cores.find(core => core.id === scope)?.layers || [];
  const root = pointer('cable_types', cable.id);
  const disabled = state.busy || state.readOnly || state.locked(root);
  function open(next: 'layer' | 'core') {
    setError(''); setMode(next); setScope(selected?.scope === 'core' ? selected.coreId : 'common');
    setRole(''); setMaterial(''); setForm('unspecified'); setThickness(null); setX(null); setZ(null);
    setSource(selected?.scope === 'core' ? selected.coreId : cable.cores[0].id);
  }
  function commit() {
    try {
      const document = state.draft ? commitFields(state.draft) : state.document!;
      const updated = structuredClone(document.cable_types.find(value => value.id === cable.id)!);
      let target: LayerTarget;
      if (mode === 'layer') {
        if (!role || !material || !Number.isFinite(thickness) || thickness! <= 0) throw new Error('请选择结构层、材料并填写正厚度。');
        const list = scope === 'common' ? updated.common_layers : updated.cores.find(core => core.id === scope)!.layers;
        if (list.some(layer => layer.role === role)) throw new Error('该位置已存在相同结构层，请编辑已有层。');
        const layer: CableType['common_layers'][number] = { role: role as CableType['common_layers'][number]['role'], material, thickness: thickness! / 1000, form: form as CableType['common_layers'][number]['form'] };
        const selectedAt = selected && (selected.scope === 'common' ? scope === 'common' : scope === selected.coreId)
          ? list.findIndex(value => value.role === selected.role) : -1;
        const outerAt = list.findIndex(value => value.role === 'oversheath');
        const index = role === 'filler' ? 0 : selectedAt >= 0 ? selectedAt : outerAt >= 0 ? outerAt : list.length;
        list.splice(index, 0, layer);
        target = scope === 'common' ? { scope: 'common', role } : { scope: 'core', coreId: scope, role };
      } else {
        if (!source || !Number.isFinite(x) || !Number.isFinite(z)) throw new Error('请选择模板线芯并填写芯位置 x / z，单位 mm。');
        if (updated.cores.length >= 16) throw new Error('当前 CAD 支持最多16芯。');
        const core = structuredClone(updated.cores.find(value => value.id === source)!);
        core.id = 'core/' + crypto.randomUUID(); core.x = x! / 1000; core.z = z! / 1000;
        for (const layer of core.layers) for (const key of measured) delete (layer as Record<string, unknown>)[key];
        if (core.conductor.r20_basis !== 'design') { core.conductor.r20 = null; core.conductor.r20_basis = null; }
        updated.cores.push(core); updated.construction = updated.cores.length === 3 ? 'three_core' : 'multi_core';
        target = { scope: 'core', coreId: core.id, role: 'conductor' };
      }
      cableShape(updated, document.materials);
      if (mode === 'layer') {
        state.edit(scope === 'common' ? root + '/common_layers' : root + pointer('cores', scope, 'layers'),
          scope === 'common' ? updated.common_layers : updated.cores.find(core => core.id === scope)!.layers);
      } else {
        state.edit(root + '/cores', updated.cores);
        state.edit(root + '/construction', updated.construction);
      }
      onSelect(target); setMode(null);
    } catch (failure) { setError(message(failure)); }
  }
  return <><div className="type-result-toolbar" role="toolbar" aria-label="结构编辑">
    <Button size="compact" disabled={disabled} onClick={() => open('layer')}>添加结构层</Button>
    <Button size="compact" disabled={disabled || cable.cores.length >= 16} onClick={() => open('core')}>添加线芯</Button>
  </div><Dialog open={mode !== null} onOpenChange={open => { if (!open) setMode(null); }} initialFocus="form"
    title={mode === 'core' ? '添加线芯' : '添加结构层'} description={mode === 'core' ? '复制所选芯的设计构造；实测值不复制。填写新芯的圆心坐标。' : '新层插入所选层之前；未选层时插入外护套之前。构造参数可在属性栏补齐。'}
    actions={<Button variant="primary" onClick={commit} disabled={disabled}>添加到草稿</Button>}>
    <div className="type-create-fields">{mode === 'core' ? <>
      <Select label="模板线芯" value={source} options={cable.cores.map((core, index) => ({ value: core.id, label: `芯 ${index + 1}` }))} onChange={setSource} />
      <NumberField label="新芯位置 x" value={x} unit="mm" precision={3} required onCommit={setX} />
      <NumberField label="新芯位置 z" value={z} unit="mm" precision={3} required onCommit={setZ} />
    </> : <>
      <Select label="所属位置" value={scope} options={[{ value: 'common', label: '共同层' }, ...cable.cores.map((core, index) => ({ value: core.id, label: `芯 ${index + 1}` }))]} onChange={value => { setScope(value); setRole(''); }} />
      <Select label="结构层" value={role} options={(scope === 'common' ? [...(cable.cores.length === 1 ? coreRoles : []), ...commonRoles] : coreRoles)
        .filter((value, index, array) => array.indexOf(value) === index).map(value => ({ value, label: layerNames[value], disabled: layers.some(layer => layer.role === value) }))} onChange={setRole} />
      <Select label="新层材料" value={material} options={state.document!.materials.filter(value => !['soil', 'backfill', 'duct', 'concrete', 'fluid'].includes(value.category)).map(value => ({ value: value.id, label: value.label }))} onChange={setMaterial} />
      <NumberField label="新层厚度" value={thickness} unit="mm" precision={3} required min={0} minExclusive onCommit={setThickness} />
      <Select label="新层构造" value={form} options={[['unspecified', '未给定'], ['smooth', '挤包或连续层'], ['tape', '带层'], ['wires', '丝层']].map(([value, label]) => ({ value, label }))} onChange={setForm} />
    </>}{error && <p role="alert" className="type-error">{error}</p>}</div>
  </Dialog></>;
}
