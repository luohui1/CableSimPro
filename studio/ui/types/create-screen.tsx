// A new type or a new size, made by a person: typed in from nothing, or started from what the product standard gives and
// completed by the engineer. A size made here is the first draft of a version, recorded as typed by a person, with the basis
// of every number; review stays with a person too. A standard's proposal says where each dimension comes from, and what it
// leaves for the engineer to give.
import { useMutation } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { compact } from '@shared/format';
import type { SeriesCreated, SpecCreated, StructureProposal } from '@shared/model-types';
import type { SeriesDeclaration } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icon, Spinner } from '@/kit/icon';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { PageHeader } from '@/kit/workbench/page';
import { api } from '@/state/api';
import { queryClient, useProductLibrary, useProductSeries, useVocabulary } from '@/state/queries';
import { DeclarationForm, EMPTY_DECLARATION, FieldRow, Labelled, numberOf, Pick, StructureFields } from './forms';
import { TypeFrame } from './frame';

const route = getRouteApi('/library/new');
const NEW_SERIES = '__new__';

/** What `create_series` takes of a declaration: everything the person wrote, nothing filled in for them. */
const seriesParams = (declaration: SeriesDeclaration, precision: string) => ({
  name: declaration.name.trim(), designation: declaration.designation.trim(), cores: declaration.cores, u0_v: declaration.u0_v, u_v: declaration.u_v,
  ...(declaration.manufacturer.trim() ? { manufacturer: declaration.manufacturer.trim() } : {}),
  standards: declaration.standards.map(item => item.trim()).filter(Boolean), origin: declaration.origin ?? 'factory',
  ...(declaration.armour_material ? { armour_material: declaration.armour_material } : {}),
  common: declaration.common, common_basis: declaration.common_basis, modelling: declaration.modelling,
  // The precision the outer diameters are written to: the closure of the outer diameter cannot do without it, so it is asked for.
  ...(!('diameter_rounding' in declaration.modelling) && numberOf(precision) ? { outer_diameter_precision_mm: numberOf(precision) } : {}),
});

/** How finely the outer diameters of a series are written: half the last digit is the tolerance of the closure. */
function Precision({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Labelled label="外径填写精度 / mm（半个末位用作外径闭合的容差）" htmlFor="declare-precision" className="max-w-sm">
    <Input id="declare-precision" aria-label="外径填写精度" required type="number" min="0.0001" step="any" value={value} onChange={event => onChange(event.target.value)} />
  </Labelled>;
}

const numbers = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).flatMap(([key, text]) => numberOf(text) === undefined ? [] : [[key, numberOf(text)!]]));
const texts = (basis: Record<string, string>) => Object.fromEntries(Object.entries(basis).filter(([, text]) => text.trim()).map(([key, text]) => [key, text.trim()]));

/** Makes the series when the person is making one, then the size in it; the page then shows the size. A series made by a
 *  try that failed on the size is kept, so trying again does not make a second one. */
function useCreate() {
  const navigate = useNavigate();
  const [created, setCreated] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: async (input: { series?: string; declaration?: SeriesDeclaration; precision?: string; values: Record<string, number>; basis: Record<string, string>; proposal?: string }) => {
      let series = input.series ?? created;
      if (!series) {
        series = (await api.op<SeriesCreated>('library.series.create', seriesParams(input.declaration!, input.precision ?? ''))).series;
        setCreated(series);
      }
      return await api.op<SpecCreated>('library.spec.create', { series, values: input.values, basis: input.basis, ...(input.proposal ? { proposal: input.proposal } : {}) });
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void navigate({ to: '/library/$seriesId', params: { seriesId: result.view.series.id }, search: { spec: result.spec } });
    },
  });
  return create;
}

