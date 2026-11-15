import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { REVIEW_NAMES, STATE_NAMES, compact } from '@shared/format';
import type { ReviewState, SeriesSummary } from '@shared/types';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { LibraryHeader } from '@/components/library-header';
import { SearchField } from '@/components/search-field';
import { useProductLibrary } from '@/state/queries';

const STATES: ReviewState[] = ['draft', 'submitted', 'reviewed', 'published'];
const ORIGINS = [{ value: 'all', label: '全部资料', icon: 'nav/library' }, { value: 'factory', label: '本厂结构表', icon: 'object/folder' },
  { value: 'public', label: '公开厂家资料', icon: 'object/file' }, { value: 'bundled', label: '结构演示', icon: 'module/structure' }];

export function ProductLibrary() {
  const library = useProductLibrary();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [review, setReview] = useState<ReviewState | 'all'>('all');
  const [origin, setOrigin] = useState('all');
  const all = library.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const searched = all.filter(item => (origin === 'all' || (origin === 'bundled' ? !['factory', 'public'].includes(item.origin) : item.origin === origin)) && [item.name, item.manufacturer, item.designation, item.description, ...item.standards]
    .join(' ').toLocaleLowerCase().includes(needle));
  const count = (state: ReviewState) => searched.reduce((sum, item) => sum + (item.states[state] ?? 0), 0);
  const visible = searched.filter(item => review === 'all' || (item.states[review] ?? 0) > 0);
  const total = (items: SeriesSummary[]) => items.reduce((sum, item) => sum + item.specs, 0);
  const reset = () => { setSearch(''); setReview('all'); setOrigin('all'); };

  return <div className="flex h-full min-w-0 flex-col">
    <LibraryHeader />

    <div className="flex min-h-0 flex-1">
      <aside aria-label="产品库资料分类" className="library-sidebar">
        <div className="library-side-heading"><span>产品资料</span><span className="text-13 font-normal text-ink-2">{all.length} 系列</span></div>
        {ORIGINS.map(item => <button key={item.value} type="button" className="library-side-link" aria-pressed={origin === item.value} onClick={() => setOrigin(item.value)}>
          <Icon name={item.icon} /><span className="flex-1">{item.label}</span><span className="text-ink-2">{all.filter(series => item.value === 'all' || (item.value === 'bundled' ? !['factory', 'public'].includes(series.origin) : series.origin === item.value)).length}</span>
        </button>)}
        <div className="mt-auto border-t border-line px-3 pt-5 text-13 text-ink-2"><p className="m-0 font-strong text-ink">从结构表开始</p><p className="mb-0 mt-2">导入后按规格计算、核对与审核，再生成带来源的规格书。</p></div>
      </aside>
      <main className="library-surface">
        <div className="library-page-head">
          <div><h1>产品库</h1><p>{all.length} 个系列 · {total(all)} 个规格 · 按系列维护结构、结果与版本</p></div>
          <Button variant="primary" icon="action/import" onClick={() => void navigate({ to: '/library/import' })}>导入结构表</Button>
        </div>
        <div className="library-toolbar">
          <SearchField label="搜索产品系列" placeholder="搜索型号、制造商或执行标准" value={search} onChange={setSearch} className="w-full sm:w-96" />
          <select aria-label="按资料来源筛选" className="studio-input xl:hidden" value={origin} onChange={event => setOrigin(event.target.value)}>{ORIGINS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
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
          <div aria-label="按最新版本审核状态筛选" className="library-view-tabs">
            {[{ value: 'all' as const, label: '全部规格', count: total(searched) },
              ...STATES.map(state => ({ value: state, label: REVIEW_NAMES[state], count: count(state) }))].map(item => <button key={item.value} type="button"
              aria-pressed={review === item.value} onClick={() => setReview(item.value)}
              >
              {item.label}<span className="library-tab-count">{item.count}</span>
            </button>)}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
                    <th scope="row"><div className="library-series-name"><Icon name="nav/cable-type" /><div className="min-w-0"><Link to="/library/$seriesId" params={{ seriesId: item.id }} search={{}}>{item.name}</Link><small>{item.standards.join(' · ') || item.description}</small></div></div></th>
                    <td className="whitespace-nowrap">
                      {compact(item.u0_v / 1000)} / {compact(item.u_v === null ? null : item.u_v / 1000)} kV
                      <span className="ml-3 text-13 text-ink-2">{item.cores} 芯</span>
                    </td>
                    <td><span className="library-origin">{STATE_NAMES[item.origin] ?? item.origin}</span></td>
                    <td className="library-desktop-column text-right">{item.specs}</td>
                    <td className="library-review-summary"><div className="flex flex-wrap gap-x-4 gap-y-2">{STATES.filter(state => item.states[state]).map(state => <span key={state} className="library-state" data-state={state}>{REVIEW_NAMES[state]} {item.states[state]}</span>)}</div></td>
                    <td className="library-desktop-column text-right">
                      <Button size="compact" variant="ghost" aria-label={`打开系列：${item.name}`} icon="action/arrow-right"
                        onClick={() => void navigate({ to: '/library/$seriesId', params: { seriesId: item.id }, search: {} })}>打开系列</Button>
                    </td>
                  </tr>)}
              </tbody>
            </table>}
          </div><div className="library-footnote"><span>共 {visible.length} 个系列，{total(visible)} 个规格</span><span>审核状态按最新版本统计；数据来源单独保留。</span></div>
        </>}
      </main>
    </div>
  </div>;
}
