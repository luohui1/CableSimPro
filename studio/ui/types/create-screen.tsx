// A new type or a new size, made by a person: typed in from nothing with the section drawn as it is filled, or started from what
// the product standard gives, set against a size the library already has, and completed by the engineer. A size made here is the
// first draft of a version, recorded as typed by a person, with the basis of every number; review stays with a person too. A
// standard's proposal says where each dimension comes from, and what it leaves for the engineer to give.
import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { compact } from '@shared/format';
import { cableShape } from '@shared/geometry';
import type { ProposedDimension, SeriesCreated, SpecCreated, SpecPreview, StructureProposal } from '@shared/model-types';
import type { SeriesDeclaration, SeriesView } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Disclosure } from '@/kit/disclosure';
import { Icon, Spinner } from '@/kit/icon';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { FlowLayout, Stepper, type FlowStep } from '@/kit/workbench/flow';
import { FormNote, FormRow, FormSection, ReadonlyValue, Segmented, SourceTag, UnitInput } from '@/kit/workbench/form';
import { PageHeader, Panel, Split } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useProductLibrary, useVocabulary } from '@/state/queries';
import { CommonSizes, EMPTY_DECLARATION, KilovoltInput, lacking, Pick, SeriesFields, StructureFields } from './forms';
import { TypeFrame } from './frame';
import { closureText, methodName } from './model';
import { SectionFigure } from './section-figure';

const route = getRouteApi('/library/new');

/** The series being added to, when there is one; nothing is asked of the host for a series that is yet to be made. */
const useSeriesOf = (id: string | undefined) => useQuery({ queryKey: ['library', 'series', id], enabled: Boolean(id),
  queryFn: () => api.op<SeriesView>('library.series.get', { series: id! }) });
const NEW_SERIES = '__new__';

/** What `create_series` takes of a declaration: everything the person wrote, nothing filled in for them. */
const seriesParams = (declaration: SeriesDeclaration, precision: number | null) => ({
  name: declaration.name.trim(), designation: declaration.designation.trim(), cores: declaration.cores, u0_v: declaration.u0_v, u_v: declaration.u_v,
  ...(declaration.um_v ? { um_v: declaration.um_v } : {}),
  ...(declaration.manufacturer.trim() ? { manufacturer: declaration.manufacturer.trim() } : {}),
  standards: declaration.standards.map(item => item.trim()).filter(Boolean), origin: declaration.origin ?? 'factory',
  ...(declaration.armour_material ? { armour_material: declaration.armour_material } : {}),
  common: declaration.common, common_basis: declaration.common_basis, modelling: declaration.modelling,
  // The precision the outer diameters are written to: the closure of the outer diameter cannot do without it, so it is asked for.
  ...(!('diameter_rounding' in declaration.modelling) && precision ? { outer_diameter_precision_mm: precision } : {}),
});

const numbers = (values: Record<string, number | null>) => Object.fromEntries(Object.entries(values).flatMap(([key, value]) => (value ? [[key, value]] : [])));
const texts = (basis: Record<string, string>) => Object.fromEntries(Object.entries(basis).filter(([, text]) => text.trim()).map(([key, text]) => [key, text.trim()]));
/** The basis of the values that are there: the basis a cleared value left behind is not sent with it. */
const basisOfValues = (values: Record<string, number>, basis: Record<string, string>) => Object.fromEntries(Object.entries(texts(basis)).filter(([key]) => key in values));

/** Makes the series when the person is making one, then the size in it; the page then shows the size. A series made by a
 *  try that failed on the size is kept, so trying again does not make a second one. */
