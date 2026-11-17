import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import { useStudy } from './study-provider';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { NumberField } from './ui/number-field';
import { Dialog } from './ui/dialog';
import { StatusMark } from './status-mark';
import { EmptyState, LoadingState } from './states';
import { StudyErrorState as ErrorState } from './study-error-state';
import { DataTable, type Column } from './data-table';
import { modelArtifacts } from '@/api/model-artifacts';
import { api, record, optionalRecord, text, numeric, responseData, message, ApiError } from '@/api/client';
import type { components } from '@/api/generated/schema';
import './study-hybrid.css';

const sceneNames: Record<string, string> = { direct_single: '直埋单回', direct_double: '直埋双回', duct: '排管', backfill: '矩形回填', layered_soil: '分层土壤' };
const modelNames: Record<string, string> = { xgboost: 'XGBoost', mlp: '小型神经网络', gaussian_process: '高斯过程' };
type Inputs = { depth: number | null; soil: number | null; ambient: number | null; spacing: number | null; current: number | null; neighbour: number | null; backfill: number | null; interface: number | null; lowerSoil: number | null };
type Editable = keyof Inputs;
const fields: { key: Editable; label: string; unit: string; feature: string; precision: number; scale?: number }[] = [
  { key: 'depth', label: '中心埋深', unit: 'm', feature: 'depth_m', precision: 3 },
  { key: 'soil', label: '土壤热阻率', unit: 'K·m/W', feature: 'soil_rho_k_m_w', precision: 3 },
  { key: 'ambient', label: '地温', unit: '°C', feature: 'ambient_temperature_k', precision: 2 },
  { key: 'spacing', label: '相中心距', unit: 'm', feature: 'phase_spacing_m', precision: 4 },
  { key: 'current', label: '负荷', unit: 'A', feature: 'current_a', precision: 2 },
  { key: 'neighbour', label: '邻回负荷', unit: 'A', feature: 'neighbour_current_a', precision: 2 },
  { key: 'backfill', label: '回填热阻率', unit: 'K·m/W', feature: 'backfill_rho_k_m_w', precision: 3 },
  { key: 'interface', label: '土层界面深度', unit: 'm', feature: 'interface_depth_m', precision: 3 },
  { key: 'lowerSoil', label: '下层土壤热阻率', unit: 'K·m/W', feature: 'lower_soil_rho_k_m_w', precision: 3 },
];
function initial(document: Record<string, unknown>): Inputs {
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const circuits = Array.isArray(document.circuits) ? document.circuits : [];
  const section = optionalRecord(sections[0]); const circuit = optionalRecord(circuits[0]);
  const points = Array.isArray(section.placements) ? section.placements.map(optionalRecord) : [];
  const medium = optionalRecord(section.medium);
  const soil = (Array.isArray(document.materials) ? document.materials : []).map(optionalRecord).find(m => m.id === medium.material);
  const load = optionalRecord((Array.isArray(document.load_cases) ? document.load_cases : [])[0]);
  const fill = optionalRecord(section.backfill);
  const fillMaterial = (Array.isArray(document.materials) ? document.materials : []).map(optionalRecord).find(m => m.id === fill.material);
  const layers = (Array.isArray(section.soil_layers) ? section.soil_layers : []).map(optionalRecord);
  const lower = (Array.isArray(document.materials) ? document.materials : []).map(optionalRecord).find(m => m.id === layers[1]?.material);
  return { depth: points.length ? -(numeric(points[0].z) ?? 0) : null, soil: numeric(soil?.thermal_resistivity),
    ambient: numeric(medium.surface_temperature) === null ? null : numeric(medium.surface_temperature)! - 273.15,
    spacing: points.length > 1 ? Math.abs((numeric(points[1].x) ?? 0) - (numeric(points[0].x) ?? 0)) : null,
    current: numeric(optionalRecord(load.currents)[text(circuit.id)]),
    neighbour: numeric(optionalRecord(load.currents)[text(optionalRecord(circuits[1]).id)]),
    backfill: numeric(fillMaterial?.thermal_resistivity), interface: numeric(layers[0]?.bottom_z) === null ? null : -Number(layers[0]?.bottom_z), lowerSoil: numeric(lower?.thermal_resistivity) };
}
function scene(document: Record<string, unknown>) {
  const section = optionalRecord((Array.isArray(document.sections) ? document.sections : [])[0]);
  return Array.isArray(section.soil_layers) && section.soil_layers.length ? 'layered_soil' : section.backfill ? 'backfill' : Array.isArray(section.enclosures) && section.enclosures.length ? 'duct' : Array.isArray(document.circuits) && document.circuits.length > 1 ? 'direct_double' : 'direct_single';
}
function number(value: unknown, digits = 2) { const n = numeric(value); return n === null ? '—' : n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function interval(value: unknown, offset = 0) { return Array.isArray(value) && value.length === 2 && value.every(v => numeric(v) !== null) ? `${number(Number(value[0]) - offset)} – ${number(Number(value[1]) - offset)}` : '—'; }

export function StudyHybrid({ run, tab }: { run?: Record<string, unknown>; tab: string }) {
  const context = useStudy(); const { study, workspace } = context;
  const queries = useQueryClient();
  const predictionReasonId = useId();
  const document = optionalRecord(workspace.domain); const savedInputs = initial(document);
  const activeFields = fields.filter(field => !['neighbour', 'backfill', 'interface', 'lowerSoil'].includes(field.key)
    || field.key === 'neighbour' && scene(document) === 'direct_double'
    || field.key === 'backfill' && scene(document) === 'backfill'
    || ['interface', 'lowerSoil'].includes(field.key) && scene(document) === 'layered_soil');
  const storedModelId = text(optionalRecord(study.definition.parameters).model_sha256);
  const [modelId, setModelId] = useState(storedModelId); const [values, setValues] = useState<Inputs>(savedInputs);
  const [raw, setRaw] = useState<Partial<Record<Editable, string>>>({}); const [fieldErrors, setFieldErrors] = useState<Partial<Record<Editable, string>>>({});
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [running, setRunning] = useState(false);
  const pending = useRef(false); const revision = useRef(numeric(workspace.revision)!); const studyRevision = useRef(study.revision);
  const lock = useRef(optionalRecord(study.raw.lock));
  const request = useRef<{ id: string; revision: number; studyRevision: number } | undefined>(undefined);
  const history = useRef<{ values: Inputs; modelId: string }[]>([]);
  const models = useQuery({ queryKey: ['model-artifacts'], queryFn: ({ signal }) => modelArtifacts(signal) });
  const compatible = models.data?.filter(model => model.availability === 'available' && model.family === scene(document)) || [];
  const model = compatible.find(item => item.id === modelId);
  const dirty = JSON.stringify(values) !== JSON.stringify(savedInputs) || modelId !== storedModelId || Object.keys(raw).length > 0;
  useEffect(() => {
    if (!pending.current) {
      // Workspace and study queries refresh independently. An older cached
      // reply must not roll back revisions already returned by our own save.
      revision.current = Math.max(revision.current, numeric(workspace.revision)!);
      studyRevision.current = Math.max(studyRevision.current, study.revision);
      if (numeric(optionalRecord(study.raw.lock).workspace_revision) === revision.current) lock.current = optionalRecord(study.raw.lock);
    }
    if (!dirty && !pending.current) { setValues(initial(optionalRecord(workspace.domain))); setModelId(text(optionalRecord(study.definition.parameters).model_sha256)); }
  }, [workspace.revision, study.revision]);
  const blocker = useBlocker({ shouldBlockFn: () => dirty && !pending.current, enableBeforeUnload: dirty, withResolver: true });
  function update(key: Editable, value: number | null) {
    history.current.push({ values, modelId }); setValues(previous => ({ ...previous, [key]: value })); setFieldErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); setError('');
  }
  function discard() { setValues(savedInputs); setRaw({}); setModelId(storedModelId); setFieldErrors({}); setError(''); history.current = []; }
  function resolvedInputs() {
    const next = { ...values }; const errors: Partial<Record<Editable, string>> = {};
    const names = Array.isArray(optionalRecord(model?.raw).feature_names) ? optionalRecord(model?.raw).feature_names as string[] : [];
    for (const field of activeFields) {
      if (raw[field.key] !== undefined) next[field.key] = raw[field.key]!.trim() ? Number(raw[field.key]) : null;
      const value = next[field.key];
      if (value === null || !Number.isFinite(value)) errors[field.key] = `请填写有效的${field.label}`;
      else if (field.key !== 'ambient' && value <= 0) errors[field.key] = `${field.label}须大于0 ${field.unit}`;
      else {
        const index = names.indexOf(field.feature); const ranges = model?.domain.feature_ranges;
        const bounds = Array.isArray(ranges) ? ranges[index] : undefined;
        const numericValue = field.key === 'ambient' ? value + 273.15 : value;
        if (Array.isArray(bounds) && (numericValue < Number(bounds[0]) || numericValue > Number(bounds[1]))) {
          const displayed = bounds.map(bound => Number(bound) - (field.key === 'ambient' ? 273.15 : 0));
          errors[field.key] = `${field.label}超出训练范围（${displayed[0].toFixed(field.precision)}–${displayed[1].toFixed(field.precision)} ${field.unit}）`;
        }
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) { requestAnimationFrame(() => documentElement()?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()); throw new ApiError(422, '请修正标出的工况字段'); }
    return next as { [K in Editable]: number };
  }
  const save = useCallback(async () => {
    if (!dirty) return true;
    if (!model) throw new ApiError(422, '请选择当前场景可用的模型版本');
    const next = resolvedInputs(); setSaving(true);
    try {
      const changed = structuredClone(document) as unknown as components['schemas']['DomainDocument'];
      const section = changed.sections[0]; const old = initial(document); const delta = next.depth - old.depth!;
      const circuit = changed.circuits[0];
      const centers = new Map<string, number>();
      for (const item of changed.circuits) {
        const selected = section.placements.filter(p => item.cables.some(c => c.id === p.cable));
        centers.set(item.id, selected.reduce((sum, p) => sum + p.x, 0) / selected.length);
      }
      for (const item of changed.circuits) {
        const selected = section.placements.filter(p => item.cables.some(c => c.id === p.cable)).sort((a, b) => a.x - b.x);
        for (const [index, point] of selected.entries()) { point.x = centers.get(item.id)! + (index - 1) * next.spacing; point.z -= delta; }
      }
      for (const enclosure of section.enclosures || []) { const point = section.placements.find(p => p.enclosure === enclosure.id); if (point) { enclosure.x = point.x; enclosure.z = point.z; } }
      if (section.backfill) section.backfill.z -= delta;
      section.medium.surface_temperature = next.ambient + 273.15;
      changed.materials.find(material => material.id === section.medium.material)!.thermal_resistivity = next.soil;
      if (section.backfill) changed.materials.find(material => material.id === section.backfill!.material)!.thermal_resistivity = next.backfill;
      if (section.soil_layers?.length === 2) {
        section.soil_layers[0].bottom_z = -next.interface;
        section.soil_layers[1].top_z = -next.interface;
        changed.materials.find(material => material.id === section.soil_layers![1].material)!.thermal_resistivity = next.lowerSoil;
      }
      const currents = changed.load_cases[0].currents;
      if (!currents) throw new ApiError(422, '保存的负荷电流缺项，请先补齐');
      currents[circuit.id] = next.current;
      for (const cable of circuit.cables) if (cable.id in currents) currents[cable.id] = next.current;
      const neighbour = changed.circuits[1];
      if (neighbour) {
        currents[neighbour.id] = next.neighbour;
        for (const cable of neighbour.cables) if (cable.id in currents) currents[cable.id] = next.neighbour;
      }
      changed.provenance ||= {};
      changed.provenance['/hybrid/operating-input'] = { kind: 'user', reference: '工程师编辑混合模型的SI工况；界面地温由°C显式转换K', reviewed: false };
      const domainReply = record(await responseData(api.PUT('/api/workspaces/{wid}/domain', { params: { path: { wid: study.workspace } }, body: { expected_revision: revision.current, document: changed } })), '保存工况');
      revision.current = numeric(domainReply.revision)!;
      const body: components['schemas']['UpdateStudy'] = { ...study.definition, expected_revision: revision.current, expected_study_revision: studyRevision.current,
        method: model.method, parameters: model.parameters, input_source: 'domain' };
      const reply = record(await responseData(api.PUT('/api/workspaces/{wid}/studies/{sid}', { params: { path: { wid: study.workspace, sid: study.id } }, body })), '保存模型引用');
      studyRevision.current = numeric(reply.revision)!; lock.current = optionalRecord(reply.lock); setValues(next); setRaw({}); setError(''); history.current = []; request.current = undefined; context.refresh(); return true;
    } finally { setSaving(false); }
  }, [dirty, model, values, raw, document, study]);
  async function execute() {
    if (pending.current) return; pending.current = true; setError('');
    try {
      if (context.dirty) throw new ApiError(422, '请先保存工程或研究中的修改');
      if (!await save()) return;
      if (!model) throw new ApiError(422, '请选择可用模型');
      setRunning(true);
      // POST performs the authoritative preflight and checks this saved lock.
      // The read-only study reply supplies identity without running it twice.
      if (numeric(lock.current.workspace_revision) !== revision.current || !text(lock.current.digest))
        throw new ApiError(409, '研究锁与当前工况不同，请刷新后预测。');
      if (!request.current || request.current.revision !== revision.current || request.current.studyRevision !== studyRevision.current)
        request.current = { id: crypto.randomUUID(), revision: revision.current, studyRevision: studyRevision.current };
      const completed = record(await responseData(api.POST('/api/workspaces/{wid}/studies/{sid}/runs', { params: { path: { wid: study.workspace, sid: study.id } }, body: { request_id: request.current.id,
        expected_revision: revision.current, expected_study_revision: studyRevision.current, lock_digest: text(lock.current.digest), scope_acknowledged: true } })), '预测运行');
      queries.setQueryData<Record<string, unknown>[]>(['runs', study.workspace, study.id], previous => [...(previous || []).filter(item => item.id !== completed.id), completed]);
      request.current = undefined;
    } catch (problem) { setError(problem instanceof TypeError ? '连接中断，请重试；已保存工况保留。' : message(problem)); } finally { setRunning(false); pending.current = false; }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (context.dirty) return;
      if (!(event.ctrlKey || event.metaKey) || documentGlobal().querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation(); if (!pending.current) { pending.current = true; void save().catch(problem => setError(message(problem))).finally(() => { pending.current = false; }); } }
      if (event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]'))) {
        event.preventDefault(); event.stopImmediatePropagation(); const previous = history.current.pop(); if (previous) { setValues(previous.values); setModelId(previous.modelId); setRaw({}); setFieldErrors({}); setError(''); }
      }
    };
    documentGlobal().addEventListener('keydown', handler, true); return () => documentGlobal().removeEventListener('keydown', handler, true);
  }, [save, context.dirty]);
  const cases = Array.isArray(optionalRecord(run?.output).cases) ? optionalRecord(run?.output).cases as unknown[] : [];
  const predictionCase = cases.map(optionalRecord).find(c => optionalRecord(c.artifacts)['x-cablesim.hybrid-prediction']);
  const payload = optionalRecord(optionalRecord(predictionCase?.artifacts)['x-cablesim.hybrid-prediction']);
  const failed = cases.map(optionalRecord).find(c => c.status === 'failed' || c.status === 'not_applicable');
  const validation = Object.keys(payload).length ? optionalRecord(payload.validation) : model?.validation;
  const modelReports = optionalRecord(validation?.models);
  const [set, setSet] = useState('validation');
  const busy = saving || running || !!run && ['accepted','queued','running','validating'].includes(text(run.status));
  const predictionDisabledReason = busy ? saving ? '正在保存工况和模型引用，请等待完成后预测。' : '预测运行尚未完成，请等待当前运行结束。'
    : !model ? !compatible.length ? !models.data?.length ? `尚无已登记的训练模型，当前${sceneNames[scene(document)]}场景不能预测。`
      : `已登记模型中没有适用于${sceneNames[scene(document)]}场景的可用版本，不能预测。`
      : modelId ? '已保存的模型引用目前不在本场景可用目录中；请选择确切的已登记适用模型，原摘要仍保留。'
        : '请先选择确切的已登记适用模型版本，再预测。'
    : context.dirty ? '工程或研究有未保存修改，请先保存或撤销，再预测。' : '';
  const comparison = Object.keys(payload).length ? [{ id: 'iec', name: optionalRecord(payload.baseline).kind === 'uniform_soil_counterfactual' ? '均匀土壤IEC对照' : 'IEC基线', amp: optionalRecord(payload.baseline).ampacity_a, temperature: optionalRecord(payload.baseline).temperature_k, intervals: {} },
    { id: 'hybrid', name: '混合模型', amp: payload.ampacity, temperature: payload.conductor_temperature, intervals: optionalRecord(payload.interval) }] : [];
  const columns: Column<typeof comparison[number]>[] = [
    { id: 'method', label: '方法', render: row => row.name }, { id: 'amp', label: '允许电流', unit: 'A', numeric: true, render: row => number(row.amp) },
    { id: 'temperature', label: '运行温度', unit: '°C', numeric: true, render: row => numeric(row.temperature) === null ? '—' : number(Number(row.temperature) - 273.15) },
    { id: 'interval-a', label: '95%预测区间', unit: 'A', numeric: true, render: row => interval(optionalRecord(row.intervals).ampacity_a) },
    { id: 'interval-t', label: '95%预测区间', unit: '°C', numeric: true, render: row => interval(optionalRecord(row.intervals).conductor_temperature_k, 273.15) },
  ];
  const reportRows = Object.entries(modelReports).map(([id, value]) => ({ id, name: modelNames[id] || id, report: optionalRecord(optionalRecord(optionalRecord(value).sets)[set]) }));
  const reportColumns: Column<typeof reportRows[number]>[] = [{ id: 'model', label: '模型', render: row => row.name }, ...(['ampacity_a','temperature_k'] as const).flatMap(key => ['mean_absolute','p95_absolute','maximum_absolute'].map((stat, index) => ({ id: `${key}-${stat}`, label: `${index === 0 ? '平均' : index === 1 ? 'P95' : '最大'}${key === 'ampacity_a' ? '电流误差' : '温度误差'}`, unit: key === 'ampacity_a' ? 'A' : 'K', numeric: true, render: (row: typeof reportRows[number]) => number(optionalRecord(row.report[key])[stat], 3) })))];
  if (models.isPending) return <LoadingState title="正在读取训练模型" />;
  if (models.error) return <ErrorState description={message(models.error)} action={<Button onClick={() => models.refetch()}>重新读取</Button>} />;
  return <div className="hybrid-study">
    <div className="hybrid-toolbar"><Select label="模型版本" value={modelId || undefined} disabled={!compatible.length} placeholder={compatible.length ? '请选择模型版本' : '当前场景暂无可用模型'} onChange={value => { history.current.push({ values, modelId }); setModelId(value); setError(''); }} options={compatible.map(item => ({ value: item.id, label: `${item.name} · ${item.version}` }))} /><StatusMark kind="proposal" label="仅参考" detail="仿真数据校准；工程使用需要独立实测验证与人工批准。" /><span className="spacer" /><Button variant="run" loading={busy} disabled={!model || context.dirty} aria-describedby={predictionDisabledReason ? predictionReasonId : undefined} title={predictionDisabledReason || undefined} onClick={execute}>{dirty ? '保存并预测' : '预测'}</Button></div>
    {predictionDisabledReason && <p id={predictionReasonId} className="muted" role="status">{predictionDisabledReason}</p>}
    {!compatible.length && <>
      <p className="muted">请在混合方法的“能力”页查看样本、训练和验证要求；完成模型登记后重新读取目录，并选择确切的适用版本。此处不会自动训练模型{modelId ? '，已保存的模型摘要和历史结果仍保留' : ''}。</p>
      <div className="hybrid-validation-toolbar" aria-label="模型准备">
        <Link className="button button-primary button-standard" to="/plugins/$pid" params={{ pid: 'cablesim.hybrid-rating' }} search={{ theme: documentGlobal().documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }}>查看混合方法与训练要求</Link>
        <Button loading={models.isFetching} onClick={() => void models.refetch()}>{models.isFetching ? '正在读取模型目录' : '重新读取模型目录'}</Button>
      </div>
    </>}
    {error && !Object.keys(fieldErrors).length && <ErrorState title="预测未完成" description={error} />}
    {tab === 'results' ? <><div className="hybrid-inputs" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); discard(); } }}>{activeFields.map(field => <NumberField key={field.key} label={field.label} value={values[field.key]} unit={field.unit} precision={field.precision} required disabled={busy} error={fieldErrors[field.key]}
      draftText={raw[field.key]} onDraftChange={value => { setFieldErrors(previous => { const next = { ...previous }; delete next[field.key]; return next; }); setError(''); setRaw(previous => { const next = { ...previous }; if (value === undefined) delete next[field.key]; else next[field.key] = value; return next; }); }} onCommit={value => update(field.key, value)} />)}</div>
      {busy ? <LoadingState title={saving ? '正在保存输入' : '正在预测'} /> : failed ? <ErrorState title="预测未完成" description={text(optionalRecord(failed.error).message)} /> : comparison.length ? <DataTable label="混合预测结果" columns={columns} groups={[{ id: 'comparison', label: '方法对比', rows: comparison }]} rowLabel={row => row.name} showGroups={false} /> : <EmptyState title="尚无混合预测" description={model ? '输入已保存，可运行参考预测。' : '当前场景没有可用模型。'} />}
    </> : tab === 'validation' ? <><div className="hybrid-validation-toolbar"><Select label="数据集" value={set} onChange={setSet} options={[{ value: 'validation', label: '独立验证集' }, { value: 'extrapolation', label: '外推诊断集' }]} /><span className="muted">{set === 'extrapolation' ? '外推只用于诊断，预测入口仍拒绝域外输入。' : '误差参照收敛有限元；实测验证未覆盖。'}</span></div><DataTable label="混合模型验证" columns={reportColumns} groups={[{ id: 'models', label: '模型', rows: reportRows }]} rowLabel={row => row.name} showGroups={false} /></> : <div className="hybrid-sources"><dl><dt>场景族</dt><dd>{sceneNames[text(payload.family) || model?.family || scene(document)]}</dd><dt>模型版本</dt><dd>{text(payload.model_version) || model?.version || '—'}</dd><dt>训练样本</dt><dd>{number(optionalRecord(model?.dataset).valid_samples, 0)}</dd><dt>模型摘要</dt><dd>{text(payload.model_sha256) || modelId || '—'}</dd><dt>数据集摘要</dt><dd>{text(payload.dataset_sha256) || text(model?.raw.dataset_sha256) || '—'}</dd></dl><details><summary>适用范围和验证依据</summary><p>物理范围由所选模型版本固定，来源保存在运行中。结构及方法参数变化、训练范围之外均拒绝预测。</p><p>95%区间为同分布仿真标签的校准预测区间；实测覆盖尚未验证。</p></details></div>}
    <Dialog open={blocker.status === 'blocked'} onOpenChange={open => { if (!open && blocker.status === 'blocked') blocker.reset(); }} title="工况有未保存修改" description="先保存工况，或放弃未保存修改。" actions={blocker.status === 'blocked' ? <><Button onClick={() => { discard(); blocker.proceed(); }}>放弃修改并离开</Button><Button variant="primary" onClick={() => { pending.current = true; void save().then(() => blocker.reset()).catch(problem => setError(message(problem))).finally(() => { pending.current = false; }); }}>保存并留在研究</Button></> : undefined} />
  </div>;
}
function documentGlobal() { return window.document; }
function documentElement() { return window.document.querySelector('.hybrid-study'); }
