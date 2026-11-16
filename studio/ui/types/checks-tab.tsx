// 标准核对: the saved version against the standards its series declares, one row per requirement. What failed and what could
// not be judged come first and open; what passed and what the library does not cover stay shut until asked for.
import type { SpecView } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Disclosure, DisclosureMore, DisclosurePanel, DisclosureRoot } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { VERDICT, VerdictMark } from '@/kit/marks';
import { ResultGate } from './gate';
import { requirements, requirementText, type Requirement, type Verdict } from './model';

/** A standard without its year: GB/T 12706.2—2020 and GB/T 12706.2-2020 are the same standard. */
const base = (standard: string) => standard.split(/[—–-]\s*\d{4}/)[0].trim();

/** The clause as a tag: the table or clause, with the standard in front when it is not the series' product standard. */
const clauseOf = (item: Requirement, product: string | undefined) => `${product && base(item.standard) === product ? '' : `${base(item.standard)} `}${item.clause.split('，')[0]}`;

function Row({ item, product }: { item: Requirement; product: string | undefined }) {
  const { required, actual } = requirementText(item);
  const where = `${item.standard} ${item.clause}${item.pdf_page ? ` · PDF 第 ${item.pdf_page} 页` : ''}${item.printed_page ? ` / 印刷第 ${item.printed_page} 页` : ''}`;
  // What failed, and what could not be judged, say how: the number found against the number asked for.
  const values = item.verdict === 'failed' ? `实际 ${actual} · 要求 ${required}` : item.verdict === 'missing' ? `要求 ${required}` : '';
  return <li className="flex min-h-9 items-center gap-3 rounded-nav px-2 py-1 hover:bg-subtle" title={[item.reason, where].filter(Boolean).join('\n')}>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-sm text-ink">
        {item.title}
        {item.cores > 1 && <span className="ml-2 whitespace-nowrap text-ink-2">{item.cores === 3 ? '三芯' : `${item.cores} 芯`}</span>}
      </span>
      {values && <span className="text-sm text-ink-2 tabular-nums">{values}</span>}
    </span>
    <Badge variant="outline" className="shrink-0">{clauseOf(item, product)}</Badge>
  </li>;
}

/** The first rows of a section show; the rest are one click away. */
const FIRST = 6;

export function ChecksTab({ view, onCompute, busy }: { view: SpecView; onCompute: () => void; busy: boolean }) {
  const result = view.results.check;
  const items = requirements(result);
  const counts = result?.summary?.count ?? {};
  const standards = result?.standards ?? view.series.standards;
  const product = standards[0] ? base(standards[0]) : undefined;
  const section = (verdict: Verdict, open: boolean) => {
    const list = items.filter(item => item.verdict === verdict);
    if (!list.length) return null;
    const rest = list.slice(FIRST);
    return <Disclosure key={verdict} defaultOpen={open} title={<VerdictMark verdict={verdict} count={counts[verdict] ?? 0} />}
      aside={<span className="text-sm font-normal text-ink-2">{list.length} 条要求</span>}>
      <ul className="m-0 flex list-none flex-col px-2 pb-3">{list.slice(0, FIRST).map(item => <Row key={`${item.role}/${item.title}`} item={item} product={product} />)}</ul>
      {rest.length > 0 && <DisclosureRoot className="px-2 pb-3">
        <DisclosurePanel><ul className="m-0 flex list-none flex-col p-0">{rest.map(item => <Row key={`${item.role}/${item.title}`} item={item} product={product} />)}</ul></DisclosurePanel>
        <DisclosureMore more={rest.length} />
      </DisclosureRoot>}
    </Disclosure>;
  };
  return <ResultGate result={result} name="标准核对" onCompute={onCompute} busy={busy}>
    <dl className="m-0 grid grid-cols-3 gap-4 border-b border-line px-4 py-4">
      {(['passed', 'failed', 'missing'] as Verdict[]).map(verdict => <div key={verdict} className="flex flex-col gap-1">
        <dt className="flex items-center gap-1 text-sm text-ink-2"><Icon name={VERDICT[verdict].icon} className={VERDICT[verdict].tone} />{VERDICT[verdict].label}</dt>
        <dd className="m-0 text-metric-sm text-ink tabular-nums">{counts[verdict] ?? 0}</dd>
      </div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      {standards.length > 0 ? standards.map(standard => <Badge key={standard} variant="outline">{standard}</Badge>) : <Badge variant="attention">没有声明执行标准</Badge>}
    </div>
    {section('failed', true)}
    {section('missing', true)}
    {section('uncovered', false)}
    {section('passed', false)}
  </ResultGate>;
}