function useCreate() {
  const navigate = useNavigate();
  const [created, setCreated] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: async (input: { series?: string; declaration?: SeriesDeclaration; precision?: number | null; values: Record<string, number>; basis: Record<string, string>; proposal?: string }) => {
      let series = input.series ?? created;
      if (!series) {
        series = (await api.op<SeriesCreated>('library.series.create', seriesParams(input.declaration!, input.precision ?? null))).series;
        setCreated(series);
      }
      return await api.op<SpecCreated>('library.spec.create', { series, values: input.values, basis: input.basis, ...(input.proposal ? { proposal: input.proposal } : {}) });
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void navigate({ to: '/library/$seriesId', params: { seriesId: result.view.series.id }, search: { spec: result.spec } });
    },
  });
  /** New conditions start over: a series an earlier try made is not the place for a size made for other conditions. */
  const forget = () => { setCreated(undefined); create.reset(); };
  return { ...create, created, forget };
}

function Fail({ error }: { error: Error | null }) {
  return error ? <FormNote tone="attention" title="没能建成"><span role="alert">{error.message}</span></FormNote> : null;
}

type Way = 'manual' | 'standard';

/** The header both ways in share: the way is switched here, the way out is here, and the one copper button is the way's next step. */
function NewHeader({ way, onWay, fixedSeries, primary }: { way: Way; onWay: (way: Way) => void; fixedSeries: string | undefined; primary?: ReactNode }) {
  const navigate = useNavigate();
  const series = useSeriesOf(fixedSeries);
  return <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库', onClick: () => void navigate({ to: '/library' }) }]} title={fixedSeries ? '新建规格' : '新建型号'}
    marks={<>
      {fixedSeries && series.data && <Badge variant="secondary">{series.data.series.name}</Badge>}
      <Segmented label="新建方式" value={way} onValueChange={next => onWay(next as Way)} options={[{ value: 'manual', label: '从零填写' }, { value: 'standard', label: '按标准生成' }]} />
    </>}
    actions={<Button variant="ghost" onClick={() => void navigate({ to: '/library' })}>取消</Button>} primary={primary} />;
}

/** The series a size goes into: one that is there, or one made with it. A series already made by an attempt that failed on the size is kept. */
function SeriesChoice({ fixedSeries, target, onTarget, locked, name, options }: {
  fixedSeries: string | undefined; target: string; onTarget: (target: string) => void; locked: boolean; name: string; options: { id: string; name: string }[];
}) {
  if (locked) return <FormNote title="系列已经建好">系列「{name}」已经建好，下面只差规格；改好规格后再建一次。</FormNote>;
  if (fixedSeries) return null;
  return <FormRow label="放进哪个系列"><Pick label="系列" value={target} onValueChange={onTarget}
    options={[{ value: NEW_SERIES, label: '新建一个系列…' }, ...options.map(item => ({ value: item.id, label: item.name }))]} /></FormRow>;
}

