import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from '@/api/client';
import { CatalogShell } from '@/components/catalog-shell';
import { DataTable } from '@/components/data-table';
import { InlineEmpty, ErrorState, LoadingState } from '@/components/states';
import { StatusMark } from '@/components/status-mark';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { createType, listTypes, modelChoices } from './api';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import { cleanLabel } from './labels';
import { DesignCard } from './design-card';
import { designSummary, publicationLabels, versionLabel } from './design-summary';

export function TypeListPage() {
  const { location, navigate } = useTypeNavigation(), queries = useQueryClient();
  const types = useQuery({ queryKey: ['type-list'], queryFn: ({ signal }) => listTypes(signal) });
  const [filter, setFilter] = useState(''), [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  const [picked, setPicked] = useState(''), [statusFilter, setStatusFilter] = useState('all'), [groupBy, setGroupBy] = useState('status');
  const models = useQuery({ queryKey: ['type-model-choices'], queryFn: ({ signal }) => modelChoices(signal), enabled: open });
  const identity = useRef({ model: '', request: '' });
  const create = useMutation({ mutationFn: async () => {
    const model = models.data?.find(model => model.id === selected); if (!model) throw new Error('请选择基准型号版本');
    if (identity.current.model !== model.id) identity.current = { model: model.id, request: crypto.randomUUID() };
    return createType(model, identity.current.request);
  }, onSuccess: async wid => { await queries.invalidateQueries({ queryKey: ['type-list'] }); setOpen(false); navigate(typePath(wid, 'structure', 'section', location.theme)); } });
  const rows = (types.data || []).filter(row => row.name.toLowerCase().includes(filter.trim().toLowerCase()) && (statusFilter === 'all' || row.status === statusFilter)).map(row => ({ ...row, card: designSummary(row.document, row.raw) }));
  const current = types.data?.find(row => row.id === picked);
  return <CatalogShell title="型号设计" status={<span className="muted">{types.data?.length ?? 0} 项</span>}
    property={current ? <DesignCard document={current.document} raw={current.raw} onClose={() => setPicked('')} /> : undefined}
    actions={<Button variant="primary" onClick={() => { create.reset(); setOpen(true); }}>新建型号</Button>}>
    <div className="type-list-toolbar" role="group" aria-label="型号目录筛选"><label htmlFor="type-search">查找型号</label><input id="type-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="型号名称" type="search" />
      <ToggleGroup type="single" value={statusFilter} onValueChange={value => { if (value) setStatusFilter(value); }} aria-label="发布状态"><ToggleGroupItem value="all">全部</ToggleGroupItem>{Object.entries(publicationLabels).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}</ToggleGroup>
      <Select label="分组" value={groupBy} onChange={setGroupBy} options={[{ value: 'status', label: '按状态' }, { value: 'none', label: '不分组' }]} />
    </div>
    <div className="type-page" data-type-page="list" data-type-state={types.isPending ? 'loading' : types.error ? 'error' : !types.data?.length ? 'empty' : 'success'}>
      {types.isPending ? <LoadingState title="正在读取型号" /> : types.error ? <ErrorState title="型号列表读取失败" description={message(types.error)} action={<Button onClick={() => void types.refetch()}>重新读取</Button>} /> : !types.data?.length ? <InlineEmpty title="尚无型号设计" action={<Button onClick={() => { create.reset(); setOpen(true); }}>新建型号</Button>} /> : !rows.length ? <InlineEmpty title="没有匹配的型号设计" action={<Button onClick={() => { setFilter(''); setStatusFilter('all'); }}>清除筛选</Button>} />
        : <DataTable label="型号" columns={[
          { id: 'name', label: '型号', wrap: true, render: row => <button className="object-link" type="button" onClick={event => { event.stopPropagation(); navigate(typePath(row.id, 'structure', 'section', location.theme)); }}>{cleanLabel(row.name)}</button> },
          { id: 'voltage', label: '电压', render: row => row.card.voltage },
          { id: 'area', label: '截面', render: row => row.card.area },
          { id: 'standard', label: '执行标准', wrap: true, render: row => <span title={row.standardsReason}>{row.standards.length ? row.standards.join('、') : '未声明'}</span> },
          { id: 'version', label: '基准版本', render: row => versionLabel(row.version) },
          { id: 'status', label: '状态', render: row => <StatusMark kind={row.status === 'published' ? 'locked' : row.status === 'review' ? 'proposal' : 'draft'} label={publicationLabels[row.status]} /> },
        ]} selectedId={picked} onSelect={row => setPicked(row.id)} showGroups={groupBy === 'status'} groups={groupBy === 'status' ? Object.entries(publicationLabels).map(([status, label]) => ({ id: status, label, rows: rows.filter(row => row.status === status) })).filter(group => group.rows.length) : [{ id: 'all', label: '型号设计', rows }]} rowLabel={row => row.name} />}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!create.isPending) setOpen(value); }} title="新建型号草稿" description="选择基准型号版本。保存草稿后再审核发布。" initialFocus="form"
      actions={<Button variant="primary" disabled={!selected || !models.data?.some(model => model.id === selected) || !!models.error} loading={create.isPending} onClick={() => create.mutate()}>建立型号草稿</Button>}>
      {models.isPending ? <LoadingState title="正在读取基准型号" /> : models.error ? <ErrorState title="基准型号读取失败" description={message(models.error)} action={<Button onClick={() => void models.refetch()}>重新读取</Button>} /> : !models.data?.length ? <InlineEmpty title="没有可用基准型号" action={<Button onClick={() => navigate('/resources/cables?theme=' + location.theme)}>查看型号版本</Button>} />
        : <div className="type-create-fields"><Select label="基准型号版本" value={selected} onChange={value => { setSelected(value); create.reset(); }} disabled={create.isPending} options={models.data.map(model => ({ value: model.id, label: `${cleanLabel(model.name)} · ${versionLabel(model.version)} · ${model.workspace ? '已发布' : '系统型号'}` }))} />
          {selected && !models.data.find(model => model.id === selected)?.workspace && <p className="muted">系统型号为演示输入，设计前需核对材料与参数来源。</p>}</div>}
      {create.error && <p className="field-error" role="alert">{message(create.error)}</p>}
    </Dialog>
  </CatalogShell>;
}
