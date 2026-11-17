import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message } from '@/api/client';
import { CatalogShell } from '@/components/catalog-shell';
import { DataTable } from '@/components/data-table';
import { InlineEmpty, ErrorState, LoadingState } from '@/components/states';
import { StatusMark } from '@/components/status-mark';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { listTypes } from './api';
import { CreateTypeDialog } from './create-dialog';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import './batch.css';
import { cleanLabel } from './labels';
import { DesignCard } from './design-card';
import { designSummary, publicationLabels, versionLabel } from './design-summary';
import { TypeBatchActions, typePlanName, typeRowLabel } from './batch-actions';

export function TypeListPage() {
  const { location, navigate } = useTypeNavigation();
  const types = useQuery({ queryKey: ['type-list'], queryFn: ({ signal }) => listTypes(signal) });
  const [filter, setFilter] = useState(''), [open, setOpen] = useState(!!location.create);
  useEffect(() => { if (location.create) setOpen(true); }, [location.create]);
  const [picked, setPicked] = useState(''), [statusFilter, setStatusFilter] = useState('all'), [groupBy, setGroupBy] = useState('status');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const rows = (types.data || []).filter(row => (row.name + ' ' + typePlanName(row)).toLowerCase().includes(filter.trim().toLowerCase()) && (statusFilter === 'all' || row.status === statusFilter)).map(row => ({ ...row, card: designSummary(row.document, row.raw) }));
  const selectedRows = (types.data || []).filter(row => selected.has(row.id));
  const selectedVisible = rows.filter(row => selected.has(row.id)).length;
  function select(id: string, checked: boolean) { setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; }); }
  const current = types.data?.find(row => row.id === picked);
  return <CatalogShell title="型号设计" status={<span className="muted">{types.isPending ? '正在读取型号' : types.isError ? '读取失败' : `${types.data.length} 项`}</span>}
    property={current ? <DesignCard document={current.document} raw={current.raw} onClose={() => setPicked('')} /> : undefined}
    actions={<Button variant={selectedRows.length || open ? 'outline' : 'primary'} onClick={() => setOpen(true)}>新建型号</Button>}>
    <div className="type-list-toolbar" role="group" aria-label="型号目录筛选"><label htmlFor="type-search">查找型号</label><Input id="type-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="型号或方案名称" type="search" />
      <ToggleGroup type="single" value={statusFilter} onValueChange={value => { if (value) setStatusFilter(value); }} aria-label="发布状态"><ToggleGroupItem value="all">全部</ToggleGroupItem>{Object.entries(publicationLabels).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}</ToggleGroup>
      <Select label="分组" value={groupBy} onChange={setGroupBy} options={[{ value: 'status', label: '按状态' }, { value: 'none', label: '不分组' }]} />
      {!!rows.length && <label className="type-list-selection"><Checkbox checked={selectedVisible === rows.length ? true : selectedVisible ? 'indeterminate' : false} onCheckedChange={value => setSelected(previous => { const next = new Set(previous); for (const row of rows) { if (value === true) next.add(row.id); else next.delete(row.id); } return next; })} />选择筛选结果（{rows.length} 项）</label>}
    </div>
    {!types.isPending && !types.error && !!types.data?.length && <TypeBatchActions selected={selectedRows} hiddenCount={selectedRows.length - selectedVisible} inactive={open} onClear={() => setSelected(new Set())} />}
    <div className="type-page" data-type-page="list" data-type-state={types.isPending ? 'loading' : types.error ? 'error' : !types.data?.length ? 'empty' : 'success'}>
      {types.isPending ? <LoadingState title="正在读取型号" /> : types.error ? <ErrorState title="型号列表读取失败" description={message(types.error)} action={<Button onClick={() => void types.refetch()}>重新读取</Button>} /> : !types.data?.length ? <InlineEmpty title="尚无型号设计" action={<Button onClick={() => setOpen(true)}>新建型号</Button>} /> : !rows.length ? <InlineEmpty title="没有匹配的型号设计" action={<Button onClick={() => { setFilter(''); setStatusFilter('all'); }}>清除筛选</Button>} />
        : <DataTable label="型号" columns={[
          { id: 'select', label: '选择', render: row => <span data-type-select onClick={event => event.stopPropagation()}><Checkbox aria-label={'选择 ' + typeRowLabel(row)} checked={selected.has(row.id)} onCheckedChange={value => select(row.id, value === true)} /></span> },
          { id: 'name', label: '型号与方案', wrap: true, render: row => <><button className="object-link" type="button" title={cleanLabel(row.name)} onClick={event => { event.stopPropagation(); navigate(typePath(row.id, 'structure', 'section', location.theme)); }}>{cleanLabel(row.name)}</button>{typePlanName(row) && <span className="type-list-plan">方案：{typePlanName(row)}</span>}</> },
          { id: 'voltage', label: '电压', render: row => row.card.voltage },
          { id: 'area', label: '截面', render: row => row.card.area },
          { id: 'standard', label: '执行标准', wrap: true, render: row => <><Tooltip content={row.standardsReason}><span tabIndex={0} data-type-execution-standards={row.id} data-declaration-state={row.declarationState} data-approval-state={row.approvalState} title={row.standardsReason}>{row.standardsLabel}</span></Tooltip>{row.approvalState === 'error' && <Button variant="ghost" size="compact" loading={types.isFetching} onClick={event => { event.stopPropagation(); void types.refetch(); }}>重新读取标准</Button>}</> },
          { id: 'version', label: '基准版本', render: row => versionLabel(row.version) },
          { id: 'status', label: '状态', render: row => <StatusMark kind={row.status === 'published' ? 'locked' : row.status === 'review' ? 'proposal' : 'draft'} label={publicationLabels[row.status]} /> },
        ]} selectedId={picked} onSelect={row => setPicked(row.id)} showGroups={groupBy === 'status'} groups={groupBy === 'status' ? Object.entries(publicationLabels).map(([status, label]) => ({ id: status, label, rows: rows.filter(row => row.status === status) })).filter(group => group.rows.length) : [{ id: 'all', label: '型号设计', rows }]} rowLabel={typeRowLabel} />}
    </div>
    {open && <CreateTypeDialog open onClose={() => { setOpen(false); if (location.create) navigate('/types?theme=' + location.theme); }} />}
  </CatalogShell>;
}
