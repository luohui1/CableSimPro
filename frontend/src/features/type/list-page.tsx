import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message } from '@/api/client';
import { CatalogShell } from '@/components/catalog-shell';
import { DataTable } from '@/components/data-table';
import { InlineEmpty, ErrorState, LoadingState } from '@/components/states';
import { StatusMark } from '@/components/status-mark';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { listTypes } from './api';
import { CreateTypeDialog } from './create-dialog';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import { cleanLabel } from './labels';
import { DesignCard } from './design-card';
import { designSummary, publicationLabels, versionLabel } from './design-summary';

export function TypeListPage() {
  const { location, navigate } = useTypeNavigation();
  const types = useQuery({ queryKey: ['type-list'], queryFn: ({ signal }) => listTypes(signal) });
  const [filter, setFilter] = useState(''), [open, setOpen] = useState(!!location.create);
  useEffect(() => { if (location.create) setOpen(true); }, [location.create]);
  const [picked, setPicked] = useState(''), [statusFilter, setStatusFilter] = useState('all'), [groupBy, setGroupBy] = useState('status');
  const rows = (types.data || []).filter(row => row.name.toLowerCase().includes(filter.trim().toLowerCase()) && (statusFilter === 'all' || row.status === statusFilter)).map(row => ({ ...row, card: designSummary(row.document, row.raw) }));
  const current = types.data?.find(row => row.id === picked);
  return <CatalogShell title="型号设计" status={<span className="muted">{types.data?.length ?? 0} 项</span>}
    property={current ? <DesignCard document={current.document} raw={current.raw} onClose={() => setPicked('')} /> : undefined}
    actions={<Button variant="primary" onClick={() => setOpen(true)}>新建型号</Button>}>
    <div className="type-list-toolbar" role="group" aria-label="型号目录筛选"><label htmlFor="type-search">查找型号</label><input id="type-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="型号名称" type="search" />
      <ToggleGroup type="single" value={statusFilter} onValueChange={value => { if (value) setStatusFilter(value); }} aria-label="发布状态"><ToggleGroupItem value="all">全部</ToggleGroupItem>{Object.entries(publicationLabels).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}</ToggleGroup>
      <Select label="分组" value={groupBy} onChange={setGroupBy} options={[{ value: 'status', label: '按状态' }, { value: 'none', label: '不分组' }]} />
    </div>
    <div className="type-page" data-type-page="list" data-type-state={types.isPending ? 'loading' : types.error ? 'error' : !types.data?.length ? 'empty' : 'success'}>
      {types.isPending ? <LoadingState title="正在读取型号" /> : types.error ? <ErrorState title="型号列表读取失败" description={message(types.error)} action={<Button onClick={() => void types.refetch()}>重新读取</Button>} /> : !types.data?.length ? <InlineEmpty title="尚无型号设计" action={<Button onClick={() => setOpen(true)}>新建型号</Button>} /> : !rows.length ? <InlineEmpty title="没有匹配的型号设计" action={<Button onClick={() => { setFilter(''); setStatusFilter('all'); }}>清除筛选</Button>} />
        : <DataTable label="型号" columns={[
          { id: 'name', label: '型号', wrap: true, render: row => <button className="object-link" type="button" onClick={event => { event.stopPropagation(); navigate(typePath(row.id, 'structure', 'section', location.theme)); }}>{cleanLabel(row.name)}</button> },
          { id: 'voltage', label: '电压', render: row => row.card.voltage },
          { id: 'area', label: '截面', render: row => row.card.area },
          { id: 'standard', label: '执行标准', wrap: true, render: row => <span title={row.standardsReason}>{row.standards.length ? row.standards.join('、') : '未声明'}</span> },
          { id: 'version', label: '基准版本', render: row => versionLabel(row.version) },
          { id: 'status', label: '状态', render: row => <StatusMark kind={row.status === 'published' ? 'locked' : row.status === 'review' ? 'proposal' : 'draft'} label={publicationLabels[row.status]} /> },
        ]} selectedId={picked} onSelect={row => setPicked(row.id)} showGroups={groupBy === 'status'} groups={groupBy === 'status' ? Object.entries(publicationLabels).map(([status, label]) => ({ id: status, label, rows: rows.filter(row => row.status === status) })).filter(group => group.rows.length) : [{ id: 'all', label: '型号设计', rows }]} rowLabel={row => row.name} />}
    </div>
    {open && <CreateTypeDialog open onClose={() => { setOpen(false); if (location.create) navigate('/types?theme=' + location.theme); }} />}
  </CatalogShell>;
}
