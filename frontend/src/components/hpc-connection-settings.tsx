import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import { hpcConfiguration, saveHpcConfiguration, undoHpcConfiguration, checkHpcConnection, type HpcConfiguration, type HpcConnection, type ConnectionCheck } from '@/lib/hpc-configuration';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/states';
import { StatusMark } from '@/components/status-mark';

type Form = { ssh_alias: string; partition: string; remote_workdir: string; kind: 'python' | 'conda'; path: string; budget_core_hours: string; total_budget_core_hours: string };
const fields = (data: HpcConnection | null): Form => ({ ssh_alias: data?.ssh_alias || '', partition: data?.partition || '', remote_workdir: data?.remote_workdir || '', kind: data?.environment?.kind || 'python', path: data?.environment?.path || '', budget_core_hours: data?.budget_core_hours == null ? '' : String(data.budget_core_hours), total_budget_core_hours: data?.total_budget_core_hours == null ? '' : String(data.total_budget_core_hours) });
const checkItems = [
  { key: 'reachable', name: '主机可达', fail: '无法连接' },
  { key: 'partition_exists', name: '分区', fail: '不存在' },
  { key: 'directory_writable', name: '目录可写', fail: '不存在或不可写' },
  { key: 'environment_available', name: '环境可用', fail: '不可执行' },
] as const;