function Fail({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="m-0 text-sm text-error">{error.message}</p> : null;
}

// ---- 从零新建 ----

function FromScratch({ fixedSeries }: { fixedSeries: string | undefined }) {
  const vocabulary = useVocabulary();
  const library = useProductLibrary();
  const [target, setTarget] = useState(fixedSeries ?? NEW_SERIES);
  const series = useProductSeries(target === NEW_SERIES ? '' : target);
  const [declaration, setDeclaration] = useState<SeriesDeclaration>(EMPTY_DECLARATION);
  const [values, setValues] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [precision, setPrecision] = useState('0.1');
  const create = useCreate();
  const making = target === NEW_SERIES;
  const missingBasis = making ? Object.keys(declaration.common).filter(key => !declaration.common_basis[key]?.trim()) : [];
  const given = new Set(Object.keys(making ? declaration.common : series.data?.declaration.common ?? {}));
  return <form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); create.mutate({ ...(making ? { declaration, precision } : { series: target }), values: numbers(values), basis: texts(basis) }); }}>
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">系列</h2>
      {fixedSeries ? null : <Labelled label="放进哪个系列"><Pick label="系列" value={target} onValueChange={setTarget}
        options={[{ value: NEW_SERIES, label: '新建一个系列…' }, ...(library.data ?? []).map(item => ({ value: item.id, label: item.name }))]} /></Labelled>}
      {making && <DeclarationForm value={declaration} onChange={setDeclaration} vocabulary={vocabulary.data} />}
      {making && <Precision value={precision} onChange={setPrecision} />}
    </section>
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">{making ? '第一个规格' : `规格（加进 ${series.data?.series.name ?? '这个系列'}）`}</h2>
      <StructureFields vocabulary={vocabulary.data} values={values} basis={basis} onValues={setValues} onBasis={setBasis} taken={given} />
    </section>
    {missingBasis.length > 0 && <p role="status" className="m-0 text-sm text-attention">请补充取值依据：{missingBasis.map(key => vocabulary.data?.fields.find(field => field.key === key)?.label ?? key).join('、')}。</p>}
    <Fail error={create.error} />
    <div className="flex justify-end">
      <Button type="submit" disabled={create.isPending || missingBasis.length > 0}>{create.isPending ? <Spinner /> : <Icon name="action/add" data-icon="inline-start" />}{making ? '创建型号' : '创建规格'}</Button>
    </div>
  </form>;
}

// ---- 按标准给出初始结构 ----

const proposalColumns: Column<StructureProposal['dimensions'][number]>[] = [
  { key: 'label', header: '尺寸', cell: row => row.label },
  { key: 'value', header: '数值', numeric: true, width: 'w-32', cell: row => <>{compact(row.value, 6)}<span className="ml-1 text-ink-2">{row.unit}</span></> },
  { key: 'source', header: '依据', width: 'w-80', cell: row => <span className="block truncate" title={row.source.citation ?? undefined}>{
    row.source.kind === 'given' ? `工程师给定${row.source.note ? `：${row.source.note}` : ''}`
      : `${row.source.kind === 'derived' ? '按附录算出：' : ''}${row.source.standard ?? ''} ${row.source.clause ?? ''}${row.source.pdf_page ? ` · PDF 第 ${row.source.pdf_page} 页` : ''}`}</span> },
];

