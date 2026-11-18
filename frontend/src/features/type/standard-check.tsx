import { useState } from 'react';
import { CommandAction } from './command-slot';
import { api, ApiError, array, message, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { InlineEmpty, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import { displayText } from '@/lib/display-names';
import { useTypeWorkspace } from './provider';
import { useTypeNavigation, typePath } from './navigation';
import { artifactRows, chooseEvidence, currentEvidence, methodLabel, useTypeResultEvidence } from './evidence';
import { useTypeInspector } from './inspector';
import { TypeRunControl, methodForArtifact } from './run-control';
import { SavedRunPicker } from './saved-run-picker';
import { basisConditions } from './basis-display';
import { issuePresentation } from './result-presentation';
import { ResultTrace } from './result-detail';
import { MeasurementEntry, measurementSource } from './measurements';
import { EngineeringInputEntry } from './engineering-inputs';

const verdicts: Record<string, { kind: StatusKind; label: string }> = { passed: { kind: 'satisfied', label: '满足' }, failed: { kind: 'unsatisfied', label: '不满足' }, missing: { kind: 'unknown', label: '待补数据' }, uncovered: { kind: 'unknown', label: '未覆盖' } };
type StandardRow = Record<string, unknown> & { id: string };
function resultCounts(rows: StandardRow[]) { return Object.fromEntries(Object.keys(verdicts).map(key => [key, rows.filter(row => row.verdict === key).length])); }
export function resultValue(value: unknown, row: StandardRow) {
  const number = numeric(value); if (number === null) return '—';
  const percent = row.unit === '1' && /率|偏差/.test(text(row.title));
  return formatNumber(percent ? number * 100 : number, row.unit === 'Ω/km' ? 4 : percent ? 1 : row.unit === '1' ? 0 : 2) + (percent ? ' %' : row.unit === '1' ? '' : ' ' + text(row.unit));
}
function requirement(row: StandardRow) { const sign = { '>=': '≥', '<=': '≤', '=': '=' }[text(row.comparison)]; return numeric(row.limit) === null ? text(row.rule_requirement)||'未确定' : (sign || '') + ' ' + resultValue(row.limit, row); }
export async function standardDefinition(wid: string, name: string, cableId: string, currentRun?: string) {
  const signal=AbortSignal.timeout(45000);
  try {
  const method = await methodForArtifact('x-cablesim.standard-check');
  const input_sources: Record<string, { kind: 'user'; reference: string; reviewed: boolean }> = {};
  if (currentRun) {
    const catalog = record(await responseData(api.GET('/api/design/type-workspaces/{wid}/requirements', { params: { path: { wid }, query: { run_id: currentRun } }, signal })), '要求批准目录');
    if (numeric(catalog.approved_count) && text(catalog.approved_digest)) input_sources.requirements = { kind: 'user', reviewed: true, reference: `人工批准要求集 ${text(catalog.approved_digest)}；审批记录 ${array(catalog.review_references, '批准引用').join('；')}` };
  }
  const workspace=record(await responseData(api.GET('/api/workspaces/{wid}',{params:{path:{wid}},signal})), '型号输入');
  const response=await fetch(`/api/design/type-workspaces/${encodeURIComponent(wid)}/requirements/basis`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:numeric(workspace.revision)})});
  const value=await response.json();if(!response.ok)throw new ApiError(response.status,text(optionalRecord(value.detail).message)||text(value.detail)||'标准依据查询失败，请核对执行标准和型号条件后重试');
  const basis=record(value,'固定标准依据');
  return { title: name + ' · 产品标准核对', input_source: 'domain' as const, method, parameters: { cable_type_id: cableId, ...record(basis.parameters,'依据快照') }, input_sources };
  } catch(error) {
    if(error instanceof Error && error.name==='TimeoutError') throw new Error('标准依据查询超过 45 秒，请重新查询；已有保存结果仍保留。');
    throw error;
  }
}
export function TypeStandardCheck() {
  const state = useTypeWorkspace(), evidence = useTypeResultEvidence(), inspector = useTypeInspector(), navigation = useTypeNavigation();
  const [filter, setFilter] = useState('all'), [selected, setSelected] = useState(''), [running, setRunning] = useState(false);
  let saved: ReturnType<typeof chooseEvidence> = null, rows: StandardRow[] = [], error = '';
  try {
    saved = chooseEvidence(evidence.data, 'cablesim.standard-check/1', navigation.location.run, navigation.location.revision);
    if (saved) {
      rows = artifactRows(saved.artifact).map(row => { if (!text(row.id) || !text(row.title) || !verdicts[text(row.verdict)]) throw new ApiError(502, '标准工件含未知判定或缺少要求身份'); return { ...row, id: text(row.id) }; });
      const counts = record(saved.artifact.counts, '要求统计');
      const actual = resultCounts(rows);
      // The plugin publishes a sparse Counter: absent states are counted from the verified rows.
      if (Object.entries(counts).some(([key, value]) => !(key in actual) || numeric(value) !== actual[key])) throw new ApiError(502, '要求统计与保存的逐行判定不一致，未给出合规结论');
    }
  } catch (failure) { error = message(failure); }
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.inputDirty || !!state.methodDrafts['standard-check']);
  async function definition() {
    return standardDefinition(state.workspace!.id, state.document!.name, state.document!.cable_types[0].id, saved && current ? text(saved.run.id) : undefined);
  }
  function choose(row: StandardRow) {
    setSelected(row.id);
    const issue=issuePresentation(row,'standard-check',state.document!.cable_types[0].id);
    const target = optionalRecord(row.target);
    const located = text(target.role) ? target.scope === 'core' ? `${text(target.core_id)}/${text(target.role)}` : `common/${text(target.role)}` : '';
    inspector.show(text(row.title), [
      { label: '要求与结果', items: [ { label: '要求', value: requirement(row), source: 'standard', sourceDetail: text(row.standard) + ' · ' + text(row.clause) }, { label: '实际值', value: text(row.rule_actual)||resultValue(row.actual, row), source: 'calculation', sourceDetail: methodLabel(saved!.run) }, { label: '余量', value: resultValue(row.margin, row), source: 'calculation' }, { label: '判定', value: verdicts[text(row.verdict)].label }, { label: '原因', value: issue.kind==='history'?issue.reason:displayText(text(row.reason)) || '—' } ] },
      { label: '依据', items: [ { label: '标准', value: text(row.standard) || '未提供' }, { label: '条款', value: text(row.clause) || '未提供' }, { label: '正文页码', value: numeric(row.printed_page) ?? (row.source_status==='input-missing'?'补齐字段后查询':'本库暂未收录') }, { label: 'PDF 页码', value: numeric(row.pdf_page) ?? (row.source_status==='input-missing'?'补齐字段后查询':'本库暂未收录') }, { label: '依据', value: issue.kind==='history'?issue.label:row.source_status === 'original-verified' ? '依据已核验' : row.source_status==='input-missing'?text(row.reason):'本库暂未收录 · 下一轮' }, { label: '输入来源', value: measurementSource(row.input_source) } ] },
      ...(located ? [{ label: '关联结构', items: [{ label: '对象', value: <Button variant="ghost" size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, 'structure', 'table', navigation.location.theme) + '&layer=' + encodeURIComponent(located))}>定位结构层</Button> }] }] : []),
    ], <ResultTrace items={[{label:'完整实际值',value:row.actual==null?'未提供':String(row.actual)+' '+text(row.unit)},{label:'完整余量',value:row.margin==null?'未提供':String(row.margin)+' '+text(row.unit)}]} />);
  }
  function repair(row: StandardRow) {
    const issue = issuePresentation(row, 'standard-check', state.document!.cable_types[0].id);
    navigation.navigate(typePath(state.workspace!.id, issue.module, issue.tab, navigation.location.theme) + (issue.layer ? '&layer=' + encodeURIComponent(issue.layer) : '') + (issue.field ? '&field=' + encodeURIComponent(issue.field) : ''));
  }
  const counts = resultCounts(rows);
  const bodyState = running || evidence.isPending ? 'loading' : error || evidence.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  return <div className="type-page" data-type-page="standard-check-results" data-type-state={bodyState}>
    <div className="type-result-toolbar"><CommandAction><TypeRunControl channel="standard-check" label="执行标准核对" definition={definition} onBusy={setRunning} /></CommandAction><Button size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, 'requirements', 'list', navigation.location.theme))}>要求与批准记录</Button>
      {saved && <><SavedRunPicker schema="cablesim.standard-check/1" /><Select label="要求状态" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部要求' }, ...Object.entries(verdicts).map(([value, item]) => ({ value, label: item.label }))]} /><MeasurementEntry checks={rows.map(result=>({result}))}/><EngineeringInputEntry checks={rows.map(result=>({result}))}/></>}</div>
    {bodyState === 'loading' ? <LoadingState title="正在读取或核对型号要求" /> : bodyState === 'error' ? <ErrorState title="标准核对不可用" description={error || message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取</Button>} /> : !saved ? <InlineEmpty title="尚无标准核对结果，使用命令栏执行核对。" /> : <>
      {!current && <StaleBanner description="输入或方法已变化；保留原要求与判定，人工批准保持关闭。" />}
      <div className="type-result-summary"><strong>{!rows.length ? '暂无适用要求' : numeric(counts.failed) ? `${numeric(counts.failed)} 项不满足` : numeric(counts.missing) || numeric(counts.uncovered) ? '核对尚未完整覆盖' : '声明范围内要求满足'}</strong>
        <span>{formatNumber(numeric(counts.missing))} 项待补数据</span><span>{formatNumber(numeric(counts.uncovered))} 项未覆盖</span><SourceBadge kind="standard" detail={methodLabel(saved.run) + '；判定直接来自保存的标准工件'} /></div>
      <DataTable label="标准核对" selectedId={selected} onSelect={choose} rowLabel={row => text(row.title)} showGroups={false} groups={[{ id: 'requirements', label: '要求', rows: rows.filter(row => filter === 'all' || row.verdict === filter) }]} columns={[
        { id: 'title', label: '要求', wrap: true, render: row => <div className="type-requirement"><strong>{text(row.title)} · {requirement(row)}</strong><small title={basisConditions(optionalRecord(optionalRecord(row.basis_reference).record).conditions)}>{text(row.citation)?.replace(/（PDF.*$/,'') || [text(row.standard),text(row.clause)].filter(Boolean).join(' · ') || '本库暂未收录 · 下一轮'}</small>{row.verdict !== 'passed' && <><small>{issuePresentation(row, 'standard-check', state.document!.cable_types[0].id).label} · {issuePresentation(row, 'standard-check', state.document!.cable_types[0].id).reason}</small><Button variant="ghost" size="compact" onClick={event => { event.stopPropagation(); repair(row); }}>{issuePresentation(row, 'standard-check', state.document!.cable_types[0].id).action}</Button></>}</div> }, { id: 'actual', label: '实际值', numeric: true, render: row => text(row.rule_actual)||resultValue(row.actual, row) },
        { id: 'margin', label: '余量', numeric: true, render: row => resultValue(row.margin, row) }, { id: 'verdict', label: '判定', render: row => <StatusMark {...verdicts[text(row.verdict)]} /> },
      ]} />
    </>}
  </div>;
}
