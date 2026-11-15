import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { REVIEW_NAMES, STATE_NAMES, compact } from '@shared/format';
import type { ReviewState, SeriesSummary } from '@shared/types';
import { Button } from '@/components/button';
import { LibraryHeader } from '@/components/library-header';
import { SearchField } from '@/components/search-field';
import { cn } from '@/lib/cn';
import { useProductLibrary } from '@/state/queries';

const STATES: ReviewState[] = ['draft', 'submitted', 'reviewed', 'published'];
const TONES: Record<ReviewState, string> = { draft: 'text-ink', submitted: 'text-attention', reviewed: 'text-success', published: 'text-ink' };

export function ProductLibrary() {
  const library = useProductLibrary();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [review, setReview] = useState<ReviewState | 'all'>('all');
  const all = library.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const searched = all.filter(item => [item.name, item.manufacturer, item.designation, item.description, ...item.standards]
    .join(' ').toLocaleLowerCase().includes(needle));
  const count = (state: ReviewState) => searched.reduce((sum, item) => sum + (item.states[state] ?? 0), 0);
  const visible = searched.filter(item => review === 'all' || (item.states[review] ?? 0) > 0);
  const total = (items: SeriesSummary[]) => items.reduce((sum, item) => sum + item.specs, 0);
  const reset = () => { setSearch(''); setReview('all'); };

  return <div className="flex h-full min-w-0 flex-col">
    <LibraryHeader />

    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="m-0 text-20 font-strong">产品库</h1>
            {library.data && <span className="text-14">{all.length} 个系列 · {total(all)} 个规格</span>}
          </div>
          <SearchField label="搜索产品系列" placeholder="搜索型号、制造商或执行标准" value={search} onChange={setSearch} className="w-full sm:w-96" />
          <Button variant="primary" icon="action/add" onClick={() => void navigate({ to: '/library/import' })}>导入结构表</Button>
        </div>

        {library.error ? <div role="alert" className="grid justify-items-start gap-3 py-6">
          <h2 className="m-0 text-16 font-strong">产品库读取失败</h2>
          <p className="m-0 text-14 text-error">{library.error.message}</p>
          <Button icon="action/refresh" onClick={() => void library.refetch()}>重新读取</Button>
        </div> : library.isPending ? <div role="status" className="grid gap-4 py-4">
          <span className="text-14">正在读取产品库…</span>
          {[0, 1, 2].map(row => <div key={row} aria-hidden="true" className="h-16 rounded-field bg-fill" />)}
        </div> : <>
          <div aria-label="按最新版本审核状态筛选" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line">
            {[{ value: 'all' as const, label: '全部规格', count: total(searched) },
              ...STATES.map(state => ({ value: state, label: REVIEW_NAMES[state], count: count(state) }))].map(item => <button key={item.value} type="button"
              aria-pressed={review === item.value} onClick={() => setReview(item.value)}
              className={cn('flex items-center gap-2 border-b-2 px-1 py-3 text-14 transition-colors duration-fast ease-std hover:text-copper',
                review === item.value ? 'border-copper font-strong text-copper' : 'border-transparent text-ink')}>
              {item.label}<span>{item.count}</span>
            </button>)}
          </div>

          {visible.length === 0 ? <div className="grid justify-items-start gap-3 py-8">
            <h2 className="m-0 text-16 font-strong">{all.length ? '没有匹配的系列' : '产品库里还没有系列'}</h2>
            {all.length > 0 && <Button onClick={reset}>清除筛选</Button>}
          </div> : <div className="overflow-hidden rounded-card border border-line bg-panel">
            <table className="w-full border-collapse text-14">
              <caption className="sr-only">产品系列及各规格最新版本的审核状态</caption>
              <thead className="hidden border-b border-line bg-fill text-left lg:table-header-group">
                <tr>
                  <th scope="col" className="px-4 py-3 font-strong">产品系列</th>
                  <th scope="col" className="px-3 py-3 font-strong whitespace-nowrap">额定电压 / 芯数</th>
                  <th scope="col" className="px-3 py-3 font-strong whitespace-nowrap">数据来源</th>
                  <th scope="col" className="px-3 py-3 text-center font-strong">规格</th>
                  {STATES.map(state => <th key={state} scope="col" className="px-3 py-3 text-center font-strong whitespace-nowrap">{REVIEW_NAMES[state]}</th>)}
                  <th scope="col" className="px-4 py-3"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => <tr key={item.id} className="border-b border-line last:border-b-0 max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto]">
                    <th scope="row" className="px-4 py-4 text-left font-normal max-lg:col-span-2 max-lg:pb-1">
                      <Link to="/library/$seriesId" params={{ seriesId: item.id }} search={{}} className="block font-strong text-ink no-underline hover:text-copper">{item.name}</Link>
                      <span className="mt-1 block text-14">{item.description}</span>
                    </th>
                    <td className="px-3 py-4 whitespace-nowrap max-lg:px-4 max-lg:pt-1">
                      {compact(item.u0_v / 1000)} / {compact(item.u_v === null ? null : item.u_v / 1000)} kV
                      <span className="mt-1 block">{item.cores} 芯</span>
                    </td>
                    <td className="px-3 py-4 max-lg:px-4 max-lg:pt-1 max-lg:text-right">{STATE_NAMES[item.origin] ?? item.origin}</td>
                    <td className="hidden px-3 py-4 text-center font-strong lg:table-cell">{item.specs}</td>
                    {STATES.map(state => <td key={state} className={cn('hidden px-3 py-4 text-center lg:table-cell', (item.states[state] ?? 0) ? TONES[state] : 'text-ink-2')}>
                      {item.states[state] ?? 0}
                    </td>)}
                    <td className="col-span-2 flex flex-wrap gap-x-4 gap-y-2 px-4 pb-4 lg:hidden">
                      <span>{item.specs} 个规格</span>
                      {STATES.filter(state => item.states[state]).map(state => <span key={state} className={TONES[state]}>{REVIEW_NAMES[state]} {item.states[state]}</span>)}
                    </td>
                    <td className="px-4 py-4 text-right max-lg:col-span-2 max-lg:pt-0 max-lg:text-left">
                      <Button size="compact" aria-label={`打开系列：${item.name}`} icon="action/arrow-right"
                        onClick={() => void navigate({ to: '/library/$seriesId', params: { seriesId: item.id }, search: {} })}>打开系列</Button>
                    </td>
                  </tr>)}
              </tbody>
            </table>
          </div>}
        </>}
      </div>
    </main>
  </div>;
}