/** How finely the outer diameters of a series are written: half the last digit is the tolerance of the closure. */
function Precision({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return <FormRow label="外径填写精度" htmlFor="declare-precision" hint="半个末位用作外径闭合的容差。">
    <UnitInput id="declare-precision" aria-label="外径填写精度" unit="mm" min={0.0001} className="w-48" value={value} onValueChange={onChange} />
  </FormRow>;
}

// ---- 从零填写 ----

/** The section of what is typed so far, built by the host the same way the size will be built: nothing is saved. */
function usePreview(request: Record<string, unknown> | null) {
  const key = JSON.stringify(request);
  const [settled, setSettled] = useState(key);
  useEffect(() => { const timer = setTimeout(() => setSettled(key), 500); return () => clearTimeout(timer); }, [key]);
  return useQuery({ queryKey: ['library', 'preview', settled], enabled: request !== null && settled !== 'null', retry: false, staleTime: Infinity, placeholderData: keepPreviousData,
    queryFn: () => api.op<SpecPreview>('library.spec.preview', JSON.parse(settled)) });
}

function SectionPreview({ request }: { request: Record<string, unknown> | null }) {
  const preview = usePreview(request);
  const shape = useMemo(() => {
    const entry = preview.data?.entry;
    if (!entry) return null;
    try { return cableShape(entry.payload.cable_type, entry.payload.materials); } catch { return null; }
  }, [preview.data]);
  const warnings = preview.data?.warnings ?? [];
  return <Panel title="断面" tools={preview.data && !preview.isError ? <span className="text-sm text-ink-2 tabular-nums">{closureText(preview.data.closure)}</span> : undefined} bodyClassName="flex flex-col bg-canvas">
    <div className="relative min-h-0 flex-1">
      {request === null ? <EmptyState icon="object/section" title="断面边填边画" description="填好系列和规格的截面，再填各层尺寸，这里画出按这些尺寸建成的断面。" />
        : preview.isError ? <EmptyState icon="status/warning" title="还画不出断面" description={preview.error.message} />
          : shape ? <div className="absolute inset-8"><SectionFigure shape={shape} label="填写中的结构断面" role={null} /></div>
            : <Skeleton className="m-8 h-64" />}
    </div>
    {warnings.length > 0 && !preview.isError && <div className="flex flex-col gap-1 border-t border-line bg-surface px-4 py-3 text-sm text-ink">
      {warnings.map(issue => <span key={issue.code + issue.message} className="flex gap-2"><span className="flex h-5 shrink-0 items-center"><Icon name="status/warning" className="text-attention" /></span>{issue.message}</span>)}
    </div>}
  </Panel>;
}

function FromScratch({ fixedSeries, onWay }: { fixedSeries: string | undefined; onWay: (way: Way) => void }) {
  const vocabulary = useVocabulary();
  const library = useProductLibrary();
  const [target, setTarget] = useState(fixedSeries ?? NEW_SERIES);
  const series = useSeriesOf(target === NEW_SERIES ? undefined : target);
  const [declaration, setDeclaration] = useState<SeriesDeclaration>(EMPTY_DECLARATION);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [precision, setPrecision] = useState<number | null>(0.1);
  const create = useCreate();
  const making = target === NEW_SERIES;
  const locked = Boolean(create.created);
  const missingBasis = making && !locked ? lacking(declaration, vocabulary.data) : [];
  const given = new Set(Object.keys(making ? declaration.common : series.data?.declaration.common ?? {}));
  const declared = declaration.name.trim() && declaration.designation.trim() && declaration.u0_v > 0 && declaration.u_v > 0 && precision;
  // The section can be drawn once the size is named by its cross-section and the series it goes into is known.
  const sent = numbers(values) as Record<string, number>;
  const request = values.area && missingBasis.length === 0 && (making ? declared : !series.isPending && !series.isError)
    ? { ...(making && !locked ? { new_series: seriesParams(declaration, precision) } : { series: locked ? create.created : target }), values: sent, basis: basisOfValues(sent, basis) } : null;
  const submit = () => create.mutate({ ...(making ? { declaration, precision } : { series: target }), values: sent, basis: basisOfValues(sent, basis) });

  return <>
    <NewHeader way="manual" onWay={onWay} fixedSeries={fixedSeries}
      primary={<Button disabled={create.isPending || missingBasis.length > 0 || !values.area || (making && !locked && !declared)} onClick={submit}>
        {create.isPending ? <Spinner /> : <Icon name="action/save" data-icon="inline-start" />}建成草稿</Button>} />
    <Split panes={[
      { id: 'form', size: 60, min: 44, children: <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <div className="flex max-w-3xl flex-col gap-10 px-8 py-8">
          <FormSection title={making && !locked ? '型号' : '规格'} description={making && !locked ? '系列的名称、型号写法、芯数、电压和执行标准；同一系列的规格共用这些。' : `加进「${series.data?.series.name ?? '这个系列'}」的一个规格。`}>
            <SeriesChoice fixedSeries={fixedSeries} target={target} onTarget={setTarget} locked={locked} name={declaration.name} options={library.data ?? []} />
            {making && !locked && <>
              <SeriesFields value={declaration} onChange={setDeclaration} idPrefix="declare" />
              <Precision value={precision} onChange={setPrecision} />
            </>}
            <FormRow label="规格" htmlFor="value-area"><UnitInput id="value-area" aria-label="标称截面" unit="mm²" min={0} className="w-48" value={values.area ?? null} onValueChange={number => setValues({ ...values, area: number })} /></FormRow>
          </FormSection>
          {making && !locked && <CommonSizes value={declaration} onChange={setDeclaration} vocabulary={vocabulary.data} />}
          <FormSection title="分层结构" description="从导体往外逐层填，单位 mm。每个值记作人工填写，可以写上依据。">
            <StructureFields vocabulary={vocabulary.data} values={values} basis={basis} onValues={setValues} onBasis={setBasis} taken={given} />
          </FormSection>
          {missingBasis.length > 0 && <FormNote tone="attention" title="请补充取值依据">{missingBasis.join('、')}</FormNote>}
          <Fail error={create.error} />
        </div>
      </div> },
      { id: 'preview', size: 40, min: 28, children: <SectionPreview request={request} /> },
    ]} />
  </>;
}

// ---- 按标准生成 ----

/** The words of the proposal's inputs. */
const ARMOURS = [{ value: 'none', label: '无铠装' }, { value: 'steel_tape', label: '双钢带铠装' }];
const CONDUCTORS = [{ value: 'copper', label: '铜' }, { value: 'aluminium', label: '铝' }];
const CORE_WORD: Record<number, string> = { 1: '单芯', 3: '三芯' };

interface Conditions {
  standard: string; u0: number | null; u: number | null; cores: string; conductor: string; area: number | null; armour: string; screened: string;
  conductorScreen: number | null; insulationScreen: number | null; tapeThickness: number | null; tapeWidth: number | null;
}
const FIRST: Conditions = { standard: 'GB/T 12706.2-2020', u0: 8.7, u: 15, cores: '3', conductor: 'copper', area: null, armour: 'none', screened: 'yes',
  conductorScreen: null, insulationScreen: null, tapeThickness: null, tapeWidth: null };

/** Step 1: the cable as the standard asks for it, and the screens the engineer gives so the annex can run. */
function ConditionsStep({ form, set }: { form: Conditions; set: (values: Partial<Conditions>) => void }) {
  const screened = form.screened === 'yes';
  return <div className="flex max-w-3xl flex-col gap-10">
    <FormSection title="按哪份标准、什么样的电缆" description="执行标准写到年号，要与电压等级对应的标准一致；对不上、表外的电压或截面都会被拒绝。">
      <FormRow label="执行标准" htmlFor="std-standard"><Input id="std-standard" aria-label="执行标准" required maxLength={60} className="w-64" value={form.standard} onChange={event => set({ standard: event.target.value })} /></FormRow>
      <FormRow label="电压">
        <div className="grid w-80 grid-cols-2 gap-2">
          <KilovoltInput label="额定相电压 kV" prefix="U₀" volts={form.u0 === null ? null : form.u0 * 1000} onChange={volts => set({ u0: volts / 1000 })} />
          <KilovoltInput label="额定线电压 kV" prefix="U" volts={form.u === null ? null : form.u * 1000} onChange={volts => set({ u: volts / 1000 })} />
        </div>
      </FormRow>
      <FormRow label="芯数"><Segmented label="芯数" value={form.cores} options={[{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }]} onValueChange={cores => set({ cores })} /></FormRow>
      <FormRow label="导体"><Segmented label="导体材料" value={form.conductor} options={CONDUCTORS} onValueChange={conductor => set({ conductor })} /></FormRow>
      <FormRow label="截面" htmlFor="std-area"><UnitInput id="std-area" aria-label="标称截面" unit="mm²" min={0} className="w-48" value={form.area} onValueChange={area => set({ area })} /></FormRow>
      <FormRow label="绝缘" hint="目前只有 XLPE 的标准结构提案"><ReadonlyValue className="w-64">XLPE（交联聚乙烯）</ReadonlyValue></FormRow>
      <FormRow label="铠装"><Segmented label="铠装形式" value={form.armour} options={ARMOURS} onValueChange={armour => set({ armour })} /></FormRow>
    </FormSection>
    <FormSection title="屏蔽（由你给定）" description="要连内衬、钢带和外护套一起算，须给出屏蔽层的厚度；标准只规定铜带的最小标称厚度，实际厚度由工程师定。">
      <FormRow label="半导电屏蔽"><Segmented label="半导电屏蔽" value={form.screened} options={[{ value: 'yes', label: '有' }, { value: 'no', label: '无' }]} onValueChange={next => set({ screened: next })} /></FormRow>
      <FormRow label="导体屏蔽厚度" htmlFor="std-cs"><UnitInput id="std-cs" aria-label="导体屏蔽厚度" unit="mm" min={0} className="w-48" disabled={!screened} value={form.conductorScreen} onValueChange={conductorScreen => set({ conductorScreen })} /></FormRow>
      <FormRow label="绝缘屏蔽厚度" htmlFor="std-is"><UnitInput id="std-is" aria-label="绝缘屏蔽厚度" unit="mm" min={0} className="w-48" disabled={!screened} value={form.insulationScreen} onValueChange={insulationScreen => set({ insulationScreen })} /></FormRow>
      <FormRow label="铜带厚度" htmlFor="std-tt"><UnitInput id="std-tt" aria-label="铜带厚度" unit="mm" min={0} className="w-48" value={form.tapeThickness} onValueChange={tapeThickness => set({ tapeThickness })} /></FormRow>
      <FormRow label="铜带宽度" htmlFor="std-tw"><UnitInput id="std-tw" aria-label="铜带宽度" unit="mm" min={0} className="w-48" value={form.tapeWidth} onValueChange={tapeWidth => set({ tapeWidth })} /></FormRow>
    </FormSection>
  </div>;
}

/** The size of the library nearest to what the standard was asked for: the same voltage, cores and cross-section, the one that has most of the dimensions. */
function useReference(proposal: StructureProposal | null) {
  const library = useProductLibrary();
  const candidates = (library.data ?? []).filter(item => proposal && item.cores === Number(proposal.inputs.cores) && item.u0_v === Number(proposal.inputs.u0_v) && item.u_v === Number(proposal.inputs.u_v));
  const views = useQueries({ queries: candidates.map(item => ({ queryKey: ['library', 'series', item.id], queryFn: () => api.op<SeriesView>('library.series.get', { series: item.id }) })) });
  if (!proposal) return null;
  const fields = proposal.dimensions.map(dimension => dimension.field);
  const found = candidates.flatMap((item, index) => {
    const spec = views[index]?.data?.specs.find(row => row.area_mm2 === Number(proposal.inputs.area_mm2));
    return spec ? [{ series: item.name, key: spec.key, dims: spec.dimensions, score: fields.filter(field => spec.dimensions[field]).length }] : [];
  });
  return found.sort((a, b) => b.score - a.score)[0] ?? null;
}

type Reference = NonNullable<ReturnType<typeof useReference>>;

/** The clause and the page a dimension stands on; the standard too when it is not the proposal's own. */
function placeOf(dimension: ProposedDimension, proposal: StructureProposal) {
  const { source } = dimension;
  if (source.kind === 'given') return undefined;
  const parts = [source.standard && source.standard !== proposal.standard ? source.standard : null, source.clause, source.pdf_page ? `PDF 第 ${source.pdf_page} 页` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function difference(dimension: ProposedDimension, reference: Reference | null) {
  const printed = reference?.dims[dimension.field]?.value;
  if (printed === undefined) return <span className="text-ink-2">库里未列</span>;
  const delta = Math.round((dimension.value - printed) * 1000) / 1000;
  return delta === 0 ? <span className="text-ink-2">相同</span> : <span className="font-medium text-attention-ink">{delta > 0 ? '+' : '−'}{compact(Math.abs(delta))}</span>;
}

interface Stage { stage: string; formula: string; value: number }
const STAGE_COLUMNS: Column<Stage & { step: number }>[] = [
  { key: 'stage', header: '阶段', width: 'w-56', cell: item => `${item.step}. ${item.stage}` },
  { key: 'formula', header: '式子', cell: item => <span className="text-ink-2">{item.formula}</span> },
  { key: 'value', header: '值', unit: 'mm', numeric: true, width: 'w-24', cell: item => compact(item.value) },
];
const MISSING_COLUMNS: Column<StructureProposal['missing'][number]>[] = [
  { key: 'label', header: '尺寸', width: 'w-36', cell: item => <span className="font-medium">{item.label}</span> },
  { key: 'reason', header: '为什么由你给', cell: item => <span className="whitespace-normal">{item.reason}</span> },
];

/** Step 2: what the standard gives, each number with its clause, set against the library's own size of the same cross-section. */
function ProposalStep({ proposal }: { proposal: StructureProposal }) {
  const reference = useReference(proposal);
  const inputs = proposal.inputs;
  const stages = (proposal.dimensions.find(dimension => dimension.source.calculation?.length)?.source.calculation ?? []) as Stage[];
  const columns: Column<ProposedDimension>[] = [
    { key: 'label', header: '尺寸', cell: dimension => dimension.label },
    { key: 'value', header: '提案', unit: 'mm', numeric: true, width: 'w-24', cell: dimension => <span className="font-medium">{compact(dimension.value, 6)}</span> },
    { key: 'source', header: '出处', width: 'w-56', cell: dimension => <SourceTag kind={dimension.source.kind} place={placeOf(dimension, proposal)} /> },
    { key: 'reference', header: `库里 ${inputs.cores}×${inputs.area_mm2}`, unit: 'mm', numeric: true, width: 'w-28', cell: dimension => { const value = reference?.dims[dimension.field]?.value; return value === undefined ? '—' : compact(value, 6); } },
    { key: 'delta', header: '提案比库里', unit: 'mm', numeric: true, width: 'w-32', cell: dimension => difference(dimension, reference) },
  ];
  return <div className="flex max-w-4xl flex-col gap-8">
    <FormSection title="标准给出的尺寸"
      description={`${proposal.standard} · ${compact(Number(inputs.u0_v) / 1000)}/${compact(Number(inputs.u_v) / 1000)} kV · ${CORE_WORD[Number(inputs.cores)] ?? `${inputs.cores} 芯`} · ${inputs.conductor === 'aluminium' ? '铝' : '铜'} ${inputs.area_mm2} mm² · ${String(inputs.insulation)} 绝缘 · ${inputs.armour === 'steel_tape' ? '双钢带铠装' : '无铠装'} · ${inputs.screened ? '有' : '无'}半导电屏蔽`}
      aside={<Badge variant="outline">{methodName(proposal.method)}</Badge>}>
      <DataTable framed rows={proposal.dimensions} rowKey={dimension => dimension.field} columns={columns} />
      {reference ? <FormNote title="对照的是型号库里的同规格">{reference.series} 的 {reference.key}：同电压、同芯数、同截面；表里没有的尺寸写“库里未列”。</FormNote>
        : <FormNote title="型号库里没有可对照的规格">没有同电压、同芯数、同截面的规格，不拿别的尺寸凑数。</FormNote>}
      {stages.length > 0 && <Disclosure title={`内衬、钢带和外护套怎么来的（附录假设直径，${stages.length} 步）`}>
        <div className="px-4 pb-4"><DataTable framed rows={stages.map((stage, index) => ({ ...stage, step: index + 1 }))} rowKey={stage => String(stage.step)} columns={STAGE_COLUMNS} /></div>
      </Disclosure>}
    </FormSection>
    {proposal.missing.length > 0 && <FormSection title="还要你给的" description={`标准不规定这 ${proposal.missing.length} 项；下一步按实际值填写。`}>
      <DataTable framed rows={proposal.missing} rowKey={item => item.field} columns={MISSING_COLUMNS} />
    </FormSection>}
    <FormNote title="这份提案不说明什么">
      <ul className="m-0 flex list-disc flex-col gap-1 pl-4">{proposal.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </FormNote>
  </div>;
}

const FLOW = ['条件', '提案与对照', '补齐并建成草稿'];

function FromStandard({ fixedSeries, onWay }: { fixedSeries: string | undefined; onWay: (way: Way) => void }) {
  const vocabulary = useVocabulary();
  const library = useProductLibrary();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Conditions>(FIRST);
  const set = (values: Partial<Conditions>) => setForm(current => ({ ...current, ...values }));
  const [proposal, setProposal] = useState<StructureProposal | null>(null);
  const [filled, setFilled] = useState<Record<string, number | null>>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(fixedSeries ?? NEW_SERIES);
  const [precision, setPrecision] = useState<number | null>(0.1);
  const [declaration, setDeclaration] = useState<SeriesDeclaration>(EMPTY_DECLARATION);
  const create = useCreate();
  const screened = form.screened === 'yes';
  const propose = useMutation({
    mutationFn: () => api.op<StructureProposal>('structure.propose', {
      standard: form.standard.trim(), u0_v: Math.round((form.u0 ?? 0) * 1000), u_v: Math.round((form.u ?? 0) * 1000), cores: Number(form.cores), conductor: form.conductor,
      area_mm2: form.area ?? 0, insulation: 'XLPE', armour: form.armour, scope: 'complete', screened,
      ...(screened && form.conductorScreen ? { conductor_screen_thickness_mm: form.conductorScreen } : {}),
      ...(screened && form.insulationScreen ? { insulation_screen_thickness_mm: form.insulationScreen } : {}),
      ...(form.tapeThickness ? { screen_tape_thickness_mm: form.tapeThickness } : {}),
      ...(form.tapeWidth ? { screen_tape_width_mm: form.tapeWidth } : {}),
    }),
    onSuccess: made => {
      create.forget();
      setProposal(made); setFilled({}); setBasis({}); setStep(1);
      setDeclaration({ ...EMPTY_DECLARATION, standards: [made.standard], cores: made.inputs.cores === 1 ? 1 : 3, u0_v: Number(made.inputs.u0_v ?? 0), u_v: Number(made.inputs.u_v ?? 0) });
    },
  });

  const making = target === NEW_SERIES;
  const locked = Boolean(create.created);
  const pending = proposal ? proposal.missing.filter(item => !filled[item.field]) : [];
  const missingBasis = making && !fixedSeries && !locked ? lacking(declaration, vocabulary.data) : [];
  const declared = Boolean(declaration.name.trim() && declaration.designation.trim() && declaration.u0_v > 0 && declaration.u_v > 0 && precision);
  const ready = proposal !== null && pending.length === 0 && missingBasis.length === 0 && (!making || locked || fixedSeries || declared);
  // The size is the one the proposal was made for, whatever the form says now.
  const submit = () => {
    if (!proposal) return;
    // The basis of what the standard gave comes from the proposal itself; only what the engineer gave carries a basis of their own.
    const given = numbers(filled) as Record<string, number>;
    const values = { area: Number(proposal.inputs.area_mm2), ...proposal.values, ...given };
    create.mutate({ ...(making ? { declaration, precision } : { series: target }), values, basis: basisOfValues(given, basis), proposal: proposal.id });
  };
  const settled = [`${form.standard} · ${form.cores}×${form.area ?? '—'}`, proposal ? `${proposal.dimensions.length} 个尺寸，还缺 ${proposal.missing.length} 项` : '', ''];
  const steps: FlowStep[] = FLOW.map((title, index) => ({ title, status: index < step ? 'done' : index === step ? 'current' : 'upcoming', detail: index < step ? settled[index] : undefined }));
  const footer = step === 0
    ? <Button disabled={propose.isPending || !form.area || !form.u0 || !form.u || !form.standard.trim()} onClick={() => propose.mutate()}>
      {propose.isPending ? <Spinner /> : <Icon name="run/run" data-icon="inline-start" />}生成提案</Button>
    : step === 1
      ? <><Button variant="outline" onClick={() => setStep(0)}><Icon name="action/arrow-left" data-icon="inline-start" />改条件</Button>
        <Button onClick={() => setStep(2)}>下一步：补齐并建成<Icon name="action/arrow-right" data-icon="inline-end" /></Button></>
      : <><Button variant="outline" onClick={() => setStep(1)}><Icon name="action/arrow-left" data-icon="inline-start" />上一步</Button>
        <Button disabled={create.isPending || !ready} onClick={submit}>{create.isPending ? <Spinner /> : <Icon name="action/save" data-icon="inline-start" />}建成草稿</Button></>;

  return <>
    <NewHeader way="standard" onWay={onWay} fixedSeries={fixedSeries} />
    <FlowLayout steps={<Stepper label="按标准生成的步骤" steps={steps} />} footer={footer}>
      {step === 0 && <div className="flex flex-col gap-6"><ConditionsStep form={form} set={set} />{propose.error && <FormNote tone="attention" title="标准没有给出提案"><span role="alert">{propose.error.message}</span></FormNote>}</div>}
      {step === 1 && proposal && <ProposalStep proposal={proposal} />}
      {step === 2 && proposal && <div className="flex max-w-3xl flex-col gap-10">
        {proposal.missing.length > 0 && <FormSection title={`标准不规定的 ${proposal.missing.length} 项`} description="按实际值填写；成品外径用来做外径闭合核对。">
          {proposal.missing.map(item => <FormRow key={item.field} label={item.label} htmlFor={`missing-${item.field}`} hint={item.reason}>
            <div className="flex flex-col gap-2">
              <UnitInput id={`missing-${item.field}`} aria-label={`填写${item.label}`} unit={item.unit} min={0} className="w-48" value={filled[item.field] ?? null} onValueChange={number => setFilled(current => ({ ...current, [item.field]: number }))} />
              <Input aria-label={`${item.label}依据`} placeholder="取值依据（可选），如图纸号、实测" value={basis[item.field] ?? ''} onChange={event => setBasis(current => ({ ...current, [item.field]: event.target.value }))} />
            </div>
          </FormRow>)}
        </FormSection>}
        <FormSection title="放进哪个系列" description="新建一个系列，这个规格是它的第 1 版草稿；或放进已有的系列。">
          <SeriesChoice fixedSeries={fixedSeries} target={target} onTarget={setTarget} locked={locked} name={declaration.name}
            options={(library.data ?? []).filter(item => item.cores === declaration.cores && item.u0_v === declaration.u0_v && item.u_v === declaration.u_v)} />
          {making && !fixedSeries && !locked && <>
            <SeriesFields value={declaration} onChange={setDeclaration} idPrefix="declare" />
            <Precision value={precision} onChange={setPrecision} />
          </>}
        </FormSection>
        {making && !fixedSeries && !locked && <CommonSizes value={declaration} onChange={setDeclaration} vocabulary={vocabulary.data} />}
        <FormNote title="提案里的尺寸照原样写入">
          <p className="m-0">标准给出的值不能在这里改：改了就不再是标准给的值，软件会拒绝。每个尺寸的依据记成标准条款原文，版本里记下取用的标准提案和方法版本。</p>
        </FormNote>
        {missingBasis.length > 0 && <FormNote tone="attention" title="请补充取值依据">{missingBasis.join('、')}</FormNote>}
        <Fail error={create.error} />
      </div>}
    </FlowLayout>
  </>;
}

export function CreateScreen() {
  const { series: fixedSeries, from } = route.useSearch();
  const [way, setWay] = useState<Way>(from === 'standard' ? 'standard' : 'manual');
  return <TypeFrame at={{ kind: 'library' }}>
    {way === 'manual' ? <FromScratch fixedSeries={fixedSeries} onWay={setWay} /> : <FromStandard fixedSeries={fixedSeries} onWay={setWay} />}
  </TypeFrame>;
}
