import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from '@/api/client';
import { AppShell } from '@/components/app-shell';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusMark } from '@/components/status-mark';
import { SourceBadge } from '@/components/source-badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { createType, listTypes, modelChoices } from './api';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import { cleanLabel } from './labels';

export function TypeListPage() {
  const { location, navigate, onTheme } = useTypeNavigation(), queries = useQueryClient();
  const types = useQuery({ queryKey: ['type-list'], queryFn: ({ signal }) => listTypes(signal) });
  const [filter, setFilter] = useState(''), [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  const models = useQuery({ queryKey: ['type-model-choices'], queryFn: ({ signal }) => modelChoices(signal), enabled: open });
  const identity = useRef({ model: '', request: '' });
  const create = useMutation({ mutationFn: async () => {
    const model = models.data?.find(model => model.id === selected); if (!model) throw new Error('请选择基准型号版本');
    if (identity.current.model !== model.id) identity.current = { model: model.id, request: crypto.randomUUID() };
    return createType(model, identity.current.request);
  }, onSuccess: async wid => { await queries.invalidateQueries({ queryKey: ['type-list'] }); setOpen(false); navigate(typePath(wid, 'structure', 'section', location.theme)); } });
  const rows = (types.data || []).filter(row => row.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const [info, setInfo] = useState('');
  return <AppShell title="型号" status={<><span className="muted">设计与发布</span>{rows.some(row => cleanLabel(row.name) !== row.name) && <SourceBadge kind="demo" detail="列表含系统演示型号，详细字段来源保留在型号工作区。" />}</>} activeNavigation="型号" theme={location.theme} onTheme={onTheme} onUnavailable={name => setInfo(name + '尚未接入')}
    sidebar={<button type="button" className="module-item" aria-current="page" onClick={() => {}}>型号列表</button>}
    actions={<Button variant="primary" onClick={() => { create.reset(); setOpen(true); }}>新建型号</Button>}>
    <div className="type-list-toolbar"><label htmlFor="type-search">查找型号</label><input id="type-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="型号名称" type="search" /></div>
    {info && <p className="type-notice" role="status">{info}</p>}
    <div className="type-page" data-type-page="list" data-type-state={types.isPending ? 'loading' : types.error ? 'error' : !types.data?.length ? 'empty' : rows.length && rows.every(row => row.status === 'published') ? 'historical' : 'success'}>
      {types.isPending ? <LoadingState title="正在读取型号" /> : types.error ? <ErrorState title="型号列表读取失败" description={message(types.error)} action={<Button onClick={() => void types.refetch()}>重新读取</Button>} /> : !types.data?.length ? <EmptyState title="尚无型号" description="从一个明确的型号版本建立独立设计草稿。" />
        : <DataTable label="型号" columns={[
          { id: 'name', label: '型号名称', render: row => <button className="object-link" type="button" onClick={event => { event.stopPropagation(); navigate(typePath(row.id, 'structure', 'section', location.theme)); }}>{cleanLabel(row.name)}</button> },
          { id: 'version', label: '基准版本', render: row => row.version || '未提供' },
          { id: 'status', label: '状态', render: row => <StatusMark kind={row.status === 'published' ? 'historical' : 'draft'} label={row.status === 'published' ? '已发布 · 只读' : '设计草稿'} /> },
          { id: 'updated', label: '更新时间', render: row => row.updated ? new Date(row.updated).toLocaleString('zh-CN', { hour12: false }) : '未提供' },
        ]} groups={['published', 'draft'].map(status => ({ id: status, label: status === 'published' ? '已发布型号' : '草稿与方案', rows: rows.filter(row => row.status === status) }))} rowLabel={row => row.name} onActivate={row => navigate(typePath(row.id, 'structure', 'section', location.theme))} />}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!create.isPending) setOpen(value); }} title="新建型号草稿" description="选择基准型号版本。保存草稿后再审核发布。" initialFocus="form"
      actions={<Button variant="primary" disabled={!selected || !models.data?.some(model => model.id === selected) || !!models.error} loading={create.isPending} onClick={() => create.mutate()}>建立型号草稿</Button>}>
      {models.isPending ? <LoadingState title="正在读取基准型号" /> : models.error ? <ErrorState title="基准型号读取失败" description={message(models.error)} action={<Button onClick={() => void models.refetch()}>重新读取</Button>} /> : !models.data?.length ? <EmptyState title="没有可用基准型号" description="基准型号接口尚未提供可复制的完整工程输入。" />
        : <div className="type-create-fields"><Select label="基准型号版本" value={selected} onChange={value => { setSelected(value); create.reset(); }} disabled={create.isPending} options={models.data.map(model => ({ value: model.id, label: `${cleanLabel(model.name)} · ${model.version} · ${model.workspace ? '已发布' : '系统型号'}` }))} />
          {selected && !models.data.find(model => model.id === selected)?.workspace && <p className="muted">系统型号为演示输入，设计前需核对材料与参数来源。</p>}</div>}
      {create.error && <p className="field-error" role="alert">{message(create.error)}</p>}
    </Dialog>
  </AppShell>;
}