function FromStandard({ fixedSeries }: { fixedSeries: string | undefined }) {
  const vocabulary = useVocabulary();
  const library = useProductLibrary();
  const [form, setForm] = useState({ standard: 'GB/T 12706.2-2020', u0: '8.7', u: '15', cores: '3', conductor: 'copper', area: '', armour: 'none', scope: 'insulation', screened: 'yes',
    conductorDiameter: '', conductorScreen: '', insulationScreen: '', tapeThickness: '', tapeWidth: '' });
  const set = (values: Partial<typeof form>) => setForm(current => ({ ...current, ...values }));
  const complete = form.scope === 'complete';
  const propose = useMutation({
    mutationFn: () => api.op<StructureProposal>('structure.propose', {
      standard: form.standard.trim(), u0_v: (numberOf(form.u0) ?? 0) * 1000, u_v: (numberOf(form.u) ?? 0) * 1000, cores: Number(form.cores), conductor: form.conductor,
      area_mm2: numberOf(form.area) ?? 0, insulation: 'XLPE', armour: form.armour, scope: form.scope,
      ...(numberOf(form.conductorDiameter) ? { conductor_diameter_mm: numberOf(form.conductorDiameter) } : {}),
      ...(complete ? { screened: form.screened === 'yes',
        ...(numberOf(form.conductorScreen) ? { conductor_screen_thickness_mm: numberOf(form.conductorScreen) } : {}),
        ...(numberOf(form.insulationScreen) ? { insulation_screen_thickness_mm: numberOf(form.insulationScreen) } : {}),
        ...(numberOf(form.tapeThickness) ? { screen_tape_thickness_mm: numberOf(form.tapeThickness) } : {}),
        ...(numberOf(form.tapeWidth) ? { screen_tape_width_mm: numberOf(form.tapeWidth) } : {}) } : {}),
    }),
  });
  const proposal = propose.data;
  return <div className="flex flex-col gap-6">
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); propose.mutate(); }}>
      <h2 className="m-0 text-h2 text-ink">给出规格的条件</h2>
      <div className="grid grid-cols-3 gap-4">
        <Labelled label="执行标准（写到年号）" htmlFor="std-standard" className="col-span-3"><Input id="std-standard" aria-label="执行标准" required maxLength={60} value={form.standard} onChange={event => set({ standard: event.target.value })} /></Labelled>
        <Labelled label="额定相电压 U0 / kV" htmlFor="std-u0"><Input id="std-u0" aria-label="额定相电压 kV" required type="number" min="0.001" step="any" value={form.u0} onChange={event => set({ u0: event.target.value })} /></Labelled>
        <Labelled label="额定线电压 U / kV" htmlFor="std-u"><Input id="std-u" aria-label="额定线电压 kV" required type="number" min="0.001" step="any" value={form.u} onChange={event => set({ u: event.target.value })} /></Labelled>
        <Labelled label="芯数"><Pick label="芯数" value={form.cores} onValueChange={cores => set({ cores })} options={[{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }]} /></Labelled>
        <Labelled label="导体材料"><Pick label="导体材料" value={form.conductor} onValueChange={conductor => set({ conductor })} options={[{ value: 'copper', label: '铜' }, { value: 'aluminium', label: '铝' }]} /></Labelled>
        <Labelled label="导体标称截面 / mm²" htmlFor="std-area"><Input id="std-area" aria-label="标称截面" required type="number" min="0.001" max="2500" step="any" value={form.area} onChange={event => set({ area: event.target.value })} /></Labelled>
        <Labelled label="铠装形式"><Pick label="铠装形式" value={form.armour} onValueChange={armour => set({ armour })} options={[{ value: 'none', label: '无铠装' }, { value: 'steel_tape', label: '双钢带铠装（三芯）' }]} /></Labelled>
        <Labelled label="给出哪些尺寸" className="col-span-2"><Pick label="给出哪些尺寸" value={form.scope} onValueChange={scope => set({ scope })}
          options={[{ value: 'insulation', label: '只给绝缘厚度' }, { value: 'complete', label: '连内衬、铠装、外护套' }]} /></Labelled>
        <Labelled label="导体外径 / mm（可选）" htmlFor="std-dc"><Input id="std-dc" aria-label="导体外径" type="number" min="0.001" step="any" value={form.conductorDiameter} onChange={event => set({ conductorDiameter: event.target.value })} /></Labelled>
        {complete && <>
          <Labelled label="有无半导电屏蔽"><Pick label="有无半导电屏蔽" value={form.screened} onValueChange={screened => set({ screened })} options={[{ value: 'yes', label: '有' }, { value: 'no', label: '无' }]} /></Labelled>
          <Labelled label="导体屏蔽厚度 / mm" htmlFor="std-cs"><Input id="std-cs" aria-label="导体屏蔽厚度" type="number" min="0.001" step="any" value={form.conductorScreen} onChange={event => set({ conductorScreen: event.target.value })} /></Labelled>
          <Labelled label="绝缘屏蔽厚度 / mm" htmlFor="std-is"><Input id="std-is" aria-label="绝缘屏蔽厚度" type="number" min="0.001" step="any" value={form.insulationScreen} onChange={event => set({ insulationScreen: event.target.value })} /></Labelled>
          <Labelled label="铜带厚度 / mm" htmlFor="std-tt"><Input id="std-tt" aria-label="铜带厚度" type="number" min="0.001" step="any" value={form.tapeThickness} onChange={event => set({ tapeThickness: event.target.value })} /></Labelled>
          <Labelled label="铜带宽度 / mm" htmlFor="std-tw"><Input id="std-tw" aria-label="铜带宽度" type="number" min="0.001" step="any" value={form.tapeWidth} onChange={event => set({ tapeWidth: event.target.value })} /></Labelled>
        </>}
      </div>
      <Fail error={propose.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={propose.isPending}>{propose.isPending ? <Spinner /> : <Icon name="module/standard-check" data-icon="inline-start" />}按标准给出初始结构</Button>
      </div>
    </form>
    {proposal && <Proposal key={proposal.id} proposal={proposal} area={numberOf(form.area) ?? 0} fixedSeries={fixedSeries} library={library.data} vocabulary={vocabulary.data} />}
  </div>;
}

