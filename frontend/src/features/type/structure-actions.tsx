import { useState } from 'react';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cableShape, layerNames } from '@/features/drawing/cable-geometry';
import type { CableType, LayerTarget } from '@/features/drawing/types';
import { commitFields, pointer } from '@/lib/domain-fields';
import { useTypeWorkspace } from './provider';

const commonRoles = ['filler', 'bedding', 'separator', 'binder', 'metallic_screen', 'metallic_sheath', 'armour', 'oversheath'];
const coreRoles = ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'metallic_sheath', 'separator', 'binder'];
const measured = ['minimum_thickness', 'maximum_thickness', 'mean_thickness', 'minimum_tape_thickness', 'minimum_overlap', 'mean_wire_diameter'];

export function StructureActions({ cable, selected, onSelect }: { cable: CableType; selected: LayerTarget | null; onSelect: (target: LayerTarget | null) => void }) {
  const state = useTypeWorkspace();
  const [mode, setMode] = useState<'layer' | 'core' | null>(null), [error, setError] = useState('');
  const [scope, setScope] = useState('common'), [role, setRole] = useState(''), [material, setMaterial] = useState('');
  const [form, setForm] = useState('unspecified'), [thickness, setThickness] = useState<number | null>(null);
  const [source, setSource] = useState(cable.cores[0]?.id || ''), [x, setX] = useState<number | null>(null), [z, setZ] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const layers = scope === 'common' ? cable.common_layers : cable.cores.find(core => core.id === scope)?.layers || [];
  const root = pointer('cable_types', cable.id);
  const disabled = state.busy || state.readOnly || state.locked(root);
  const selectedPath = !selected || selected.role === 'conductor' ? '' : selected.scope === 'common'
    ? root + pointer('common_layers', selected.role) : root + pointer('cores', selected.coreId, 'layers', selected.role);
  const childLocked = Array.isArray(state.workspace?.raw.locks) && state.workspace.raw.locks.some(value => typeof value === 'string' && value.startsWith(selectedPath + '/'));
  const deleteReason = state.readOnly ? '此版本只读，请先建立独立方案' : state.busy ? '正在保存或恢复修改' : !selected ? '先在截面或分层表选择结构层'
    : selected.role === 'conductor' ? '导体是线芯的必要结构，可在属性栏编辑' : state.locked(selectedPath) || childLocked ? '所选层含已锁定输入' : '';
  const selectedName = selected ? (selected.scope === 'core' ? `芯 ${cable.cores.findIndex(core => core.id === selected.coreId) + 1} · ` : '') + (layerNames[selected.role] || '结构层') : '';
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
        state.edit(root, updated);
      }
      onSelect(target); setMode(null);
    } catch (failure) { setError(message(failure)); }
  }
  function remove() {
    if (deleteReason || !selected) return;
    try {
      const document = state.draft ? commitFields(state.draft) : state.document!;
      const updated = structuredClone(document.cable_types.find(value => value.id === cable.id)!);
      const list = selected.scope === 'common' ? updated.common_layers : updated.cores.find(core => core.id === selected.coreId)!.layers;
      const index = list.findIndex(layer => layer.role === selected.role);
      if (index < 0) throw new Error('所选层已不存在，请重新选择');
      list.splice(index, 1);
      cableShape(updated, document.materials);
      state.edit(selected.scope === 'common' ? root + '/common_layers' : root + pointer('cores', selected.coreId, 'layers'), list);
      const next = list[Math.min(index, list.length - 1)];
      onSelect(next ? selected.scope === 'common' ? { scope: 'common', role: next.role } : { ...selected, role: next.role }
        : selected.scope === 'core' ? { ...selected, role: 'conductor' } : null);
      setRemoving(false); setError('');
    } catch (failure) { setError(message(failure)); }
  }
  return <><div className="type-result-toolbar" role="toolbar" aria-label="结构编辑">
    <Tooltip content={disabled ? state.readOnly ? '此版本只读，请先建立独立方案' : '当前结构正在保存或已锁定' : '在所选位置添加一层'}><span><Button size="compact" disabled={disabled} onClick={() => open('layer')}>添加结构层</Button></span></Tooltip>
    <Tooltip content={disabled ? '当前结构正在保存、只读或已锁定' : cable.cores.length >= 16 ? '当前几何方法最多支持 16 芯' : '复制设计构造并填写新芯位置'}><span><Button size="compact" disabled={disabled || cable.cores.length >= 16} onClick={() => open('core')}>添加线芯</Button></span></Tooltip>
    <Tooltip content={deleteReason || '删除' + selectedName + '；保存前可撤销'}><span><Button size="compact" disabled={!!deleteReason} onClick={() => { setError(''); setRemoving(true); }}>删除结构层</Button></span></Tooltip>
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
  </Dialog><Dialog open={removing} onOpenChange={setRemoving} title="删除结构层" description={`删除 ${selectedName}。本次修改可撤销；保存后需重新计算受影响的结果。`}
    actions={<Button variant="primary" disabled={!!deleteReason} onClick={remove}>删除</Button>}>
    {error && <p role="alert" className="type-error">{error}</p>}
  </Dialog></>;
}
