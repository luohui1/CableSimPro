import { useCallback, useEffect, useState } from 'react';
import { selectionRoute } from '@/router';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StatusMark } from '@/components/status-mark';
import { SourceBadge } from '@/components/source-badge';
import { Conclusion } from '@/components/conclusion';
import { DataTable, type Column } from '@/components/data-table';
import { PropertyPanel, type PropertyGroup } from '@/components/property-panel';
import { CheckArea } from '@/components/check-area';
import { EmptyState, LoadingState, ErrorState, StaleBanner } from '@/components/states';
import { Toolbar } from '@/components/toolbar';
import { Select } from '@/components/ui/select';
import { NumberField } from '@/components/ui/number-field';
import { Icon } from '@/components/icon';
import { formatNumber } from '@/lib/format';
import { useShortcuts } from '@/lib/use-shortcuts';
import { candidates, sample, verdictLabels, type Candidate } from '@/previews/selection-fixture';

const columns: Column<Candidate>[] = [
  { id: 'model', label: '候选型号', render: row => `${sample.family} 3×${row.section}` },
  { id: 'section', label: '截面', unit: 'mm²', numeric: true, render: row => formatNumber(row.section) },
  { id: 'current', label: '允许电流', unit: 'A', numeric: true, render: row => formatNumber(row.current) },
  { id: 'margin', label: '余量', unit: '%', numeric: true, render: row => row.margin?.replace('%', '') || '—' },
  { id: 'verdict', label: '判定', render: row => <StatusMark kind={row.verdict} /> },
  { id: 'reason', label: '限制原因', render: row => row.verdict === 'satisfied' ? '—' : row.reason },
  { id: 'source', label: '来源', render: () => <SourceBadge kind="calculation" detail="布局示例中的结果类别；未调用计算插件。" /> },
];
const groups = (Object.keys(verdictLabels) as Candidate['verdict'][]).map(verdict => ({ id: verdict, label: verdictLabels[verdict], rows: candidates.filter(row => row.verdict === verdict) }));

