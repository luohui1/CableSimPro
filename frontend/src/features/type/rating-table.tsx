import { useState } from 'react';
import { CommandAction } from './command-slot';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, record, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import { displayName } from '@/lib/display-names';
import { useTypeWorkspace } from './provider';
import { useTypeNavigation } from './navigation';
import { currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { useTypeInspector } from './inspector';
import { compileRating, isRatingDefinition, ratingBody, ratingResults, typeStudies, type RatingDraft } from './rating-api';
import { TypeRunControl } from './run-control';
import { MethodParameterFields } from '@/components/method-parameter-fields';

const layouts = { trefoil: '直埋 · 品字', flat: '直埋 · 水平', ducts: '排管 · 品字', air: '空气', three_core_buried_single: '三芯直埋 · 单回', three_core_buried_horizontal: '三芯直埋 · 三回水平', three_core_ducts_horizontal: '三芯排管 · 三回水平' };
const statusKinds: Record<string, StatusKind> = { 已计算: 'success', 未运行: 'unknown', 计算失败: 'error', 待补数据: 'unknown', 输入错误: 'error', 超出范围: 'inapplicable' };
const conditionLabels: Record<string, [string, string?]> = { ambient_temperature_c: ['环境温度', '°C'], bonding: ['接地'], depth_m: ['实际中心埋深', 'm'], soil_rho_k_m_w: ['土壤热阻率', 'K·m/W'], actual_spacing_m: ['实际中心距', 'm'], spacing_m: ['给定中心距', 'm'], duct_inner_m: ['管内径', 'm'], duct_outer_m: ['管外径', 'm'], duct_rho_k_m_w: ['管材热阻率', 'K·m/W'], source: ['条件来源'], name: ['名称'], layout: ['实际排列'], rating_basis_name: ['负荷口径'], circuit_count: ['回路数'] };
type Row = components['schemas']['RatingRow'] & { id: string };
export function TypeRatingTable({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), { location } = useTypeNavigation(), evidence = useTypeEvidence(), inspector = useTypeInspector();
  const threeCore = state.document?.cable_types[0]?.construction === 'three_core';
  const layoutOptions = Object.entries(layouts).filter(([value]) => value.startsWith('three_core_') === threeCore).map(([value, label]) => ({ value, label }));
  const studies = useQuery({ queryKey: ['type-studies', state.workspace?.id], queryFn: ({ signal }) => typeStudies(state.workspace!.id, signal), enabled: !!state.workspace });
  const [selected, setSelected] = useState(''), [running, setRunning] = useState(false), [open, setOpen] = useState(false), [name, setName] = useState(''), [layout, setLayout] = useState<components['schemas']['RatingRow']['layout']>('trefoil'), [adding, setAdding] = useState(false), [error, setError] = useState('');
  let saved = null as NonNullable<typeof evidence.data>[number] | null, savedStudy: components['schemas']['StudyResponse'] | undefined, projectionError = '';
  try { saved = evidence.data?.find(item => isRatingDefinition(optionalRecord(item.run.snapshot).definition) && (!location.run || item.run.id === location.run) && (!location.revision || optionalRecord(item.run.snapshot).workspace_revision === location.revision)) || null; savedStudy = studies.data?.filter(item => isRatingDefinition(item.definition)).sort((a, b) => b.created.localeCompare(a.created))[0]; } catch (failure) { projectionError = message(failure); }
  const results = useQuery({ queryKey: ['type-rating-results', state.workspace?.id, saved?.run.id], queryFn: ({ signal }) => ratingResults(state.workspace!.id, text(saved!.run.id), signal), enabled: !!saved });
  const snapshotStudy = saved && state.readOnly ? { ...savedStudy, id: text(saved.study.id), definition: record(optionalRecord(saved.run.snapshot).definition, '固定工况配置') } as components['schemas']['StudyResponse'] : savedStudy;
  let body = state.ratingDraft && !state.readOnly ? state.ratingDraft.body : snapshotStudy ? ratingBody(snapshotStudy) : { rows: [], parameters: {}, selected_case_ids: null };
  const rows: Row[] = body.rows.map(row => ({ ...row, id: row.case_id }));
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.dirty) && savedStudy?.id === saved.study.id && savedStudy?.revision === optionalRecord(saved.run.snapshot).study_revision;
  function draft(): RatingDraft { return state.ratingDraft || { body: structuredClone(body), revision: state.workspace!.revision, study: savedStudy, fields: {} }; }
  function update(id: string, field: string, value: unknown) { const next = draft(); state.setRatingDraft({ ...next, body: { ...next.body, rows: next.body.rows.map(row => row.case_id === id ? { ...row, [field]: value } : row) } }); }
  function numericInput(row: Row, field: keyof Row, label: string) {
    const key = row.id + '/' + field, raw = state.ratingDraft?.fields[key] ?? (numeric(row[field]) === null ? '' : String(row[field]));
    return <input className="type-rating-number" type="text" inputMode="decimal" aria-label={row.name + ' ' + label} value={raw} readOnly={state.readOnly || state.busy} onChange={event => { const next = draft(); state.setRatingDraft({ ...next, fields: { ...next.fields, [key]: event.target.value } }); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const next = draft(), fields = { ...next.fields }; delete fields[key]; state.setRatingDraft({ ...next, fields }); } if (event.key === 'Enter') { event.preventDefault(); void state.save(); } }} />;
  }
  async function add() {
    if (!name.trim() || adding || state.readOnly) return; setAdding(true); setError('');
    const next = draft(), startedWithoutDraft = !state.ratingDraft;
    state.setRatingDraft(next);
    try {
      const id = 'condition-' + crypto.randomUUID();
      const compiled = await compileRating(state.workspace!.id, next.revision, { ...next.body, rows: [...next.body.rows, { case_id: id, name: name.trim(), layout }] });
      const authoritative = ratingBody({ id: '', definition: compiled } as components['schemas']['StudyResponse']);
      const added = authoritative.rows.find(row => row.case_id === id);
      if (!added) throw Error('宿主未返回新增工况身份');
      state.setRatingDraft(current => current ? { ...current, body: { ...current.body, rows: [...current.body.rows, added] } } : null); setOpen(false); setName('');
    } catch (failure) { if (startedWithoutDraft) state.setRatingDraft(current => current === next ? null : current); setError(message(failure)); } finally { setAdding(false); }
  }
  function select(row: Row) {
    setSelected(row.id); const result = results.data?.rows.find(item => item.id === row.id), condition = optionalRecord(result?.condition);
    inspector.show(row.name, [
      { label: '真实结果与范围', items: [{ label: '完整电流精度', value: numeric(result?.value_a) === null ? '—' : String(result!.value_a), unit: 'A', source: result && numeric(result.value_a) !== null ? 'calculation' : undefined, sourceDetail: saved ? methodLabel(saved.run) : undefined }, { label: '状态', value: text(result?.status) || '未运行' }, { label: '原因', value: text(result?.reason) || '—' }] },
      { label: '保存的实际工况', items: Object.entries(condition).filter(([key]) => key !== 'case_id' && key !== 'name' && key !== 'rating_basis' && (condition.layout === 'ducts' || condition.layout === 'three_core_ducts_horizontal' || !key.startsWith('duct_'))).map(([key, value]) => { const [label, unit] = conditionLabels[key] || [key]; const display = key === 'layout' ? layouts[text(value) as keyof typeof layouts] || text(value) : key === 'bonding' ? ({ both_ends: '两端接地', single_point: '单点接地', unspecified: '待明确' }[text(value)] || text(value)) : numeric(value) === null ? value === null ? '未提供' : String(value) : formatNumber(numeric(value), 6); return { label, value: <span title={value === null ? undefined : String(value)}>{display}</span>, unit, source: numeric(value) === null ? undefined : 'user' as const, sourceDetail: text(condition.source) || undefined }; }) },
      { label: '方法与工件', items: [{ label: '方法', value: saved ? methodLabel(saved.run) : '未运行' }, { label: '运行', value: saved ? text(saved.run.id) : '未运行' }, { label: '工件摘要', value: result ? Object.entries(optionalRecord(result.artifact_digests)).map(([key, value]) => displayName(key) + ' · ' + text(value)).join('；') : '未运行' }] },
    ]);
  }
  async function definition() { if (!savedStudy) throw Error('请先保存工况表'); return compileRating(state.workspace!.id, state.workspace!.revision, ratingBody(savedStudy)); }
  const row = rows.find(row => row.id === selected) || rows[0];
  const bodyState = running || evidence.isPending || studies.isPending || saved && results.isPending ? 'loading' : error || projectionError || evidence.error || studies.error || results.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  return <div className="type-page" data-type-page="rating-table-results" data-type-state={bodyState}>
    <div className="type-result-toolbar"><CommandAction><TypeRunControl channel="rating-table" label="计算所选工况" definition={definition} onBusy={setRunning} unavailable={!savedStudy || !body.rows.length ? '请先添加并保存工况表' : body.selected_case_ids?.length === 0 ? '尚未选择计算工况' : undefined} /></CommandAction><Button size="compact" disabled={state.busy || state.readOnly || body.rows.length >= 100} onClick={() => { setOpen(true); setName(''); setLayout(threeCore ? 'three_core_buried_single' : 'trefoil'); }}>添加工况</Button></div>
    {bodyState === 'loading' ? <LoadingState title="正在读取载流量工况与结果" /> : bodyState === 'error' ? <ErrorState title="载流量表不可用" description={error || projectionError || message(evidence.error || studies.error || results.error)} action={<Button onClick={() => { setError(''); void evidence.refetch(); void studies.refetch(); void results.refetch(); }}>重新读取</Button>} /> : tab === 'parameters' ? <>
      {snapshotStudy ? <MethodParameterFields method={snapshotStudy.definition.method} namespace="rating-table" values={body.parameters || {}} readOnly={state.readOnly || state.busy} sources={snapshotStudy.definition.input_sources} draftFields={state.ratingDraft?.parameterFields} onDraftChange={(field, key) => state.setRatingDraft(current => { const next = current || draft(), parameterFields = { ...next.parameterFields }; if (field) parameterFields[key] = field; else delete parameterFields[key]; return { ...next, parameterFields }; })} onChange={(path, value) => state.setRatingDraft(current => { const next = current || draft(), parameters = structuredClone(next.body.parameters || {}), parts = path.split('/').filter(Boolean); let target: Record<string, unknown> = parameters; for (const key of parts.slice(0, -1)) { target[key] = optionalRecord(target[key]); target = target[key] as Record<string, unknown>; } if (value === undefined) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = value; return { ...next, body: { ...next.body, parameters } }; })} /> : <EmptyState title="尚无保存的载流量方法参数" description="先添加并保存工况。" />}
    </> : <>
      {saved && !current && <StaleBanner description="型号、方法或工况已变化；电流与拒算原因保留原运行数据。" />}
      {!rows.length ? <EmptyState title="尚无载流量工况" description="添加宿主定义的工况，核对来源后保存。" /> : <>
        <DataTable label="载流量表" selectedId={selected} onSelect={select} rowLabel={row => row.name} showGroups={false} groups={[{ id: 'conditions', label: '工况', rows }]} columns={[
          { id: 'chosen', label: '计算', render: row => <input type="checkbox" aria-label={'计算 ' + row.name} checked={!body.selected_case_ids || body.selected_case_ids.includes(row.id)} disabled={state.readOnly || state.busy} onChange={event => { const next = draft(), ids = new Set(next.body.selected_case_ids ?? next.body.rows.map(row => row.case_id)); event.target.checked ? ids.add(row.id) : ids.delete(row.id); state.setRatingDraft({ ...next, body: { ...next.body, selected_case_ids: [...ids] } }); }} /> },
          { id: 'name', label: '工况 / 排列', render: row => <span>{row.name}<span className="muted"> · {layouts[row.layout]}</span></span> },
          { id: 'depth', label: '埋深 / m', numeric: true, render: row => row.layout === 'air' ? '—' : numericInput(row, 'depth_m', '中心埋深') },
          { id: 'rho', label: '土壤热阻率 / K·m/W', numeric: true, render: row => row.layout === 'air' ? '—' : numericInput(row, 'soil_rho_k_m_w', '土壤热阻率') },
          { id: 'ambient', label: '环境 / °C', numeric: true, render: row => numericInput(row, 'ambient_temperature_c', '环境温度') },
          { id: 'current', label: '允许电流 / A', numeric: true, render: row => { const value = results.data?.rows.find(result => result.id === row.id)?.value_a; return <span title={numeric(value) === null ? undefined : String(value)}>{formatNumber(numeric(value), 2)}</span>; } },
          { id: 'status', label: '状态', render: row => { const result = results.data?.rows.find(item => item.id === row.id); return <StatusMark kind={statusKinds[text(result?.status)] || 'unknown'} label={text(result?.status) || '未运行'} detail={text(result?.reason) || undefined} />; } },
        ]} />
        {row && <details className="type-rating-edit"><summary>所选工况条件 · {row.name}</summary><div className="type-rating-fields"><label>工况名称<input value={row.name} readOnly={state.readOnly || state.busy} onChange={event => update(row.id, 'name', event.target.value)} /></label><Select label="排列" value={row.layout} disabled={state.readOnly || state.busy} options={layoutOptions} onChange={value => update(row.id, 'layout', value)} /><Select label="载流量口径" value={row.rating_basis || 'individual'} disabled={state.readOnly || state.busy} options={[{ value: 'simultaneous', label: '全回路等负荷' }, { value: 'individual', label: '首回路变化，其他回路保持保存负荷' }]} onChange={value => update(row.id, 'rating_basis', value)} /><label>中心距 / m{numericInput(row, 'spacing_m', '中心距')}</label><Select label="接地" value={row.bonding} disabled={state.readOnly || state.busy} options={[{ value: 'both_ends', label: '两端接地' }, { value: 'single_point', label: '单点接地' }, { value: 'unspecified', label: '待明确' }]} onChange={value => update(row.id, 'bonding', value)} />{(row.layout === 'ducts' || row.layout === 'three_core_ducts_horizontal') && <><label>管内径 / m{numericInput(row, 'duct_inner_m', '管内径')}</label><label>管外径 / m{numericInput(row, 'duct_outer_m', '管外径')}</label><label>管材热阻率 / K·m/W{numericInput(row, 'duct_rho_k_m_w', '管材热阻率')}</label></>}<label className="type-rating-source">条件来源<input value={row.source || ''} readOnly={state.readOnly || state.busy} onChange={event => update(row.id, 'source', event.target.value)} /></label><Button size="compact" disabled={state.readOnly || state.busy} onClick={() => { const next = draft(); state.setRatingDraft({ ...next, body: { ...next.body, rows: next.body.rows.filter(item => item.case_id !== row.id), selected_case_ids: next.body.selected_case_ids?.filter(id => id !== row.id) ?? null } }); }}>删除工况</Button></div></details>}
      </>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!adding) setOpen(value); }} title="添加宿主工况" description="默认尺寸、温度和来源由正式宿主工况模型返回。" actions={<Button variant="primary" loading={adding} disabled={!name.trim()} onClick={() => void add()}>采用宿主工况</Button>}><div className="type-create-fields"><label className="type-form-label">工况名称<input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} /></label><Select label="工况排列" value={layout} options={layoutOptions} onChange={value => setLayout(value as typeof layout)} />{error && <p role="alert" className="field-error">{error}</p>}</div></Dialog>
  </div>;
}
