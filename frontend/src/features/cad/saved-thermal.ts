import { array, numeric, optionalRecord, text } from '@/api/client';
import { savedDomain } from '@/lib/domain-fields';
import { temperatureView } from '@/lib/temperature-view';
import { sectionGeometry } from '../drawing/section-geometry';
import { turbo } from '../field/colormap';
import { fieldColor } from './difference-colormap';
import { savedRunLabel } from '../field/run-label';
import { sceneIdentity } from './input-scene';
import type { DomainDocument } from '../drawing/types';
import type { CadScene, CadThermal } from './types';

export function latestSavedRun(runs: Record<string, unknown>[], pinned?: string) {
  if (pinned) return runs.find(r => r.id === pinned);
  return runs.filter(r => ['succeeded', 'partial'].includes(text(r.status)) && r.integrity === 'verified')
    .sort((a, b) => (numeric(a.sequence) || 0) - (numeric(b.sequence) || 0)
      || text(a.created).localeCompare(text(b.created))).at(-1);
}

export function savedThermal(run: Record<string, unknown>, document: DomainDocument, sectionId: string, preferredCase?: string): CadThermal | undefined {
  if (run.integrity !== 'verified' || !['succeeded', 'partial'].includes(text(run.status)))
    throw new Error('保存运行尚未通过完整性校验；仅显示几何。');
  const field = temperatureView(run, preferredCase);
  const cases = array(optionalRecord(run.output).cases, '保存工况').map(optionalRecord);
  const chosen = field?.case || cases.find(c => c.case_id === preferredCase) || cases[0];
  if (!chosen) return undefined;
  const savedCase = (Array.isArray(optionalRecord(run.snapshot).cases) ? optionalRecord(run.snapshot).cases as unknown[] : [])
    .map(optionalRecord).find(c => c.case_id === chosen.case_id);
  const saved = optionalRecord(savedCase?.input || savedDomain(run)) as unknown as DomainDocument;
  if (saved.schema_version !== 'cablesim.domain/1' || sceneIdentity(saved, sectionId) !== sceneIdentity(document, sectionId))
    throw new Error('保存温度对应其他输入；历史结果未叠加。');
  if (field && field.section?.id !== sectionId) throw new Error('保存温度场对应其他截面；未叠加。');
  const rows = (Array.isArray(chosen.results) ? chosen.results : []).map(optionalRecord)
    .filter(r => r.key === 'conductor_temperature' && (r.case === 'operating' || field?.kind === 'fem' && r.case === undefined) && r.status === 'available');
  const temperatures = new Map<string, number>();
  for (const row of rows) {
    const value = numeric(row.value);
    if (row.unit !== 'K' || value === null || value <= 0) throw new Error('导体温度必须为有效 K；拒绝着色。');
    temperatures.set(text(row.entity), value - 273.15);
  }
  const section = document.sections.find(s => s.id === sectionId)!;
  const geometry = sectionGeometry(document, section);
  const conductors: CadThermal['conductors'][number][] = [];
  for (const cable of geometry.cables) {
    const circuitIndex = document.circuits.findIndex(c => c.cables.some(instance => instance.id === cable.id));
    const label = `${circuitIndex >= 0 ? `回路 ${circuitIndex + 1}` : cable.id} · ${cable.label}`;
    const aggregate = temperatures.get(cable.id);
    if (aggregate !== undefined) {
      // A cable-level quantity does not identify one of its cores. Mark the cable, rather than invent a hottest core.
      conductors.push({ id: cable.id, x: cable.x, z: cable.z, radius: cable.shape.radiusM, value: aggregate, hottest: false, label: `${label} · 导体` });
      continue;
    }
    for (const ring of cable.shape.rings.filter(r => r.target.role === 'conductor')) {
      const coreId = ring.target.scope === 'core' ? ring.target.coreId : undefined;
      const value = temperatures.get(`${cable.id}/${coreId}`);
      if (value === undefined) continue;
      conductors.push({ id: cable.id, coreId, x: cable.x + ring.centerX, z: cable.z + ring.centerZ,
        radius: ring.outerM, value, hottest: false, label: `${label} · ${coreId || '导体'}` });
    }
  }
  if (!field && !conductors.length) return undefined;
  const hottest = conductors.reduce<typeof conductors[number] | undefined>((a, b) => !a || b.value > a.value ? b : a, undefined);
  if (hottest) hottest.hottest = true;
  const values = field?.temperatures.map(k => k - 273.15) || [];
  const minimum = field ? field.minimum - 273.15 : Math.min(...conductors.map(c => c.value));
  // Exactly the FieldView range: node extrema, extended by the FEM conductor limit.
  const limits = document.cable_types.map(cable => numeric(optionalRecord(optionalRecord(cable.rating).max_conductor_temperature).normal))
    .filter((value): value is number => value !== null);
  const limit = field?.kind === 'fem' && limits.length ? Math.min(...limits) : undefined;
  const maximumValue = field ? Math.max(field.maximum - 273.15, limit ? limit - 273.15 : -Infinity) : Math.max(...conductors.map(c => c.value));
  const maximum = maximumValue > minimum ? maximumValue : minimum + 1;
  const method = optionalRecord(optionalRecord(run.snapshot).definition).method || optionalRecord(run.snapshot).method;
  const pin = optionalRecord(method);
  const fieldSource = optionalRecord(field?.field.source);
  const convergence = optionalRecord(run.convergence);
  return { runId: text(run.id), caseId: text(chosen.case_id), source: `${text(pin.plugin_id)} ${text(pin.version)} · ${text(pin.release_digest)} · 输入 ${text(fieldSource.input_sha256)} · 工件 ${text(optionalRecord(chosen.artifact_digests)['x-cablesim.temperature-field'])}${convergence.status ? ` · 收敛 ${text(convergence.status)} · ${text(convergence.reason)}` : ''}`,
    runLabel: savedRunLabel(run), kind: field?.kind, notice: field?.kind === 'fem' && convergence.status === 'unconverged' ? '有限元未收敛' : undefined, points: field?.points || [], triangles: field?.triangles || [], values, minimum, maximum, conductors };
}

export function colorScene(scene: CadScene, thermal: CadThermal | undefined, palette?: readonly number[][]): CadScene {
  if (!thermal) return scene;
  const span = Math.max(thermal.maximum - thermal.minimum, 1e-6);
  return { ...scene, assets: Object.fromEntries(Object.entries(scene.assets).map(([id, asset]) => {
    const object = scene.objects.find(o => o.parts.some(p => p.asset_id === id));
    const candidates = thermal.conductors.filter(c => c.id === object?.id && (!asset.core_id || !c.coreId || c.coreId === asset.core_id));
    if (!candidates.length) return [id, asset];
    const value = Math.max(...candidates.map(c => c.value));
    const t = (value - thermal.minimum) / span;
    return [id, { ...asset, display_color: thermal.kind === 'difference' && palette ? fieldColor(t, true, palette[0], palette[1], palette[2]) : turbo(t) }];
  })) };
}