export function SelectionPage() {
  const { theme, state, tab } = selectionRoute.useSearch();
  const navigate = selectionRoute.useNavigate();
  const [selected, setSelected] = useState<Candidate | undefined>(candidates[0]);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState('');
  const [development, setDevelopment] = useState(false);
  const unavailable = useCallback((title: string) => setDialog(title), []);
  useShortcuts(unavailable);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const hasResults = state === 'success' || state === 'historical';
  const historical = state === 'historical';
  const propertyGroups: PropertyGroup[] = selected && hasResults ? [
    { label: '选型结果', items: [{ label: '截面', value: formatNumber(selected.section), unit: 'mm²', source: 'document', sourceDetail: '来源类别示意，未绑定厂家记录。' }, { label: '允许电流', value: formatNumber(selected.current), unit: selected.current === null ? undefined : 'A', source: 'calculation' }, { label: '余量', value: selected.margin?.replace('%', '') || '—', unit: selected.margin === null ? undefined : '%', source: 'calculation' }] },
    { label: '判定', items: [{ label: '适用状态', value: <StatusMark kind={selected.verdict} /> }] },
    { label: '来源', items: [{ label: '目标电流', value: formatNumber(sample.target), unit: 'A', source: 'user' }, { label: '计算方法', value: '未调用插件' }] },
  ] : [];
  const summary = hasResults ? <>候选 5 项 · 不适用 1 项{historical && ' · 历史结果'}</> : state === 'error' ? '结果读取失败 · 输入保留' : state === 'loading' ? '正在读取 · 输入保留' : '尚无结果';
  return <Tabs value={tab} onValueChange={value => navigate({ search: previous => ({ ...previous, tab: value as 'results' | 'settings' }) })}>
    <AppShell title={sample.title} status={<StatusMark kind={historical ? 'historical' : state === 'loading' ? 'running' : state === 'error' ? 'error' : 'current'} label={historical ? '历史样稿' : state === 'error' ? '读取失败' : state === 'loading' ? '读取中' : '演示数据'} detail={sample.provenance} />}
      actions={<><Button size="compact" onClick={() => setDialog('运行记录')}><Icon name="action/history" />运行记录</Button><Button variant={hasResults ? 'primary' : 'run'} size="compact" loading={state === 'loading'} onClick={() => setDialog(hasResults ? '计算书预览' : '选型运行尚未接入')}>{hasResults ? '预览计算书' : '运行选型'}</Button></>}
      tabs={<TabsList aria-label="问询选型页签"><TabsTrigger value="results">候选结果</TabsTrigger><TabsTrigger value="settings">问询条件</TabsTrigger></TabsList>}
      property={<PropertyPanel title={selected && hasResults ? `${sample.family} 3×${selected.section}` : '候选属性'} groups={propertyGroups} collapsed={collapsed} empty={!selected || !hasResults} onToggle={() => setCollapsed(!collapsed)} />}
      checks={<CheckArea summary={summary}><div className="check-list"><span>推荐值由用户指定，其余候选仅用于布局。</span><span>未调用插件，未执行标准判定。</span>{selected && hasResults && <span>{selected.reason}</span>}</div></CheckArea>}
      propertyCollapsed={collapsed} onUnavailable={name => setDialog(`${name}尚未迁移`)} theme={theme} onTheme={() => navigate({ search: previous => ({ ...previous, theme: theme === 'light' ? 'dark' : 'light' }), replace: true })}>
      <TabsContent value="results">
        {state === 'empty' ? <EmptyState action={<Button onClick={() => setDialog('候选设置')}>设置候选</Button>} /> : state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState description="网络连接不可用，已保存输入保留。" action={<Button onClick={() => setDialog('重试尚未接入')}>重试读取</Button>} /> : <>
          {historical && <StaleBanner description="输入已变化，以下结果仅供追溯。" />}
          <Conclusion title={historical ? '历史推荐型号' : '推荐型号'} model={sample.recommendation} description="满足每回 400 A 的最小示例截面" metrics={[{ label: '允许电流', value: sample.current, unit: 'A' }, { label: '目标电流', value: sample.target, unit: 'A' }, { label: '余量', value: 13, unit: '%', precision: 1 }]} historical={historical} />
          <Toolbar><h2>候选结果</h2><span className="muted">5 项</span><div className="spacer" /><Select label="显示" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部候选' }, ...Object.entries(verdictLabels).map(([value, label]) => ({ value, label }))]} /></Toolbar>
          <div className={historical ? 'historical-results' : ''}><DataTable label="选型候选" columns={columns} groups={groups.filter(group => filter === 'all' || filter === group.id)} selectedId={selected?.id} onSelect={row => { setSelected(row); setCollapsed(false); }} rowLabel={row => `选择 ${sample.family} 3×${row.section}`} /></div>
        </>}
      </TabsContent><TabsContent value="settings"><div className="conditions"><h2>问询条件</h2><NumberField label="目标电流" value={sample.target} unit="A" source="user" locked /><NumberField label="回路数量" value={3} unit="回" source="user" locked /><Select label="候选范围" value="family" onChange={() => {}} options={[{ value: 'family', label: sample.family }]} disabled /></div></TabsContent>
    </AppShell>
    {import.meta.env.DEV && <div className="dev-layer"><Button size="compact" variant="ghost" onClick={() => setDevelopment(!development)}>开发状态</Button>{development && <Select label="页面状态" value={state} onChange={value => navigate({ search: previous => ({ ...previous, state: value as typeof state }) })} options={['empty', 'loading', 'error', 'success', 'historical'].map(value => ({ value, label: value }))} />}</div>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) setDialog(''); }} title={dialog} description={dialog === '计算书预览' ? '静态预览，仅显示本次界面样例。' : '组件与静态页面阶段，该能力尚未接入。'} actions={dialog === '计算书预览' ? <Button variant="run" onClick={() => setDialog('生成客户计算书尚未接入')}>生成客户计算书</Button> : undefined}>
      {dialog === '计算书预览' && <div className="report-preview"><h2>{sample.title}</h2><p>{historical ? '历史样稿：' : '样稿：'}{sample.recommendation}</p><p>允许 452 A · 目标 400 A · 余量 13.0%</p></div>}
    </Dialog>
  </Tabs>;
}