/** 编辑的是连接与预算；只有点击“测试连接”才会打开 SSH。 */
export function HpcConnectionSettings() {
  const queries = useQueryClient(), element = useRef<HTMLFormElement>(null);
  const query = useQuery({ queryKey: ['hpc-configuration'], queryFn: ({ signal }) => hpcConfiguration(signal), retry: false });
  const [form, setForm] = useState<Form>(() => fields(null)), [baseline, setBaseline] = useState<Form>(() => fields(null));
  const [loaded, setLoaded] = useState(false), [notice, setNotice] = useState('');
  const [editRevision, setEditRevision] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<{ revision: string; result: ConnectionCheck } | null>(null);
  const data = query.data, dirty = loaded && !!data?.editable && JSON.stringify(form) !== JSON.stringify(baseline);
  const hydrate = (value: HpcConfiguration) => { const next = fields(value.configuration); setForm(next); setBaseline(next); setEditRevision(value.revision); setLoaded(true); };
  useEffect(() => { if (data && (!loaded || !dirty && data.revision !== editRevision)) hydrate(data); }, [data, loaded, dirty, editRevision]);
  const invalidate = () => queries.invalidateQueries({ predicate: item => {
    const key = String(item.queryKey[0]);
    return key === 'hpc-profile' || /availability|estimate|preflight/.test(key);
  } });
  const focusIssue = (field: string) => window.requestAnimationFrame(() => {
    const node = [...(element.current?.querySelectorAll<HTMLElement>('[data-hpc-field]') || [])].find(item => item.dataset.hpcField === field);
    node?.querySelector<HTMLElement>('input,button')?.focus(); node?.scrollIntoView({ block: 'nearest' });
  });
  const onError = (error: unknown) => {
    const detail = error instanceof ApiError ? optionalRecord(error.detail) : {}, rows = Array.isArray(detail.issues) ? detail.issues : [];
    const next: Record<string, string> = {};
    for (const value of rows) { const row = optionalRecord(value); if (text(row.field) && text(row.message)) next[text(row.field)] = text(row.message); }
    setIssues(next); if (Object.keys(next)[0]) focusIssue(Object.keys(next)[0]);
  };
  const save = useMutation({ mutationFn: () => saveHpcConfiguration({ ssh_alias: form.ssh_alias, partition: form.partition.trim(), remote_workdir: form.remote_workdir.trim(), environment: { kind: form.kind, path: form.path.trim() }, budget_core_hours: Number(form.budget_core_hours), total_budget_core_hours: Number(form.total_budget_core_hours), expected_revision: editRevision }),
    onError, onSuccess: (receipt) => {
      const next = { ...form, partition: form.partition.trim(), remote_workdir: form.remote_workdir.trim(), path: form.path.trim() };
      setForm(next); setBaseline(next); setEditRevision(receipt.revision); setIssues({}); setChecked(null); test.reset(); setNotice('已保存 · 未检查连接');
      queries.setQueryData<HpcConfiguration>(['hpc-configuration'], { ...data!, ...receipt, configuration: { ssh_alias: next.ssh_alias, partition: next.partition, remote_workdir: next.remote_workdir, environment: { kind: next.kind, path: next.path }, budget_core_hours: Number(next.budget_core_hours), total_budget_core_hours: Number(next.total_budget_core_hours) } });
      void queries.invalidateQueries({ queryKey: ['hpc-configuration'] }); void invalidate();
    } });
  const undo = useMutation({ mutationFn: async () => {
      await undoHpcConfiguration({ undo_token: data!.undo_token!, expected_revision: data!.revision });
      return hpcConfiguration();
    }, onError, onSuccess: (value) => {
      queries.setQueryData(['hpc-configuration'], value); hydrate(value); setChecked(null); test.reset(); setIssues({}); save.reset();
      setNotice(value.configured ? '已撤销这次修改 · 未检查连接' : '已撤销这次修改 · 超算未配置'); void invalidate();
    } });
  const test = useMutation({ mutationFn: checkHpcConnection, onSuccess: result => { setChecked({ revision: data!.revision, result }); setNotice(''); } });
  const busy = save.isPending || undo.isPending || test.isPending;
  const ready = !!data?.editable && loaded && !busy;
  const canSave = ready && dirty, canUndo = ready && !dirty && !!data?.undo_token;
  const discard = () => { setForm(baseline); setIssues({}); save.reset(); undo.reset(); };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (canSave) element.current?.requestSubmit(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !dirty && canUndo) { event.preventDefault(); undo.mutate(); }
      if (event.key === 'Escape' && dirty && !busy) discard();
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  });
  const update = (name: keyof Form, field = name as string) => (value: string) => {
    if (!ready) return;
    setChecked(null); test.reset();
    setForm(current => ({ ...current, [name]: value })); setIssues(current => { const next = { ...current }; delete next[field]; return next; });
    setNotice(''); save.reset(); undo.reset();
  };
  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.ssh_alias) next.ssh_alias = '请选择本机 SSH 配置中的主机别名。';
    if (!form.partition.trim()) next.partition = '请填写要使用的分区。';
    if (!form.remote_workdir.trim()) next.remote_workdir = '请填写完整的远程工作目录。';
    if (!form.path.trim()) next['environment.path'] = '请填写 Python 环境的根目录。';
    const batch = Number(form.budget_core_hours), total = Number(form.total_budget_core_hours);
    if (!Number.isFinite(batch) || batch <= 0 || batch > 2000) next.budget_core_hours = '填写大于 0、最多 2000 的核时预算。';
    if (!Number.isFinite(total) || total <= 0 || total > 20000 || total < batch) next.total_budget_core_hours = '累计预算须不小于单批预算，最多 20000 核时。';
    setIssues(next); if (Object.keys(next).length) { focusIssue(Object.keys(next)[0]); return false; } return true;
  };
  const result = checked?.revision === data?.revision ? checked?.result : undefined;
  const state = query.isPending ? 'loading' : query.error || save.error || undo.error || test.error || result && result.status !== 'ready' ? 'error' : busy ? 'loading' : !data?.configured ? 'empty' : notice.startsWith('已撤销') ? 'historical' : 'success';
  return <section className="settings-card hpc-connection" aria-label="超算连接" data-state={state} data-editable={data?.editable}>
    <div className="settings-card-head"><b>超算连接</b>{data && <StatusMark kind={dirty ? 'draft' : busy ? 'running' : data.configured ? 'saved' : 'draft'} label={dirty ? '修改未保存' : busy ? '处理中' : data.configured ? '已配置' : '未配置'} />}</div>
    {query.isPending ? <LoadingState title="正在读取超算连接" /> : query.error || !data ? <ErrorState title="超算连接读取失败" description={message(query.error)} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} /> :
    <form ref={element} className="hpc-connection-form" noValidate onSubmit={event => { event.preventDefault(); if (canSave && validate()) save.mutate(); }}>
      {!data.editable && <p className="muted" role="status">管理员已指定外部配置文件，本页只读。请联系管理员修改连接参数。</p>}
      {data.status === 'invalid' && <p className="field-error" role="alert">已有超算配置无效，请修正后保存。</p>}
      <fieldset className="settings-fields" disabled={!ready}>
        <div className="settings-form-pair">
          <div data-hpc-field="ssh_alias"><Select label="SSH 别名" value={form.ssh_alias} disabled={!ready} onChange={update('ssh_alias')} options={[...data.ssh_aliases.map(alias => ({ value: alias, label: alias })), ...(form.ssh_alias && !data.ssh_aliases.includes(form.ssh_alias) ? [{ value: form.ssh_alias, label: form.ssh_alias + '（已不在本机配置中）', disabled: true }] : [])]} error={issues.ssh_alias} placeholder="选择已有主机别名" />
            {!data.ssh_aliases.length && <FieldDescription>本机没有可用别名，请管理员先配置 SSH，再重新读取。</FieldDescription>}
          </div>
          <Field data-hpc-field="partition"><FieldLabel htmlFor="hpc-partition">分区</FieldLabel><Input id="hpc-partition" value={form.partition} onChange={event => update('partition')(event.target.value)} aria-invalid={!!issues.partition} aria-describedby={issues.partition ? 'hpc-partition-error' : undefined} autoComplete="off" spellCheck={false} />{issues.partition && <FieldError id="hpc-partition-error">{issues.partition}</FieldError>}</Field>
        </div>
        <Field data-hpc-field="remote_workdir"><FieldLabel htmlFor="hpc-directory">远程工作目录</FieldLabel><Input id="hpc-directory" value={form.remote_workdir} onChange={event => update('remote_workdir')(event.target.value)} aria-invalid={!!issues.remote_workdir} aria-describedby={issues.remote_workdir ? 'hpc-directory-error' : 'hpc-directory-help'} autoComplete="off" spellCheck={false} />{issues.remote_workdir ? <FieldError id="hpc-directory-error">{issues.remote_workdir}</FieldError> : <FieldDescription id="hpc-directory-help">填写已准备好的绝对路径；测试连接不会创建目录。</FieldDescription>}</Field>
        <div className="settings-form-pair">
          <div data-hpc-field="environment.kind"><Select label="环境" value={!data.editable && !data.configuration?.environment ? '' : form.kind} disabled={!ready} placeholder="未登记" onChange={value => update('kind', 'environment.kind')(value)} options={[{ value: 'python', label: 'Python' }, { value: 'conda', label: 'Conda' }]} error={issues['environment.kind'] || issues.environment} /></div>
          <Field data-hpc-field="environment.path"><FieldLabel htmlFor="hpc-environment">环境目录</FieldLabel><Input id="hpc-environment" value={form.path} onChange={event => update('path', 'environment.path')(event.target.value)} aria-invalid={!!issues['environment.path']} aria-describedby={issues['environment.path'] ? 'hpc-environment-error' : 'hpc-environment-help'} autoComplete="off" spellCheck={false} />{issues['environment.path'] ? <FieldError id="hpc-environment-error">{issues['environment.path']}</FieldError> : <FieldDescription id="hpc-environment-help" title="该目录须包含 bin/python">填写 Python 或 Conda 环境的根目录。</FieldDescription>}</Field>
        </div>
        <div className="settings-form-pair">
          {(['budget_core_hours', 'total_budget_core_hours'] as const).map((name, i) => <Field key={name} data-hpc-field={name}><FieldLabel htmlFor={'hpc-' + name}>{i ? '累计核时预算' : '单批核时预算'}</FieldLabel><div className="settings-inline"><Input id={'hpc-' + name} type="number" min={0} max={i ? 20000 : 2000} step="any" value={form[name]} onChange={event => update(name)(event.target.value)} aria-invalid={!!issues[name]} aria-describedby={issues[name] ? 'hpc-' + name + '-error' : undefined} /><span>核时</span></div>{issues[name] && <FieldError id={'hpc-' + name + '-error'}>{issues[name]}</FieldError>}</Field>)}
        </div>
      </fieldset>
      {!!data.editable && <div className="settings-actions"><Button type="submit" variant="primary" loading={save.isPending} disabled={!canSave}>保存连接</Button>
        {dirty ? <Button type="button" variant="ghost" disabled={busy} onClick={discard}>放弃修改</Button> : data.undo_token && <Button type="button" variant="ghost" loading={undo.isPending} disabled={!canUndo} onClick={() => undo.mutate()}>撤销这次修改</Button>}
      </div>}
      {!!(save.error || undo.error) && <div role="alert"><p className="field-error">{message(save.error || undo.error)}</p>{(save.error instanceof ApiError && save.error.status === 409 || undo.error instanceof ApiError && undo.error.status === 409) && <Button type="button" variant="ghost" disabled={busy} onClick={async () => { const reply = await query.refetch(); if (reply.data) { queries.setQueryData(['hpc-configuration'], reply.data); setEditRevision(reply.data.revision); setBaseline(fields(reply.data.configuration)); setChecked(null); save.reset(); undo.reset(); setNotice('已重新读取；保留未保存修改，请核对后保存。'); } }}>重新读取配置</Button>}</div>}
      {notice && <p className="hpc-notice" role="status">{notice}</p>}
      <div className="settings-test"><Button type="button" loading={test.isPending} disabled={busy || dirty || !data.configured} onClick={() => test.mutate()}>测试连接</Button><span className="muted">{dirty ? '先保存修改，再检查连接。' : !data.configured ? '先保存完整连接配置。' : result ? '本次只检查连接条件，未提交作业。' : '尚未检查连接；已配置不代表可用。'}</span></div>
      {test.isPending && <p role="status">正在检查连接、分区、目录和环境…</p>}
      {test.error && <p className="field-error" role="alert">{message(test.error)}</p>}
      {result && <div className="hpc-check-result" aria-label="连接检查结果"><ul>{checkItems.map(item => <li key={item.key}><span>{item.name}</span><StatusMark kind={result[item.key] === true ? 'current' : result[item.key] === false ? 'error' : 'draft'} label={result[item.key] === true ? '通过' : result[item.key] === false ? item.fail : '未检查'} /></li>)}</ul><p className={result.status === 'ready' ? 'muted' : 'field-error'} role={result.status === 'ready' ? 'status' : 'alert'}>{result.message}</p></div>}
      {data.configuration_file && <details className="settings-help muted"><summary>配置文件位置</summary><code>{data.configuration_file}</code></details>}
    </form>}
  </section>;
}
