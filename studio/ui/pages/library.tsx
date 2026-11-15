import { useState } from 'react';
import { Alert, Badge, NavLink, Stepper, ThemeIcon } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { REVIEW_NAMES, STATE_NAMES, compact } from '@shared/format';
import type { ReviewState, SeriesSummary } from '@shared/types';
import { Button, ProductIcon as Icon, SearchField, SelectField, TabPanel, Tabs } from '@/components/product-controls';
import { LibraryHeader } from '@/components/library-header';
import { useProductLibrary } from '@/state/queries';
import { OriginBadge, ReviewBadge } from '@/components/product-status';

const STATES: ReviewState[] = ['draft', 'submitted', 'reviewed', 'published'];
const ORIGINS = [{ value: 'all', label: '全部资料', icon: 'nav/library' }, { value: 'factory', label: '本厂结构表', icon: 'object/folder' },
  { value: 'public', label: '公开厂家资料', icon: 'object/file' }, { value: 'bundled', label: '结构演示', icon: 'module/structure' }];

export function ProductLibrary() {
  const library = useProductLibrary();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [review, setReview] = useState<ReviewState | 'all'>('all');
  const [origin, setOrigin] = useState('all');
  const [guide, setGuide] = useState(() => localStorage.getItem('studio.library-guide') !== 'hidden');
  const showGuide = (show: boolean) => { setGuide(show); localStorage.setItem('studio.library-guide', show ? 'visible' : 'hidden'); };
  const all = library.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const searched = all.filter(item => (origin === 'all' || (origin === 'bundled' ? !['factory', 'public'].includes(item.origin) : item.origin === origin)) && [item.name, item.manufacturer, item.designation, item.description, ...item.standards]
    .join(' ').toLocaleLowerCase().includes(needle));
  const count = (state: ReviewState) => searched.reduce((sum, item) => sum + (item.states[state] ?? 0), 0);
  const visible = searched.filter(item => review === 'all' || (item.states[review] ?? 0) > 0);
  const total = (items: SeriesSummary[]) => items.reduce((sum, item) => sum + item.specs, 0);
  const reset = () => { setSearch(''); setReview('all'); setOrigin('all'); };

  return <div className="product-ui flex h-full min-w-0 flex-col">
    <LibraryHeader />

    <div className="flex min-h-0 flex-1">
      <aside aria-label="产品库资料分类" className="library-sidebar">
        <div className="library-side-heading"><span>产品资料</span><span className="text-13 font-normal text-ink-2">{all.length} 系列</span></div>
        {ORIGINS.map(item => <NavLink key={item.value} component="button" active={origin === item.value} aria-pressed={origin === item.value} onClick={() => setOrigin(item.value)} label={item.label} leftSection={<Icon name={item.icon} />} rightSection={<Badge variant="light" color={origin === item.value ? 'blue' : 'gray'} size="sm">{all.filter(series => item.value === 'all' || (item.value === 'bundled' ? !['factory', 'public'].includes(series.origin) : series.origin === item.value)).length}</Badge>} />)}
        <button type="button" className="library-side-link mt-auto border-t border-line" onClick={() => showGuide(true)}><Icon name="document" />查看使用流程</button>
      </aside>
      <main className="library-surface">
        <div className="library-page-head">
          <div><h1>产品库</h1><p>{all.length} 个系列 · {total(all)} 个规格 · 按系列维护结构、结果与版本</p></div>
          <div className="flex gap-2">{!guide && <Button variant="ghost" onClick={() => showGuide(true)}>使用流程</Button>}<Button variant="primary" icon="action/import" onClick={() => void navigate({ to: '/library/import' })}>导入结构表</Button></div>
        </div>
        {guide && <section className="library-guide" aria-label="产品库使用指引">
          <Alert color="blue" variant="light" title="先导入结构表，再完成计算与技术文件" icon={<Icon name="object/file" />} withCloseButton closeButtonLabel="收起使用指引" onClose={() => showGuide(false)}>首次使用可选择公开样例。原始资料、计算结果和人工审核分别保留，文件可追溯到具体版本。</Alert>
          <Stepper active={0} size="xs" className="library-guide-stepper">{[
            { icon: 'object/file', title: '导入表格', detail: '对应列名，确认缺项', to: '/library/import' },
            { icon: 'object/section', title: '确认电缆结构', detail: '点断面查看各层尺寸' },
            { icon: 'run/run', title: '计算与核对', detail: '批量算参数，定位异常' },
            { icon: 'document', title: '审核并交付', detail: '保留状态，预览 PDF' },
          ].map(step => <Stepper.Step key={step.title} label={step.title} description={step.detail} icon={<Icon name={step.icon} />} allowStepSelect={false} />)}</Stepper>
        </section>}
        <div className="library-toolbar">
          <SearchField label="搜索产品系列" placeholder="搜索型号、制造商或执行标准" value={search} onChange={setSearch} className="w-full sm:w-96" />
          <SelectField aria-label="按资料来源筛选" className="xl:hidden" value={origin} onValueChange={value => setOrigin(value)}>{ORIGINS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
          <span className="text-13 text-ink-2 sm:ml-auto">{visible.length} 个系列</span>
        </div>

        {library.error ? <div role="alert" className="grid justify-items-start gap-3 py-6">
          <h2 className="m-0 text-16 font-strong">产品库读取失败</h2>
          <p className="m-0 text-14 text-error">{library.error.message}</p>
          <Button icon="action/refresh" onClick={() => void library.refetch()}>重新读取</Button>
        </div> : library.isPending ? <div role="status" className="grid gap-4 py-4">
          <span className="text-14">正在读取产品库…</span>
          {[0, 1, 2].map(row => <div key={row} aria-hidden="true" className="h-16 rounded-field bg-fill" />)}
        </div> : <>
          <Tabs value={review} onChange={value => setReview(value as ReviewState | 'all')} label="按最新版本审核状态筛选" className="library-status-tabs min-h-0 flex-1 flex-col" items={[
            { value: 'all', label: <>全部规格<span className="library-tab-count">{total(searched)}</span></> },
            ...STATES.map(state => ({ value: state, label: <>{REVIEW_NAMES[state]}<span className="library-tab-count">{count(state)}</span></> }))]}>
          <TabPanel value={review}><div className="library-table-scroll min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? <div className="grid justify-items-start gap-3 p-6">
            <h2 className="m-0 text-16 font-strong">{all.length ? '没有匹配的系列' : '产品库里还没有系列'}</h2>
            {all.length > 0 && <Button onClick={reset}>清除筛选</Button>}
          </div> : <table className="library-table">
              <caption className="sr-only">产品系列及各规格最新版本的审核状态</caption>
              <thead>
                <tr>
                  <th scope="col">产品系列</th><th scope="col">电压 / 芯数</th><th scope="col">数据来源</th><th scope="col" className="text-right">规格</th><th scope="col">最新版本状态</th><th scope="col"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => <tr key={item.id}>
                    <th scope="row"><div className="library-series-name"><ThemeIcon variant="light" size={40} radius="md"><Icon name="nav/cable-type" /></ThemeIcon><div className="min-w-0"><Link to="/library/$seriesId" params={{ seriesId: item.id }} search={{}}>{item.name}</Link><small>{item.standards.join(' · ') || item.description}</small></div></div></th>
                    <td className="whitespace-nowrap">
                      {compact(item.u0_v / 1000)} / {compact(item.u_v === null ? null : item.u_v / 1000)} kV
                      <span className="ml-3 text-13 text-ink-2">{item.cores} 芯</span>
                    </td>
                    <td><OriginBadge origin={item.origin} /></td>
                    <td className="library-desktop-column text-right">{item.specs}</td>
                    <td className="library-review-summary"><div className="flex flex-wrap gap-2">{STATES.filter(state => item.states[state]).map(state => <ReviewBadge key={state} state={state} count={item.states[state]} />)}</div></td>
                    <td className="library-desktop-column text-right">
                      <Button size="compact" variant="ghost" aria-label={`打开系列：${item.name}`} icon="action/arrow-right"
                        onClick={() => void navigate({ to: '/library/$seriesId', params: { seriesId: item.id }, search: {} })}>打开系列</Button>
                    </td>
                  </tr>)}
              </tbody>
            </table>}
          </div></TabPanel></Tabs><div className="library-footnote"><span>共 {visible.length} 个系列，{total(visible)} 个规格</span><span>审核状态按最新版本统计；数据来源单独保留。</span></div>
        </>}
      </main>
    </div>
  </div>;
}
