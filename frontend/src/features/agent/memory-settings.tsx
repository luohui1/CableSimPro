import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { studyIndex, workspaces } from '@/api/research';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState, InlineEmpty, LoadingState } from '@/components/states';
import { formatDateTime } from '@/lib/format';
import { agentMemories, correctMemory, deleteMemory, memorySettings, saveMemorySettings, type AgentMemory } from './agent-api';

const KINDS: Record<string, string> = { preference: '偏好', goal: '目标', decision: '历史决定', lesson: '经验' };

function MemoryEditor({ item, deleting, onClose, onSaved }: { item: AgentMemory; deleting: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [content, setContent] = useState(item.content);
  const action = useMutation({ retry: false, mutationFn: () => deleting ? deleteMemory(item) : correctMemory(item, content.trim()), onSuccess: onSaved });
  const valid = !!content.trim() && content.length <= 800 && content.trim() !== item.content;
  return <form className="memory-editor" onSubmit={event => { event.preventDefault(); if (!action.isPending && (deleting || valid)) action.mutate(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !action.isPending) { event.stopPropagation(); onClose(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); if (!deleting && valid && !action.isPending) event.currentTarget.requestSubmit(); } }}>
    {deleting ? <p>删除这条记忆？删除后不再召回，聊天记录和原始审计仍保留。</p> : <label className="text-field">纠正内容<Textarea aria-label="纠正内容" value={content} maxLength={800} disabled={action.isPending} rows={3} onChange={event => { setContent(event.target.value); action.reset(); }} /></label>}
    <div className="settings-actions"><Button type="submit" size="compact" loading={action.isPending} disabled={action.isPending || (!deleting && !valid)}>{deleting ? '确认删除' : '保存纠正'}</Button><Button type="button" size="compact" variant="ghost" disabled={action.isPending} onClick={onClose}>取消</Button></div>
    {action.error && <p role="alert" className="field-error">{message(action.error)}。内容已保留；取消后重新读取，再核对这条记忆。</p>}
  </form>;
}

function MemoryManager() {
  const queries = useQueryClient();
  const objects = useQuery({ queryKey: ['workspace-index'], queryFn: ({ signal }) => workspaces(signal), retry: false });
  const studies = useQuery({ queryKey: ['study-index'], queryFn: ({ signal }) => studyIndex(signal), retry: false });
  const [selected, setSelected] = useState(''), [study, setStudy] = useState(''), [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const [edit, setEdit] = useState<{ item: AgentMemory; deleting: boolean }>();
  const query = useDeferredValue(q);
  const workspace = selected || String(objects.data?.[0]?.id || '');
  const list = useQuery({ queryKey: ['agent-memories', workspace, study, query, offset], enabled: !!workspace,
    queryFn: ({ signal }) => agentMemories({ workspace_id: workspace, ...(study ? { study_id: study } : {}), q: query, offset }, signal), retry: false });
  const reset = () => { setOffset(0); setEdit(undefined); };
  const saved = async () => { setEdit(undefined); setOffset(0); await queries.invalidateQueries({ queryKey: ['agent-memories'] }); };
  return <section className="memory-manager" aria-label="记忆管理">
    {objects.isPending ? <LoadingState title="正在读取工作对象" /> : objects.isError ? <ErrorState description={message(objects.error)} action={<Button onClick={() => void objects.refetch()}>重新读取对象</Button>} /> : !workspace ? <InlineEmpty title="还没有工程或型号；创建后可按对象查看记忆。" /> : <>
      <div className="memory-filters"><Select label="所属工程或型号" value={workspace} onChange={value => { setSelected(value); setStudy(''); reset(); }} options={(objects.data || []).map(row => ({ value: String(row.id), label: String(row.name) }))} />
        <Select label="研究范围" value={study} onChange={value => { setStudy(value); reset(); }} disabled={studies.isPending || studies.isError} options={[{ value: '', label: '对象级记忆' }, ...(studies.data || []).filter(row => row.workspace === workspace).map(row => ({ value: row.id, label: row.title }))]} />
        <label className="search-field">检索<input value={q} maxLength={256} onChange={event => { setQ(event.target.value); reset(); }} placeholder="主题或内容" /></label></div>
      <p className="muted">选择研究时，同时列出该研究和所属对象的记忆；检索按相关度排序。</p>
      {studies.isError && <ErrorState title="研究范围读取失败" description={message(studies.error)} action={<Button onClick={() => void studies.refetch()}>重新读取研究</Button>} />}
      {list.isPending ? <LoadingState title="正在读取记忆" /> : list.isError ? <ErrorState title="记忆读取失败" description={message(list.error)} action={<Button onClick={() => void list.refetch()}>重新读取记忆</Button>} /> : !list.data?.items.length ? <InlineEmpty title="此范围还没有记忆。" /> : <>
        <div className="memory-list">{list.data.items.map(item => <article key={item.id} className="memory-item" data-memory-status={item.status}>
          <header><b>{item.topic}</b><span className="muted">{KINDS[item.kind] || '历史参考'} · {item.status === 'outdated' ? '已过期' : item.status === 'corrected' ? '已纠正' : '已记录'}</span></header>
          <p>{item.content}</p>{item.reason && <p className="muted">{item.reason}（不会作为当前记忆召回）</p>}
          <details className="muted"><summary>来源与时间</summary><p>{formatDateTime(item.updated)} · 第 {item.revision} 修订</p><ul>{item.sources.map(source => <li key={source.task_id + ':' + source.sequence}><a href={'/agent?task=' + encodeURIComponent(source.task_id)}>查看来源会话</a> · 第 {source.sequence} 条事件</li>)}</ul></details>
          {edit?.item.id === item.id ? <MemoryEditor key={item.id + ':' + edit.item.revision + ':' + edit.deleting} {...edit} onClose={() => { setEdit(undefined); void list.refetch(); }} onSaved={saved} /> : <div className="settings-actions"><Button size="compact" variant="ghost" disabled={!!edit} onClick={() => setEdit({ item, deleting: false })}>纠正</Button><Button size="compact" variant="ghost" disabled={!!edit} onClick={() => setEdit({ item, deleting: true })}>删除</Button></div>}
        </article>)}</div>
        <div className="settings-actions"><Button size="compact" disabled={!offset || !!edit} onClick={() => setOffset(value => Math.max(0, value - 10))}>上一页</Button><span className="muted">{offset + 1}–{offset + list.data.items.length} / {list.data.total}</span><Button size="compact" disabled={offset + 10 >= list.data.total || !!edit} onClick={() => setOffset(value => value + 10)}>下一页</Button></div>
      </>}
    </>}
  </section>;
}

export function AgentMemorySettings() {
  const queries = useQueryClient();
  const settings = useQuery({ queryKey: ['agent-memory-settings'], queryFn: ({ signal }) => memorySettings(signal), retry: false });
  const save = useMutation({ retry: false, mutationFn: (enabled: boolean) => saveMemorySettings({ enabled, recall_limit: settings.data!.recall_limit }), onSuccess: data => { queries.setQueryData(['agent-memory-settings'], data); } });
  const [managing, setManaging] = useState(false);
  return <section className="settings-memory" aria-label="长期记忆">
    <h3 className="settings-subhead">长期记忆</h3><p className="muted">记住偏好与历史经验，按工程和研究隔离。记忆不是工程依据，也不代表批准。</p>
    {settings.isPending ? <LoadingState title="正在读取记忆设置" /> : settings.isError ? <ErrorState title="记忆设置读取失败" description={message(settings.error)} action={<Button onClick={() => void settings.refetch()}>重新读取记忆设置</Button>} /> : <>
      <div className="settings-row"><div><b>启用长期记忆</b><p className="muted">{!settings.data.available ? '需要先安装依赖' : save.isPending ? '保存中' : settings.data.enabled ? '已开启 · 新对话会按范围召回' : '已关闭 · 不抽取或召回新记忆'}</p></div><Switch aria-label="启用长期记忆" checked={settings.data.enabled} disabled={!settings.data.available || save.isPending} onCheckedChange={enabled => save.mutate(enabled)} /></div>
      <details className="settings-help muted"><summary>了解记忆的使用方式</summary><p>开关单独保存、立即生效。关闭会取消待处理抽取，已保存记忆仍可查看、纠正或删除；抽取可能额外调用模型，数值结论仍须读取真实输入和运行。服务端需要安装 LangMem 依赖。</p></details>
      {settings.data.worker_error && <p role="alert" className="field-error">记忆后台处理失败：{settings.data.worker_error}。对话记录仍保留。</p>}
    </>}
    {save.error && <p role="alert" className="field-error">{message(save.error)}。开关保留服务端已保存状态，请重试。</p>}
    <details className="memory-management" onToggle={event => setManaging(event.currentTarget.open)}><summary>管理记忆 · 查看、纠正、删除</summary>{managing && <MemoryManager />}</details>
  </section>;
}
