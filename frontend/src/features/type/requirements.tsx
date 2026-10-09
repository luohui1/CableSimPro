import { useEffect, useRef, useState } from 'react';
import { CommandAction } from './command-slot';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, array, message, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { formatNumber } from '@/lib/format';
import { useTypeWorkspace } from './provider';
import { useTypeInspector } from './inspector';
import { typePath, useTypeNavigation } from './navigation';
import { chooseEvidence, currentEvidence, useTypeEvidence } from './evidence';
import { standardDefinition } from './standard-check';
import { TypeRunControl } from './run-control';
import { EvidenceDigest } from './evidence-digest';
import { ResourceBindings, StandardResourceCell } from './resource-bindings';

const states: Record<string, { label: string; kind: StatusKind }> = { proposed: { label: '待批准', kind: 'draft' }, approved: { label: '已批准', kind: 'success' }, conflict: { label: '版本冲突', kind: 'error' }, unbound: { label: '未定义 / 未覆盖', kind: 'unknown' } };
type Row = Record<string, unknown> & { id: string };
export function TypeRequirements({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), evidence = useTypeEvidence(), navigation = useTypeNavigation(), inspector = useTypeInspector(), queries = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set()), [filter, setFilter] = useState('all'), [picked, setPicked] = useState('');
  const [open, setOpen] = useState(false), [reviewer, setReviewer] = useState(''), [ack, setAck] = useState(false), [running, setRunning] = useState(false);
  const request = useRef<components['schemas']['ReviewRequirements'] | null>(null);
  let saved: ReturnType<typeof chooseEvidence> = null, parseError = '';
  try { saved = chooseEvidence(evidence.data, 'cablesim.standard-check/1', navigation.location.run, navigation.location.revision); } catch (error) { parseError = message(error); }
  const runId = text(saved?.run.id), current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.dirty) && !state.readOnly;
  const ledger = useQuery({ queryKey: ['type-requirements', state.workspace!.id, runId], enabled: !!runId,
    queryFn: async ({ signal }) => record(await responseData(api.GET('/api/design/type-workspaces/{wid}/requirements', { params: { path: { wid: state.workspace!.id }, query: { run_id: runId } }, signal })), '要求目录') });
  useEffect(() => { setSelected(new Set()); setPicked(''); setAck(false); request.current = null; }, [runId]);
  let rows: Row[] = [], standards: Row[] = [];
  try {
    if (ledger.data) {
      rows = array(ledger.data.items, '要求条目').map(value => { const row = record(value, '要求条目'); if (!text(row.id) || !text(row.row_id) || !states[text(row.state)]) throw new Error('要求条目缺少身份或批准状态'); return { ...row, id: text(row.id) }; });
      const grouped = new Map<string, Row>();
      for (const row of rows) { const definition = optionalRecord(row.definition), name = text(definition.standard); if (!grouped.has(name)) grouped.set(name, { id: name, name, clauses: new Set<string>(), verified: true, method: definition.method }); const group = grouped.get(name)!; (group.clauses as Set<string>).add(text(definition.clause)); group.verified = group.verified && definition.source_status === 'original-verified'; }
      const referenceField = state.readOnly ? 'snapshot_resource_reference' : 'resource_reference';
      standards = [...grouped.values()].map(group => ({ ...group, resource_reference: rows.find(row => text(optionalRecord(row.definition).standard) === group.name && row[referenceField])?.[referenceField] }));
    }
  } catch (error) { parseError = message(error); }
  const eligible = (row: Row) => current && ledger.data?.source_current === true && row.bindable === true;
  const approve = useMutation({ mutationFn: async () => {
    if (!current || !ack || !reviewer.trim() || !ledger.data || !selected.size || state.dirty || state.readOnly || [...selected].some(id => !rows.some(row => row.row_id === id && eligible(row)))) throw new Error('请核对当前要求并填写审批人');
    const revision = numeric(ledger.data.revision); if (revision === null) throw new Error('要求目录缺少审批修订');
    request.current ||= { request_id: crypto.randomUUID(), run_id: runId, row_ids: [...selected], expected_workspace_revision: state.workspace!.revision, expected_requirements_revision: revision, reviewer: reviewer.trim(), human_confirmed: true };
    return responseData(api.POST('/api/design/type-workspaces/{wid}/requirements/reviews', { params: { path: { wid: state.workspace!.id } }, body: request.current }));
  }, onSuccess: async () => { request.current = null; setSelected(new Set()); setAck(false); setOpen(false); await ledger.refetch(); await queries.invalidateQueries({ queryKey: ['type-specification', state.workspace!.id] }); await queries.invalidateQueries({ queryKey: ['type-list'] }); } });
  function choose(row: Row) {
    setPicked(row.id); const definition = optionalRecord(row.definition), target = optionalRecord(definition.target), approval = optionalRecord(row.approval), method = optionalRecord(definition.method);
    const layer = target.scope === 'core' ? text(target.core_id) + '/' + text(target.role) : 'common/' + text(target.role);
    inspector.show(text(definition.title), [{ label: '要求与来源', items: [{ label: '标准', value: text(definition.standard) }, { label: '条款', value: text(definition.clause) }, { label: '正文页码', value: numeric(definition.printed_page) ?? '未核验' }, { label: '批准状态', value: states[text(row.state)].label }, { label: '判定能力', value: row.bindable ? '已绑定 · ' + text(method.version) : '未完整绑定' }, { label: '来源摘要', value: <EvidenceDigest value={definition.source_digest} /> }] },
      ...(Object.keys(approval).length ? [{ label: '批准记录', items: [{ label: '审批人', value: text(approval.reviewer) }, { label: '批准日期', value: text(approval.created).slice(0, 10) }, { label: '记录摘要', value: <EvidenceDigest value={approval.digest} /> }] }] : []),
      ...(text(target.role) ? [{ label: '适用对象', items: [{ label: '结构', value: <Button variant="ghost" size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, 'structure', 'table', navigation.location.theme) + '&layer=' + encodeURIComponent(layer))}>定位结构层</Button> }] }] : [])]);
  }
  const visible = rows.filter(row => tab === 'pending' ? row.state !== 'approved' : filter === 'all' || row.state === filter);
  const bodyState = running || approve.isPending || evidence.isPending || !!runId && ledger.isPending ? 'loading' : parseError || evidence.error || ledger.error ? 'error' : !saved ? 'empty' : current && ledger.data?.source_current ? 'success' : 'historical';
  const definition = () => standardDefinition(state.workspace!.id, state.document!.name, state.document!.cable_types[0].id, current ? runId : undefined);
  return <div className="type-page" data-type-page="requirements-results" data-type-state={bodyState}>
    <div className="type-result-toolbar">{saved && <Button variant="primary" size="compact" disabled={!current || !selected.size || !!parseError || !!ledger.error || ledger.isPending || running} loading={approve.isPending} onClick={() => { setReviewer(''); setAck(false); request.current = null; approve.reset(); setOpen(true); }}>批准所选要求</Button>}
      <CommandAction><TypeRunControl channel="standard-check" label={saved ? '更新要求目录' : '生成要求目录'} primary={!saved} definition={definition} onBusy={setRunning} /></CommandAction>
      {saved && tab === 'list' && <Select label="批准状态" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部要求' }, ...Object.entries(states).map(([value, item]) => ({ value, label: item.label }))]} />}
    </div>
    {bodyState === 'loading' ? <LoadingState title="正在读取或更新要求目录" /> : bodyState === 'error' ? <ErrorState title="要求目录不可用" description={parseError || message(evidence.error || ledger.error)} action={<Button onClick={() => void Promise.all([evidence.refetch(), runId ? ledger.refetch() : Promise.resolve()])}>重新读取</Button>} /> : !saved ? <EmptyState title="尚无要求目录" description="保存型号后生成条款，再核对来源与批准状态。" /> : <>
      {!current && <StaleBanner description="当前显示历史要求；重新核对后才能批准。" />}
      <div className="type-result-summary"><strong>{rows.length} 项要求</strong><span>{numeric(ledger.data?.approved_count) || 0} 项已批准</span><span>{selected.size} 项已选</span></div>
      {tab === 'standards' && <ResourceBindings role="standard" />}
      {tab === 'standards' ? <DataTable label="执行标准" showGroups={false} rowLabel={row => text(row.name)} groups={[{ id: 'standards', label: '标准', rows: standards }]} columns={[{ id: 'name', label: '标准及版本', render: row => text(row.name) }, { id: 'clauses', label: '覆盖条款', wrap: true, render: row => [...row.clauses as Set<string>].join('；') }, { id: 'source', label: '来源', render: row => row.verified ? '原文已核验' : '待核验' }, { id: 'resource', label: '资源版本', render: row => <StandardResourceCell reference={row.resource_reference} /> }]} /> : <DataTable label="要求清单" selectedId={picked} onSelect={choose} rowLabel={row => text(optionalRecord(row.definition).title)} showGroups={false} groups={[{ id: 'requirements', label: '要求', rows: visible }]} columns={[
        { id: 'select', label: '选择', render: row => <input type="checkbox" aria-label={'选择' + text(optionalRecord(row.definition).title)} checked={selected.has(text(row.row_id))} disabled={!eligible(row) || approve.isPending} onChange={event => { setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(text(row.row_id)); else next.delete(text(row.row_id)); return next; }); request.current = null; }} /> },
        { id: 'title', label: '要求', wrap: true, render: row => text(optionalRecord(row.definition).title) }, { id: 'clause', label: '标准 / 条款', wrap: true, render: row => [text(optionalRecord(row.definition).standard), text(optionalRecord(row.definition).clause)].filter(Boolean).join(' · ') },
        { id: 'limit', label: '要求值', numeric: true, render: row => { const definition = optionalRecord(row.definition), value = numeric(definition.limit); return value === null ? '未定义' : formatNumber(value, 3) + (definition.unit === '1' ? '' : ' ' + text(definition.unit)); } },
        { id: 'state', label: '批准状态', render: row => <StatusMark {...states[text(row.state)]} /> },
      ]} />}
      {Array.isArray(saved.artifact.not_applicable) && saved.artifact.not_applicable.length > 0 && <details><summary>不适用条款</summary>{array(saved.artifact.not_applicable).map((value, index) => { const row = optionalRecord(value); return <p key={index}>{text(row.title)}：{text(row.reason)}</p>; })}</details>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!approve.isPending) setOpen(value); }} title="批准所选要求" description="确认来源与判定绑定；此操作不批准计算结果或发布型号。" initialFocus="form" actions={<Button variant="primary" disabled={!current || !ack || !reviewer.trim() || !selected.size} loading={approve.isPending} onClick={() => approve.mutate()}>批准所选要求</Button>}>
      <div className="type-create-fields"><label className="type-form-label">审批人<input className="type-name-input" value={reviewer} disabled={approve.isPending} maxLength={120} onChange={event => { setReviewer(event.target.value); request.current = null; }} /></label><label><input type="checkbox" checked={ack} disabled={!current || approve.isPending} onChange={event => setAck(event.target.checked)} /> 本人已核对所选要求的来源和判定绑定</label></div>{approve.error && <p className="field-error" role="alert">{message(approve.error)}</p>}
    </Dialog>
  </div>;
}
