import { useState } from 'react';
import { CommandAction } from './command-slot';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, record, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import { displayName } from '@/lib/display-names';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { useTypeInspector } from './inspector';
import { compileRating, isRatingDefinition, ratingBody, ratingResults, typeStudies, type RatingDraft, type RatingCondition } from './rating-api';
import { TypeRunControl } from './run-control';
import { MethodParameterFields } from '@/components/method-parameter-fields';
import { EvidenceDigest } from './evidence-digest';
import { ResultTrace } from './result-detail';
import { TypeStudyDialog } from './study-dialog';

const layouts = { trefoil: '直埋 · 品字', flat: '直埋 · 水平', ducts: '排管 · 品字', air: '空气', three_core_buried_single: '三芯直埋 · 单回', three_core_buried_horizontal: '三芯直埋 · 三回水平', three_core_ducts_horizontal: '三芯排管 · 三回水平' };
const statusKinds: Record<string, StatusKind> = { 已计算: 'success', 未运行: 'unknown', 计算失败: 'error', 待补数据: 'unknown', 输入错误: 'error', 超出范围: 'inapplicable' };
const conditionLabels: Record<string, [string, string?]> = { frequency_hz: ['交流频率', 'Hz'], ambient_temperature_c: ['环境温度', '°C'], bonding: ['接地'], depth_m: ['实际中心埋深', 'm'], soil_rho_k_m_w: ['土壤热阻率', 'K·m/W'], actual_spacing_m: ['实际中心距', 'm'], spacing_m: ['给定中心距', 'm'], duct_inner_m: ['管内径', 'm'], duct_outer_m: ['管外径', 'm'], duct_rho_k_m_w: ['管材热阻率', 'K·m/W'], source: ['条件来源'], name: ['名称'], layout: ['实际排列'], rating_basis_name: ['负荷口径'], circuit_count: ['回路数'] };
export function ratingConditionNumber(key:string,value:number,unit?:string){return key==='circuit_count'?formatNumber(value,0):unit==='m'?formatNumber(value,2):engineeringQuantity(key,value,unit||'1').text;}
type Row = RatingCondition & { id: string };
export function TypeRatingTable({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), { location, navigate } = useTypeNavigation(), evidence = useTypeEvidence(), inspector = useTypeInspector();
  const threeCore = state.document?.cable_types[0]?.construction === 'three_core';
  const unsupported = state.document?.cable_types[0]?.construction === 'multi_core';
  const [studyOpen, setStudyOpen] = useState(false);
  const layoutOptions = Object.entries(layouts).filter(([value]) => value.startsWith('three_core_') === threeCore).map(([value, label]) => ({ value, label }));
  const studies = useQuery({ queryKey: ['type-studies', state.workspace?.id], queryFn: ({ signal }) => typeStudies(state.workspace!.id, signal), enabled: !!state.workspace && !state.readOnly });
  const [selected, setSelected] = useState(''), [running, setRunning] = useState(false), [open, setOpen] = useState(false), [name, setName] = useState(''), [frequency, setFrequency] = useState('50'), [layout, setLayout] = useState<components['schemas']['RatingRow']['layout']>('trefoil'), [adding, setAdding] = useState(false), [error, setError] = useState('');
  let saved = null as NonNullable<typeof evidence.data>[number] | null, savedStudy: components['schemas']['StudyResponse'] | undefined, projectionError = '';
  try { saved = evidence.data?.find(item => isRatingDefinition(optionalRecord(item.run.snapshot).definition) && (!location.run || item.run.id === location.run) && (!location.revision || optionalRecord(item.run.snapshot).workspace_revision === location.revision)) || null; savedStudy = studies.data?.filter(item => isRatingDefinition(item.definition)).sort((a, b) => b.created.localeCompare(a.created))[0]; } catch (failure) { projectionError = message(failure); }
  const results = useQuery({ queryKey: ['type-rating-results', state.workspace?.id, saved?.run.id], queryFn: ({ signal }) => ratingResults(state.workspace!.id, text(saved!.run.id), signal), enabled: !!saved && tab !== 'parameters' });
  const snapshotStudy = saved && state.readOnly ? { ...savedStudy, id: text(saved.study.id), definition: record(optionalRecord(saved.run.snapshot).definition, '固定工况配置') } as components['schemas']['StudyResponse'] : savedStudy;
  let body = state.ratingDraft && !state.readOnly ? state.ratingDraft.body : snapshotStudy ? ratingBody(snapshotStudy) : { rows: [], parameters: {}, selected_case_ids: null };
  const rows: Row[] = body.rows.map(row => ({ ...row, id: row.case_id }));
  const chosenCount = rows.filter(row => !body.selected_case_ids || body.selected_case_ids.includes(row.id)).length;
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.inputDirty || !!state.ratingDraft) && (state.readOnly || savedStudy?.id === saved.study.id && savedStudy?.revision === optionalRecord(saved.run.snapshot).study_revision);
  function draft(): RatingDraft { return state.ratingDraft || { body: structuredClone(body), revision: state.workspace!.revision, study: savedStudy, fields: {} }; }
  function update(id: string, field: string, value: unknown) { const next = draft(); state.setRatingDraft({ ...next, body: { ...next.body, rows: next.body.rows.map(row => row.case_id === id ? { ...row, [field]: value } : row) } }); }
  function numericInput(row: Row, field: keyof Row, label: string) {
    const key = row.id + '/' + field, raw = state.ratingDraft?.fields[key] ?? (numeric(row[field]) === null ? '' : String(row[field]));
    return <Input className="type-rating-number" type="text" inputMode="decimal" aria-label={row.name + ' ' + label} value={raw} readOnly={state.readOnly || state.busy} onChange={event => { const next = draft(); state.setRatingDraft({ ...next, fields: { ...next.fields, [key]: event.target.value } }); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const next = draft(), fields = { ...next.fields }; delete fields[key]; state.setRatingDraft({ ...next, fields }); } if (event.key === 'Enter') { event.preventDefault(); void state.save(); } }} />;
  }
  async function add() {
    if (!name.trim() || adding || state.readOnly) return; setAdding(true); setError('');
    if (!frequency.trim() || !Number.isFinite(Number(frequency)) || Number(frequency)<=0 || Number(frequency)>1000) { setError('交流频率：填写大于 0、不超过 1000 的频率，单位 Hz。'); setAdding(false); return; }
    const next = draft(), startedWithoutDraft = !state.ratingDraft;
    state.setRatingDraft(next);
    try {
      const id = 'condition-' + crypto.randomUUID();
      const compiled = await compileRating(state.workspace!.id, next.revision, { ...next.body, rows: [...next.body.rows, { case_id: id, name: name.trim(), layout, frequency_hz:Number(frequency) }] });
      const authoritative = ratingBody({ id: '', definition: compiled } as components['schemas']['StudyResponse']);
      const added = authoritative.rows.find(row => row.case_id === id);
      if (!added) throw Error('新增工况未完成，请重新添加');
      state.setRatingDraft(current => current ? { ...current, body: { ...current.body, rows: [...current.body.rows, added] } } : null); setOpen(false); setName('');
    } catch (failure) { if (startedWithoutDraft) state.setRatingDraft(current => current === next ? null : current); setError(message(failure)); } finally { setAdding(false); }
  }
  function select(row: Row) {
    setSelected(row.id); const result = results.data?.rows.find(item => item.id === row.id), condition = optionalRecord(result?.condition);
    inspector.show(row.name, [
      { label: '真实结果与范围', items: [{ label: '允许电流', value: formatNumber(numeric(result?.value_a),1), unit: 'A', source: result && numeric(result.value_a) !== null ? 'calculation' : undefined, sourceDetail: saved ? methodLabel(saved.run) : undefined }, { label: '状态', value: text(result?.status) || '未运行' }, { label: '原因', value: text(result?.reason) || '—' }] },
      { label: '保存的实际工况', items: Object.entries(condition).filter(([key]) => key !== 'case_id' && key !== 'name' && key !== 'rating_basis' && (condition.layout === 'ducts' || condition.layout === 'three_core_ducts_horizontal' || !key.startsWith('duct_'))).map(([key, value]) => { const [label, unit] = conditionLabels[key] || [displayName(key)]; const display = key === 'layout' ? layouts[text(value) as keyof typeof layouts] || text(value) : key === 'bonding' ? ({ both_ends: '两端接地', single_point: '单点接地', unspecified: '待明确' }[text(value)] || text(value)) : numeric(value) === null ? value === null ? '未提供' : String(value) : ratingConditionNumber(key,numeric(value)!,unit); return { label, value: display, unit, source: numeric(value) === null ? undefined : 'user' as const, sourceDetail: text(condition.source) || undefined }; }) },
      { label: '方法', items: [{ label: '方法', value: saved ? methodLabel(saved.run) : '未运行' }] },
    ], <ResultTrace items={[{label:'完整电流精度 / A',value:result?.value_a==null?'未提供':String(result.value_a)},{label:'原始工况',value:JSON.stringify(condition)},{label:'运行',value:saved?<EvidenceDigest value={saved.run.id} />:'未运行'},{label:'工件摘要',value:result?Object.entries(optionalRecord(result.artifact_digests)).map(([key,value])=><span key={key}>{displayName(key)} · <EvidenceDigest value={value} /> </span>):'未运行'}]} />);
  }
  async function definition() { if (!savedStudy) throw Error('请先保存工况表'); return compileRating(state.workspace!.id, state.workspace!.revision, ratingBody(savedStudy)); }
  const row = rows.find(row => row.id === selected) || rows[0];
  const bodyState = running || evidence.isPending || !state.readOnly && studies.isPending || saved && tab !== 'parameters' && results.isPending ? 'loading' : error || projectionError || evidence.error || !state.readOnly && studies.error || tab !== 'parameters' && results.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  if(unsupported)return <div className="type-page" data-type-page="rating-table-results" data-type-state="inapplicable"><EmptyState title="四芯载流量 · 方法未覆盖" description="四芯及 3+1 的中性线负荷与完整热路尚未接入。10 kV 及以下可在研究中按 GB 50217 校正有出处的同型号单根基准值；须核对温限、埋深、土壤及中性线负荷条件。没有适用基准时不输出电流。" action={<><Button disabled={state.dirty||state.busy||state.readOnly} onClick={()=>setStudyOpen(true)}>新建载流量研究</Button><Button variant="ghost" onClick={()=>navigate(typePath(state.workspace!.id,'structure','table',location.theme))}>继续完善护层与材料</Button></>} /><TypeStudyDialog open={studyOpen} onOpenChange={setStudyOpen} /></div>;
  return <div className="type-page" data-type-page="rating-table-results" data-type-state={bodyState}>
    <div className="type-result-toolbar"><CommandAction><TypeRunControl channel="rating-table" label="计算所选工况" locateIssue={()=> <Button size="compact" onClick={()=>navigate(typePath(state.workspace!.id,'rating-table','parameters',location.theme))}>填写载流量方法参数</Button>} definition={definition} onBusy={setRunning} unavailable={!savedStudy || !body.rows.length ? '请先添加并保存工况表' : body.selected_case_ids?.length === 0 ? '尚未选择计算工况' : undefined} /></CommandAction><Button size="compact" disabled={state.busy || state.readOnly || body.rows.length >= 100} onClick={() => { setOpen(true); setName(''); setLayout(threeCore ? 'three_core_buried_single' : 'trefoil'); }}>添加工况</Button></div>
    {bodyState === 'loading' ? <LoadingState title="正在读取载流量工况与结果" /> : bodyState === 'error' ? <ErrorState title="载流量表不可用" description={error || projectionError || message(evidence.error || studies.error || results.error)} action={<Button onClick={() => { setError(''); void evidence.refetch(); void studies.refetch(); void results.refetch(); }}>重新读取</Button>} /> : tab === 'parameters' ? <>
      {snapshotStudy ? <MethodParameterFields method={snapshotStudy.definition.method} namespace="rating-table" values={body.parameters || {}} readOnly={state.readOnly || state.busy} sources={snapshotStudy.definition.input_sources} draftFields={state.ratingDraft?.parameterFields} onDraftChange={(field, key) => state.setRatingDraft(current => { const next = current || draft(), parameterFields = { ...next.parameterFields }; if (field) parameterFields[key] = field; else delete parameterFields[key]; return { ...next, parameterFields }; })} onChange={(path, value) => state.setRatingDraft(current => { const next = current || draft(), parameters = structuredClone(next.body.parameters || {}), parts = path.split('/').filter(Boolean); let target: Record<string, unknown> = parameters; for (const key of parts.slice(0, -1)) { target[key] = optionalRecord(target[key]); target = target[key] as Record<string, unknown>; } if (value === undefined) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = value; return { ...next, body: { ...next.body, parameters } }; })} /> : <EmptyState title="尚无保存的载流量方法参数" description="先添加并保存工况。" />}
    </> : <>
      {saved && !current && <StaleBanner description="型号、方法或工况已变化；电流与拒算原因保留原运行数据。" />}
      {!rows.length ? <EmptyState title="尚无载流量工况" description="添加工况，核对尺寸与来源后保存。" /> : <>
        <div className="type-result-toolbar"><label className="type-check-label"><Checkbox aria-label="选择全部工况" checked={chosenCount===rows.length?true:chosenCount===0?false:'indeterminate'} disabled={state.readOnly||state.busy} onCheckedChange={checked=>{const next=draft();state.setRatingDraft({...next,body:{...next.body,selected_case_ids:checked===true?rows.map(row=>row.id):[]}});}} />全选工况</label><span className="muted">已选 {chosenCount} / {rows.length}</span></div>
        <DataTable label="载流量表" selectedId={selected} onSelect={select} rowLabel={row => row.name} showGroups={false} groups={[{ id: 'conditions', label: '工况', rows }]} columns={[
          { id: 'chosen', label: '计算', render: row => <Checkbox aria-label={'计算 ' + row.name} checked={!body.selected_case_ids || body.selected_case_ids.includes(row.id)} disabled={state.readOnly || state.busy} onCheckedChange={checked => { const next = draft(), ids = new Set(next.body.selected_case_ids ?? next.body.rows.map(row => row.case_id)); checked === true ? ids.add(row.id) : ids.delete(row.id); state.setRatingDraft({ ...next, body: { ...next.body, selected_case_ids: [...ids] } }); }} /> },
          { id: 'name', label: '工况', render: row => row.name },
          { id: 'current', label: '允许电流 / A', numeric: true, render: row => formatNumber(numeric(results.data?.rows.find(result => result.id === row.id)?.value_a), 1) },
          { id: 'status', label: '状态', render: row => { const result = results.data?.rows.find(item => item.id === row.id); return <StatusMark kind={statusKinds[text(result?.status)] || 'unknown'} label={text(result?.status) || '未运行'} detail={text(result?.reason) || undefined} />; } },
          { id:'margin',label:'余量 / A',numeric:true,render:row=>{const result=optionalRecord(results.data?.rows.find(item=>item.id===row.id));return <span title="只显示保存运行提供的余量；未提供时保持缺项">{formatNumber(numeric(result.margin_a),1)}</span>;} },
          { id:'conditions',label:'条件',render:row=><details className="type-rating-condition"><summary title={`${formatNumber(numeric(row.ambient_temperature_c),1)} °C${row.layout==='air'?'':` · ${formatNumber(numeric(row.depth_m),2)} m`}`}>{formatNumber(numeric(row.ambient_temperature_c),1)} °C{row.layout==='air'?'':` · ${formatNumber(numeric(row.depth_m),2)} m`}</summary><p>{row.layout==='air'?'空气敷设':`土壤热阻率 ${formatNumber(numeric(row.soil_rho_k_m_w),2)} K·m/W`} · {row.source||'条件来源待补'}</p><Button size="compact" variant="ghost" onClick={()=>select(row)}>查看完整条件</Button></details> },
        ]} />
        {row && <details className="type-rating-edit"><summary>所选工况条件 · {row.name}</summary><div className="type-rating-fields"><label>工况名称<Input value={row.name} readOnly={state.readOnly || state.busy} onChange={event => update(row.id, 'name', event.target.value)} /></label><Select label="排列" value={row.layout} disabled={state.readOnly || state.busy} options={layoutOptions} onChange={value => update(row.id, 'layout', value)} /><Select label="载流量口径" value={row.rating_basis || 'individual'} disabled={state.readOnly || state.busy} options={[{ value: 'simultaneous', label: '全回路等负荷' }, { value: 'individual', label: '首回路变化，其他回路保持保存负荷' }]} onChange={value => update(row.id, 'rating_basis', value)} /><label>环境 / °C{numericInput(row, 'ambient_temperature_c', '环境温度')}</label>{row.layout !== 'air' && <><label>中心埋深 / m{numericInput(row, 'depth_m', '中心埋深')}</label><label>土壤热阻率 / K·m/W{numericInput(row, 'soil_rho_k_m_w', '土壤热阻率')}</label></>}<label>中心距 / m{numericInput(row, 'spacing_m', '中心距')}</label><Select label="接地" value={row.bonding} disabled={state.readOnly || state.busy} options={[{ value: 'both_ends', label: '两端接地' }, { value: 'single_point', label: '单点接地' }, { value: 'unspecified', label: '待明确' }]} onChange={value => update(row.id, 'bonding', value)} />{(row.layout === 'ducts' || row.layout === 'three_core_ducts_horizontal') && <><label>管内径 / m{numericInput(row, 'duct_inner_m', '管内径')}</label><label>管外径 / m{numericInput(row, 'duct_outer_m', '管外径')}</label><label>管材热阻率 / K·m/W{numericInput(row, 'duct_rho_k_m_w', '管材热阻率')}</label></>}<label className="type-rating-source">条件来源<Input value={row.source || ''} readOnly={state.readOnly || state.busy} onChange={event => update(row.id, 'source', event.target.value)} /></label><Button size="compact" disabled={state.readOnly || state.busy} onClick={() => { const next = draft(); state.setRatingDraft({ ...next, body: { ...next.body, rows: next.body.rows.filter(item => item.case_id !== row.id), selected_case_ids: next.body.selected_case_ids?.filter(id => id !== row.id) ?? null } }); }}>删除工况</Button></div></details>}
      </>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!adding) setOpen(value); }} title="添加工况" description="选择排列后核对工况模板的尺寸、温度和来源。" actions={<Button variant="primary" loading={adding} disabled={!name.trim()} onClick={() => void add()}>添加到工况表</Button>}><div className="type-create-fields"><label className="type-form-label">工况名称<Input aria-label="工况名称" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter'&&name.trim()) { event.preventDefault(); void add(); } }} /></label><Select label="工况排列" value={layout} options={layoutOptions} onChange={value => setLayout(value as typeof layout)} /><label className="type-form-label">交流频率 / Hz<Input aria-label="交流频率 / Hz" inputMode="decimal" value={frequency} onChange={event=>setFrequency(event.target.value)} /></label>{error && <p role="alert" className="field-error">{error}</p>}</div></Dialog>
  </div>;
}
