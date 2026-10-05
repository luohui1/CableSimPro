import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, array, message, numeric, record, responseData, text, optionalRecord } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import type { components } from '@/api/generated/schema';
import { useTypeWorkspace } from './provider';

export function RequirementsReview({ runId, current }: { runId: string; current: boolean }) {
  const state = useTypeWorkspace(), queries = useQueryClient();
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set()), [reviewer, setReviewer] = useState(''), [ack, setAck] = useState(false);
  const request = useRef<components['schemas']['ReviewRequirements'] | null>(null);
  const ledger = useQuery({ queryKey: ['type-requirements', state.workspace?.id, runId], enabled: open && !!state.workspace,
    queryFn: async ({ signal }) => record(await responseData(api.GET('/api/design/type-workspaces/{wid}/requirements', { params: { path: { wid: state.workspace!.id }, query: { run_id: runId } }, signal })), '要求目录') });
  const approve = useMutation({ mutationFn: async () => {
    if (!current || state.dirty || state.readOnly || !ledger.data || !selected.size || !reviewer.trim() || !ack) throw new Error('请核对当前要求并填写审批人');
    const revision = numeric(ledger.data.revision); if (revision === null) throw new Error('要求目录缺少审批修订');
    request.current ||= { request_id: crypto.randomUUID(), run_id: runId, row_ids: [...selected], expected_workspace_revision: state.workspace!.revision, expected_requirements_revision: revision, reviewer: reviewer.trim(), human_confirmed: true };
    return responseData(api.POST('/api/design/type-workspaces/{wid}/requirements/reviews', { params: { path: { wid: state.workspace!.id } }, body: request.current }));
  }, onSuccess: async () => { request.current = null; setSelected(new Set()); setAck(false); await ledger.refetch(); await queries.invalidateQueries({ queryKey: ['type-specification', state.workspace?.id] }); } });
  let rows: (Record<string, unknown> & { id: string })[] = [], parseError = '';
  try { if (ledger.data) rows = array(ledger.data.items, '要求条目').map(value => { const item = record(value, '要求条目'); if (!text(item.id) || !text(item.row_id)) throw new Error('要求条目缺少身份'); return { ...item, id: text(item.id) }; }); } catch (error) { parseError = message(error); }
  const eligible = (row: Record<string, unknown>) => current && ledger.data?.source_current === true && row.bindable === true && !state.readOnly && !state.dirty;
  return <><Button size="compact" onClick={() => { request.current = null; setSelected(new Set()); setReviewer(''); setAck(false); approve.reset(); setOpen(true); }}>要求与批准记录</Button>
    <Dialog open={open} onOpenChange={value => { if (!approve.isPending) setOpen(value); }} title="核对要求与来源" description="来源、定义和判定绑定完整的要求，才可由人工批准。" initialFocus="form"
      actions={<Button variant="primary" disabled={!current || !ack || !reviewer.trim() || !selected.size || !!parseError || !!ledger.error || state.readOnly} loading={approve.isPending} onClick={() => approve.mutate()}>批准所选要求</Button>}>
      {ledger.isPending ? <LoadingState title="正在读取批准记录" /> : ledger.error || parseError ? <ErrorState title="要求目录读取失败" description={parseError || message(ledger.error)} action={<Button onClick={() => void ledger.refetch()}>重新读取</Button>} /> : <>
        <DataTable label="要求批准" showGroups={false} groups={[{ id: 'requirements', label: '要求', rows }]} rowLabel={row => text(optionalRecord(row.definition).title)} columns={[
          { id: 'select', label: '选择', render: row => <input type="checkbox" aria-label={'选择' + text(optionalRecord(row.definition).title)} disabled={!eligible(row) || approve.isPending} checked={selected.has(text(row.row_id))} onChange={event => { setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(text(row.row_id)); else next.delete(text(row.row_id)); return next; }); request.current = null; }} /> },
          { id: 'title', label: '要求', render: row => text(optionalRecord(row.definition).title) },
          { id: 'clause', label: '来源条款', render: row => [text(optionalRecord(row.definition).standard), text(optionalRecord(row.definition).clause)].filter(Boolean).join(' · ') || '未提供' },
          { id: 'state', label: '批准状态', render: row => ({ approved: '已批准', proposed: '待批准', conflict: '来源已变化', unbound: '未定义 / 未覆盖' }[text(row.state)] || '状态未提供') },
        ]} />
        <div className="type-create-fields"><label className="type-form-label" htmlFor="type-requirement-reviewer">审批人<input id="type-requirement-reviewer" className="type-name-input" value={reviewer} disabled={approve.isPending} maxLength={120} onChange={event => { setReviewer(event.target.value); request.current = null; }} /></label>
          <label><input type="checkbox" checked={ack} disabled={!current || state.readOnly || approve.isPending} onChange={event => setAck(event.target.checked)} /> 本人已核对所选要求的来源和判定绑定</label></div>
      </>}{approve.error && <p className="field-error" role="alert">{message(approve.error)}</p>}
    </Dialog>
  </>;
}