function Proposal({ proposal, area, fixedSeries, library, vocabulary }: {
  proposal: StructureProposal; area: number; fixedSeries: string | undefined; library: { id: string; name: string; cores: number }[] | undefined; vocabulary: ReturnType<typeof useVocabulary>['data'];
}) {
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(fixedSeries ?? NEW_SERIES);
  const [precision, setPrecision] = useState('0.1');
  const [declaration, setDeclaration] = useState<SeriesDeclaration>({ ...EMPTY_DECLARATION, standards: [proposal.standard],
    cores: proposal.inputs.cores === 1 ? 1 : 3, u0_v: Number(proposal.inputs.u0_v ?? 0), u_v: Number(proposal.inputs.u_v ?? 0) });
  const create = useCreate();
  const pending = proposal.missing.filter(item => numberOf(filled[item.field] ?? '') === undefined);
  const making = target === NEW_SERIES;
  const submit = () => {
    // The basis of what the standard gave comes from the proposal itself; only what the engineer gave carries a basis of their own.
    const values = { area, ...proposal.values, ...numbers(filled) };
    create.mutate({ ...(making ? { declaration, precision } : { series: target }), values, basis: texts(basis), proposal: proposal.id });
  };
  return <form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); submit(); }}>
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-h2 text-ink">标准给出的初始结构</h2>
        <Badge variant="secondary">{proposal.scope === 'complete' ? '含内衬、铠装、外护套' : '只给绝缘厚度'}</Badge>
        <Badge variant="outline">{proposal.standard}</Badge>
      </div>
      <DataTable columns={proposalColumns} rows={proposal.dimensions} rowKey={row => row.field} />
      {proposal.limitations.length > 0 && <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {proposal.limitations.map(item => <li key={item} className="flex gap-2 text-sm text-ink">
          <span className="flex h-5 shrink-0 items-center"><Icon name="status/info" className="text-ink-2" /></span>{item}
        </li>)}
      </ul>}
    </section>
    {proposal.missing.length > 0 && <section className="flex flex-col gap-3">
      <h2 className="m-0 text-h2 text-ink">还要工程师给出的尺寸</h2>
      {proposal.missing.map(item => <FieldRow key={item.field} label={item.label} unit={item.unit} htmlFor={`missing-${item.field}`}>
        <Input id={`missing-${item.field}`} aria-label={`填写${item.label}`} className="w-32 shrink-0" type="number" min="0.000001" step="any" required title={item.reason}
          value={filled[item.field] ?? ''} onChange={event => setFilled(current => ({ ...current, [item.field]: event.target.value }))} />
        <Input aria-label={`${item.label}依据`} placeholder="取值依据，如图纸号、实测" value={basis[item.field] ?? ''} onChange={event => setBasis(current => ({ ...current, [item.field]: event.target.value }))} />
      </FieldRow>)}
    </section>}
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-h2 text-ink">放进哪个系列</h2>
      {fixedSeries ? null : <Labelled label="系列"><Pick label="系列" value={target} onValueChange={setTarget}
        options={[...(library ?? []).filter(item => item.cores === declaration.cores).map(item => ({ value: item.id, label: item.name })), { value: NEW_SERIES, label: '新建一个系列…' }]} /></Labelled>}
      {making && !fixedSeries && <DeclarationForm value={declaration} onChange={setDeclaration} vocabulary={vocabulary} />}
      {making && !fixedSeries && <Precision value={precision} onChange={setPrecision} />}
    </section>
    <Fail error={create.error} />
    <div className="flex justify-end">
      <Button type="submit" disabled={create.isPending || pending.length > 0}>{create.isPending ? <Spinner /> : <Icon name="action/add" data-icon="inline-start" />}以此建草稿规格</Button>
    </div>
  </form>;
}

export function CreateScreen() {
  const navigate = useNavigate();
  const { series: fixedSeries, from } = route.useSearch();
  const series = useProductSeries(fixedSeries ?? '');
  const [tab, setTab] = useState(from === 'standard' ? 'standard' : 'scratch');
  const header = (children: ReactNode) => <TypeFrame at={{ kind: 'library' }}>
    <PageHeader trail={[{ label: '型号库', onClick: () => void navigate({ to: '/library' }) }]} title={fixedSeries ? '新建规格' : '新建型号'}
      marks={fixedSeries && series.data ? <Badge variant="secondary">{series.data.series.name}</Badge> : undefined} />
    {children}
  </TypeFrame>;
  return header(<Tabs value={tab} onValueChange={value => setTab(String(value))} className="flex min-h-0 flex-1 flex-col gap-0">
    <div className="flex h-11 shrink-0 items-end border-b border-line px-6">
      <TabsList variant="line" className="h-11 border-b-0">
        <TabsTrigger value="scratch">从零新建</TabsTrigger>
        <TabsTrigger value="standard">按标准给出初始结构</TabsTrigger>
      </TabsList>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <TabsContent value="scratch"><FromScratch fixedSeries={fixedSeries} /></TabsContent>
        <TabsContent value="standard"><FromStandard fixedSeries={fixedSeries} /></TabsContent>
      </div>
    </div>
  </Tabs>);
}
