// The cable-type screens of round two: importing a structure table in five steps on one screen; a new type typed layer by
// layer or generated from a product standard; and the pages of a specification after its structure: parameters, the
// ampacity table, versions and files with the review. Data: host-records.ts (this branch's host, and the proposal of
// studio-types' core) and the workspace of library-data.ts, both YJV22-8.7/15 kV 3×240.
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { ReviewMark, TierMark, VerdictBar, type Review, type Tier } from '@/kit/marks';
import { Metric, MetricGroup } from '@/kit/metric';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { defineStepper } from '@stepperize/react';
import { FlowLayout, Stepper, flowStatus, type FlowStep } from '@/kit/workbench/flow';
import { ChoiceCards, ChoiceSelect, DropZone, FormNote, FormRow, FormSection, ReadonlyValue, Segmented, SourceTag, UnitInput } from '@/kit/workbench/form';
import { PageHeader, Panel, Split } from '@/kit/workbench/page';
import { Given, PremiseStrip } from '@/kit/workbench/premise';
import { ReviewActions, ReviewTrack } from '@/kit/workbench/review';
import { compact, fixed } from '@shared/format';
import { CableSection } from './figures';
import { WORKSPACE } from './library-data';
import { DOCUMENTS, IMPORT, PRINTED, PROPOSAL, RATING_TABLE, STANDARD_SERIES, VERSIONS, methodLabel, methodText } from './host-records';
import { PLACED, SeriesShell, residualText } from './workbench-screens';

/** A host time as the screen writes times: date and minute, in the reader's zone. */
export const when = (iso: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .format(new Date(iso)).replaceAll('/', '-');

// ---- 导入结构表: one screen, five steps ----

const importFlow = defineStepper([
  { id: 'upload', title: '上传文件' }, { id: 'sheet', title: '选工作表' }, { id: 'columns', title: '列对应' }, { id: 'preview', title: '预览' }, { id: 'commit', title: '导入' },
] as const);
export type ImportStep = (typeof importFlow.steps)[number]['id'];
const MAPPED = IMPORT.columns.filter(column => column.field).length;
const SHEET = IMPORT.sheets.find(sheet => sheet.name === IMPORT.sheet)!;
const DECLARATION = IMPORT.declaration;
const FIELD_OPTIONS = [
  ...Object.entries(IMPORT.fields).map(([value, field]) => ({ value, label: `${field.label}（${field.unit}）` })),
  { value: 'none', label: '不导入' },
];

/** What each step settled, written under it once it is done. */
const IMPORT_SETTLED: Record<ImportStep, string> = {
  upload: IMPORT.file, sheet: IMPORT.sheet, columns: `${MAPPED} 列对上字段`, preview: `${IMPORT.ready} 行可导入`, commit: '',
};

type Column3 = (typeof IMPORT.columns)[number];
const COLUMN_COLUMNS: Column<Column3>[] = [
  { key: 'letter', header: '列', width: 'w-12', cell: column => <span className="font-medium">{column.letter}</span> },
  { key: 'header', header: '表头', cell: column => <span className={column.field ? 'text-ink' : 'text-ink-2'}>{column.header}</span> },
  { key: 'sample', header: '前三行', width: 'w-40', cell: column => <span className="text-ink-2 tabular-nums">{column.sample.join('，')}</span> },
  { key: 'field', header: '对应到', width: 'w-60', cell: column => <ChoiceSelect size="sm" label={`${column.letter} 列对应到`} value={column.field ?? 'none'} options={FIELD_OPTIONS} /> },
];

type PreviewRow = (typeof IMPORT.rows)[number];
const PREVIEW_COLUMNS: Column<PreviewRow>[] = [
  { key: 'row', header: '表中行', numeric: true, width: 'w-20', cell: row => row.row },
  { key: 'key', header: '规格', width: 'w-28', cell: row => <span className="font-medium">{row.key}</span> },
  { key: 'od', header: '表列外径', unit: 'mm', numeric: true, width: 'w-28', cell: row => fixed(row.od, 1) },
  { key: 'listed', header: '各层合计', unit: 'mm', numeric: true, width: 'w-28', cell: row => fixed(row.listed, 2) },
  { key: 'residual', header: '余量（单边）', unit: 'mm', numeric: true, width: 'w-32', cell: row => fixed(row.residual, 2) },
  { key: 'state', header: '状态', width: 'w-28', cell: row => {
    const notes: string[] = row.ok ? row.warnings : [row.error ?? ''];
    const badge = !row.ok ? <Badge variant="error"><Icon name="status/error" data-icon="inline-start" />不能导入</Badge>
      : notes.length ? <Badge variant="attention"><Icon name="status/warning" data-icon="inline-start" />可导入</Badge>
        : <Badge variant="success"><Icon name="action/check" data-icon="inline-start" />可导入</Badge>;
    return notes.length ? <Tooltip><TooltipTrigger render={<span tabIndex={0}>{badge}</span>} /><TooltipContent>{notes.join('；')}</TooltipContent></Tooltip> : badge;
  } },
];
const PLACED_IN_PREVIEW = [...new Set(IMPORT.rows.map(row => row.placedIn).filter(Boolean))].map(key => PLACED[key] ?? key).join('、');

function ImportContent({ at }: { at: ImportStep }) {
  if (at === 'upload') return <div className="flex max-w-3xl flex-col gap-10">
    <FormSection title="上传结构表" description="读取每张工作表的表头、数据起始行和各列建议对应的字段。">
      <DropZone title="把结构表拖到这里" formats="支持 .xlsx、.xls 和 .csv 的结构表" />
    </FormSection>
    <FormSection title="手边没有结构表" description="用一份公开厂家手册（人民电缆 8.7/15 kV 结构表）试导入，它附带每张表所需的系列声明。">
      <div><Button variant="outline"><Icon name="object/file" data-icon="inline-start" />用公开样例</Button></div>
    </FormSection>
  </div>;
  if (at === 'sheet') return <div className="flex max-w-3xl flex-col gap-6">
    <FormSection title="选一张工作表" description="一张工作表导入为一个新系列。">
      <ChoiceCards label="工作表" columns="grid-cols-2" value={IMPORT.sheet} options={IMPORT.sheets.map(sheet => ({
        value: sheet.name, title: sheet.name, icon: 'result/table',
        detail: `表头第 ${sheet.headerRows.join('–')} 行，第 ${sheet.firstDataRow} 行起 ${sheet.dataRows} 行数据`,
      }))} />
    </FormSection>
  </div>;
  if (at === 'columns') return <div className="flex max-w-4xl flex-col gap-6">
    <FormSection title="把列对上字段" description={`${IMPORT.sheet}：表头第 ${SHEET.headerRows.join('–')} 行，第 ${SHEET.firstDataRow} 行起 ${SHEET.dataRows} 行数据。下拉里是建议的对应，不对就改。`}
      aside={<Button variant="outline" size="sm"><Icon name="action/save" data-icon="inline-start" />存为常用对应</Button>}>
      <FormNote title={`表名读出的型号：${IMPORT.designation.model}`}>{IMPORT.designation.description}</FormNote>
      <DataTable framed rows={IMPORT.columns} rowKey={column => column.letter} columns={COLUMN_COLUMNS} />
    </FormSection>
  </div>;
  if (at === 'preview') return <div className="flex max-w-4xl flex-col gap-6">
    <FormSection title="每一行生成的规格" description="按系列声明和列对应生成，还没有保存。">
      <MetricGroup>
        <Metric size="md" label="可导入" value={IMPORT.ready} unit="行" />
        <Metric size="md" label="不能导入" value={IMPORT.failed} unit="行" />
        <Metric size="md" label="不是数据，跳过" value={IMPORT.skipped.length} unit="行" />
      </MetricGroup>
      <DataTable framed rows={IMPORT.rows} rowKey={row => row.key} columns={PREVIEW_COLUMNS} />
      {IMPORT.skipped.map(row => <FormNote key={row.row} title={`第 ${row.row} 行不导入`}>{row.text}</FormNote>)}
      <FormNote title="尺寸怎么来的">{WORKSPACE.derivation}{PLACED_IN_PREVIEW && ` 表列外径比各层合计多出的部分计入${PLACED_IN_PREVIEW}。`}</FormNote>
    </FormSection>
  </div>;
  return <div className="flex max-w-3xl flex-col gap-10">
    <FormSection title="系列" description={`导入为一个新系列，每行成为一个规格的第 1 版草稿。来源：${IMPORT.file} · 工作表“${IMPORT.sheet}”。`}>
      <FormRow label="系列名称" htmlFor="series-name"><Input id="series-name" defaultValue={DECLARATION.name} /></FormRow>
      <FormRow label="制造商" htmlFor="series-maker"><Input id="series-maker" defaultValue={DECLARATION.manufacturer} /></FormRow>
      <FormRow label="型号" htmlFor="series-designation" hint={IMPORT.designation.description}><Input id="series-designation" defaultValue={DECLARATION.designation} className="w-48" /></FormRow>
      <FormRow label="芯数" htmlFor="series-cores"><UnitInput id="series-cores" unit="芯" defaultValue={DECLARATION.cores} className="w-48" /></FormRow>
      <FormRow label="电压">
        <div className="grid grid-cols-3 gap-2">
          <UnitInput aria-label="U₀" prefix="U₀" unit="kV" defaultValue={compact(DECLARATION.u0_v / 1000)} />
          <UnitInput aria-label="U" prefix="U" unit="kV" defaultValue={compact(DECLARATION.u_v / 1000)} />
          <UnitInput aria-label="Um" prefix="Um" unit="kV" defaultValue={compact(DECLARATION.um_v / 1000)} />
        </div>
      </FormRow>
      <FormRow label="执行标准">
        <div className="flex flex-wrap items-center gap-2">
          {DECLARATION.standards.map(standard => <Badge key={standard} variant="outline">{standard}</Badge>)}
          <Button variant="ghost" size="sm"><Icon name="action/add" data-icon="inline-start" />添加</Button>
        </div>
      </FormRow>
    </FormSection>
    <FormSection title="表里没有、另行取值" description="结构表没列的尺寸，取值和依据记进每个规格。">
      {Object.entries(DECLARATION.common).map(([key, value]) => {
        const field = IMPORT.fields[key as keyof typeof IMPORT.fields];
        return <FormRow key={key} label={field.label}>
          <div className="flex flex-col gap-2">
            <UnitInput aria-label={field.label} unit={field.unit} defaultValue={value} className="w-48" />
            <Input aria-label={`${field.label}的依据`} defaultValue={DECLARATION.common_basis[key as keyof typeof DECLARATION.common_basis]} />
          </div>
        </FormRow>;
      })}
    </FormSection>
  </div>;
}

function ImportBody({ at }: { at: ImportStep }) {
  const flow = importFlow.useStepper({ defaultStep: at });
  const step = flow.current.id;
  const next = importFlow.steps[importFlow.steps.findIndex(item => item.id === step) + 1];
  const steps: FlowStep[] = importFlow.steps.map(item => ({
    title: item.title, status: flowStatus(flow.status(item.id)), detail: flow.status(item.id) === 'previous' ? IMPORT_SETTLED[item.id] : undefined,
  }));
  return <>
    <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库' }]} title="导入结构表" marks={!flow.isFirst ? <Badge variant="outline"><Icon name="object/file" data-icon="inline-start" />{IMPORT.file}</Badge> : undefined} />
    <FlowLayout steps={<Stepper label="导入步骤" steps={steps} />} footer={<>
      <Button variant="ghost" className="mr-auto">取消</Button>
      {!flow.isFirst && <Button variant="outline" onClick={() => void flow.prev()}><Icon name="action/arrow-left" data-icon="inline-start" />上一步</Button>}
      {flow.isFirst ? null
        : next ? <Button onClick={() => void flow.next()}>下一步：{next.title}<Icon name="action/arrow-right" data-icon="inline-end" /></Button>
        : <Button><Icon name="action/import" data-icon="inline-start" />导入 {IMPORT.ready} 个规格</Button>}
    </>}>
      <ImportContent at={step} />
    </FlowLayout>
  </>;
}

// ---- 新建型号: two ways in, one header ----

function NewTypeHeader({ way, primary }: { way: 'manual' | 'standard'; primary?: ReactNode }) {
  return <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库' }]} title="新建型号"
    marks={<Segmented label="新建方式" value={way} options={[{ value: 'manual', label: '从零填写' }, { value: 'standard', label: '按标准生成' }]} />}
    actions={<Button variant="ghost">取消</Button>} primary={primary} />;
}

// The layers in order from the conductor out, as the structure table names them.
const LAYER_ORDER = ['conductor_diameter', 'conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness', 'screen_tape_thickness',
  'binder_thickness', 'bedding_thickness', 'armour_tape_thickness', 'armour_tape_width', 'oversheath_thickness', 'outer_diameter'];

function TypeNewManualBody() {
  const rows = LAYER_ORDER.map(key => WORKSPACE.structure.find(row => row.key === key)!);
  return <>
    <NewTypeHeader way="manual" primary={<Button><Icon name="action/save" data-icon="inline-start" />建成草稿</Button>} />
    <Split panes={[
      { id: 'form', size: 60, min: 44, children: <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
          <div className="flex max-w-3xl flex-col gap-10 px-8 py-8">
            <FormSection title="型号" description="系列的名称、型号写法、芯数、电压和执行标准；同一系列的规格共用这些。">
              <FormRow label="系列名称" htmlFor="type-name"><Input id="type-name" defaultValue="YJV22-8.7/15 kV 三芯" /></FormRow>
              <FormRow label="型号" htmlFor="type-designation" hint={IMPORT.designation.description}><Input id="type-designation" defaultValue={DECLARATION.designation} className="w-48" /></FormRow>
              <FormRow label="芯数"><Segmented label="芯数" value={String(DECLARATION.cores)} options={CORE_OPTIONS} /></FormRow>
              <FormRow label="电压">
                <div className="grid grid-cols-3 gap-2">
                  <UnitInput aria-label="U₀" prefix="U₀" unit="kV" defaultValue={compact(DECLARATION.u0_v / 1000)} />
                  <UnitInput aria-label="U" prefix="U" unit="kV" defaultValue={compact(DECLARATION.u_v / 1000)} />
                  <UnitInput aria-label="Um" prefix="Um" unit="kV" defaultValue={compact(DECLARATION.um_v / 1000)} />
                </div>
              </FormRow>
              <FormRow label="规格" htmlFor="type-area"><UnitInput id="type-area" unit="mm²" defaultValue={240} className="w-48" /></FormRow>
            </FormSection>
            <FormSection title="分层结构" description="从导体往外逐层填，单位 mm。每个值记作人工填写，可以写上依据。">
              {rows.map(row => <FormRow key={row.key} label={row.label} htmlFor={`layer-${row.key}`}>
                <div className="flex items-center gap-3">
                  <UnitInput id={`layer-${row.key}`} unit={row.unit} defaultValue={row.value as number} className="w-40" />
                  <SourceTag kind="manual" />
                </div>
              </FormRow>)}
            </FormSection>
          </div>
        </div> },
      { id: 'preview', size: 40, min: 28, children: <Panel title="断面" tools={<span className="text-sm text-ink-2">{residualText(WORKSPACE.closure.residual_mm, WORKSPACE.closure.placed_in)}</span>} bodyClassName="relative bg-canvas">
          <div className="absolute inset-8"><CableSection /></div>
        </Panel> },
    ]} />
  </>;
}

type Dimension = (typeof PROPOSAL.complete.dimensions)[number];

function placeOf(dimension: Dimension) {
  if (dimension.kind === 'given') return undefined;
  const parts = [dimension.clause, dimension.pdf_page ? `PDF 第 ${dimension.pdf_page} 页` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function difference(dimension: Dimension) {
  const printed = PRINTED[dimension.field];
  if (printed === undefined) return <span className="text-ink-2">手册未列</span>;
  const delta = Math.round((dimension.value - printed) * 10) / 10;
  return delta === 0 ? <span className="text-ink-2">相同</span> : <span className="font-medium text-attention-ink">{delta > 0 ? '+' : '−'}{fixed(Math.abs(delta), 1)}</span>;
}

const PROPOSAL_COLUMNS: Column<Dimension>[] = [
  { key: 'label', header: '尺寸', cell: dimension => dimension.label },
  { key: 'value', header: '提案', unit: 'mm', numeric: true, width: 'w-24', cell: dimension => <span className="font-medium">{fixed(dimension.value, 1)}</span> },
  { key: 'source', header: '出处', width: 'w-56', cell: dimension => <SourceTag kind={dimension.kind} place={placeOf(dimension)} /> },
  { key: 'printed', header: `手册 ${PROPOSAL.inputs.cores}×${PROPOSAL.inputs.area_mm2}`, unit: 'mm', numeric: true, width: 'w-28', cell: dimension => PRINTED[dimension.field] === undefined ? '—' : fixed(PRINTED[dimension.field], 1) },
  { key: 'delta', header: '提案比手册', unit: 'mm', numeric: true, width: 'w-32', cell: difference },
];

// The words of the proposal's inputs (structure.propose's own values).
const CORE_OPTIONS = [{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }];
const CORE_WORD: Record<number, string> = { 1: '单芯', 3: '三芯' };
const CONDUCTOR_WORD: Record<string, string> = { copper: '铜', aluminium: '铝' };
const ARMOUR_WORD: Record<string, string> = { none: '无铠装', steel_tape: '双钢带铠装' };
const STAGES = PROPOSAL.calculation.map((stage, index) => ({ ...stage, step: index + 1 }));
const STAGE_COLUMNS: Column<(typeof STAGES)[number]>[] = [
  { key: 'stage', header: '阶段', width: 'w-56', cell: stage => `${stage.step}. ${stage.stage}` },
  { key: 'formula', header: '式子', cell: stage => <span className="text-ink-2">{stage.formula}</span> },
  { key: 'value', header: '值', unit: 'mm', numeric: true, width: 'w-24', cell: stage => fixed(stage.value, 1) },
];
type Missing = (typeof PROPOSAL.complete.missing)[number];
const MISSING_COLUMNS: Column<Missing>[] = [
  { key: 'label', header: '尺寸', width: 'w-36', cell: item => <span className="font-medium">{item.label}</span> },
  { key: 'reason', header: '为什么由你给', cell: item => <span className="whitespace-normal">{item.reason}</span> },
];

const standardFlow = defineStepper([
  { id: 'conditions', title: '条件' }, { id: 'proposal', title: '提案与对照' }, { id: 'create', title: '补齐并建成草稿' },
] as const);
export type StandardStep = (typeof standardFlow.steps)[number]['id'];


/** Step 1: the cable as the standard asks for it, and the screens the engineer gives so the annex can run. */
function StandardConditions() {
  const inputs = PROPOSAL.inputs;
  return <div className="flex max-w-3xl flex-col gap-10">
    <FormSection title="按哪份标准、什么样的电缆" description="执行标准写到年号，要与电压等级对应的标准一致；对不上、表外的电压或截面都会被拒绝。">
      <FormRow label="执行标准" htmlFor="std-standard"><Input id="std-standard" defaultValue={inputs.standard} className="w-64" /></FormRow>
      <FormRow label="电压">
        <div className="grid w-80 grid-cols-2 gap-2">
          <UnitInput aria-label="U₀" prefix="U₀" unit="kV" defaultValue={compact(inputs.u0_v / 1000)} />
          <UnitInput aria-label="U" prefix="U" unit="kV" defaultValue={compact(inputs.u_v / 1000)} />
        </div>
      </FormRow>
      <FormRow label="芯数"><Segmented label="芯数" value={String(inputs.cores)} options={CORE_OPTIONS} /></FormRow>
      <FormRow label="导体"><Segmented label="导体材料" value={inputs.conductor} options={Object.entries(CONDUCTOR_WORD).map(([value, label]) => ({ value, label }))} /></FormRow>
      <FormRow label="截面" htmlFor="std-area"><UnitInput id="std-area" unit="mm²" defaultValue={inputs.area_mm2} className="w-48" /></FormRow>
      <FormRow label="绝缘" hint="目前只有 XLPE 的标准结构提案"><ReadonlyValue className="w-64">XLPE（交联聚乙烯）</ReadonlyValue></FormRow>
      <FormRow label="铠装"><Segmented label="铠装" value={inputs.armour} options={Object.entries(ARMOUR_WORD).map(([value, label]) => ({ value, label }))} /></FormRow>
    </FormSection>
    <FormSection title="屏蔽（由你给定）" description="要连内衬、钢带和外护套一起算，须给出屏蔽层的厚度；标准只规定铜带的最小标称厚度，实际厚度由工程师定。">
      <FormRow label="半导电屏蔽"><Segmented label="半导电屏蔽" value={inputs.screened ? 'yes' : 'no'} options={[{ value: 'yes', label: '有' }, { value: 'no', label: '无' }]} /></FormRow>
      <FormRow label="导体屏蔽厚度" htmlFor="std-cs"><UnitInput id="std-cs" unit="mm" defaultValue={inputs.conductor_screen_thickness_mm} className="w-48" /></FormRow>
      <FormRow label="绝缘屏蔽厚度" htmlFor="std-is"><UnitInput id="std-is" unit="mm" defaultValue={inputs.insulation_screen_thickness_mm} className="w-48" /></FormRow>
      <FormRow label="铜带厚度" htmlFor="std-tt"><UnitInput id="std-tt" unit="mm" defaultValue={inputs.screen_tape_thickness_mm} className="w-48" /></FormRow>
      <FormRow label="铜带宽度" htmlFor="std-tw"><UnitInput id="std-tw" unit="mm" defaultValue={inputs.screen_tape_width_mm} className="w-48" /></FormRow>
    </FormSection>
  </div>;
}

/** Step 3: what the standard does not give, and the series the draft goes into. The proposal's values are not edited here. */
function StandardCreate() {
  const proposal = PROPOSAL.complete;
  return <div className="flex max-w-3xl flex-col gap-10">
    <FormSection title={`标准不规定的 ${proposal.missing.length} 项`} description="按实际值填写；成品外径用来做外径闭合核对。">
      {proposal.missing.map(item => <FormRow key={item.field} label={item.label} htmlFor={`std-${item.field}`} hint={item.reason}>
        <UnitInput id={`std-${item.field}`} unit={item.unit} defaultValue={PRINTED[item.field]} className="w-48" />
      </FormRow>)}
    </FormSection>
    <FormSection title="放进哪个系列" description="新建一个系列，这个规格是它的第 1 版草稿。">
      <FormRow label="系列名称" htmlFor="std-series"><Input id="std-series" defaultValue={STANDARD_SERIES.name} /></FormRow>
      <FormRow label="型号" htmlFor="std-designation" hint={IMPORT.designation.description}><Input id="std-designation" defaultValue={DECLARATION.designation} className="w-48" /></FormRow>
      <FormRow label="执行标准">
        <div className="flex min-h-9 flex-wrap items-center gap-2">{DECLARATION.standards.map(standard => <Badge key={standard} variant="outline">{standard}</Badge>)}</div>
      </FormRow>
      {STANDARD_SERIES.common.map(item => {
        const field = IMPORT.fields[item.field as keyof typeof IMPORT.fields];
        return <FormRow key={item.field} label={field.label}>
          <div className="flex flex-col gap-2">
            <UnitInput aria-label={field.label} unit={field.unit} defaultValue={item.value} className="w-48" />
            <Input aria-label={`${field.label}的依据`} defaultValue={item.basis} />
          </div>
        </FormRow>;
      })}
    </FormSection>
    <FormNote title="提案里的尺寸照原样写入">
      <p className="m-0">标准给出的值不能在这里改：改了就不再是标准给的值，宿主会拒绝。每个尺寸的依据记成“{STANDARD_SERIES.basisExample}”这样的原文，版本里记下取用的标准提案和方法版本。</p>
    </FormNote>
  </div>;
}

function TypeNewStandardBody({ at = 'proposal' }: { at?: StandardStep }) {
  const inputs = PROPOSAL.inputs;
  const proposal = PROPOSAL.complete;
  const flow = standardFlow.useStepper({ defaultStep: at });
  const step = flow.current.id;
  const settled: Record<StandardStep, string> = {
    conditions: `${PROPOSAL.standard} · ${inputs.cores}×${inputs.area_mm2}`,
    proposal: `${proposal.dimensions.length} 个尺寸，还缺 ${proposal.missing.length} 项`,
    create: '',
  };
  const steps: FlowStep[] = standardFlow.steps.map(item => ({
    title: item.title, status: flowStatus(flow.status(item.id)), detail: flow.status(item.id) === 'previous' ? settled[item.id] : undefined,
  }));
  const footer = step === 'conditions'
    ? <Button onClick={() => void flow.next()}><Icon name="run/run" data-icon="inline-start" />生成提案</Button>
    : step === 'proposal'
      ? <><Button variant="outline" onClick={() => void flow.prev()}><Icon name="action/arrow-left" data-icon="inline-start" />改条件</Button>
        <Button onClick={() => void flow.next()}>下一步：补齐并建成<Icon name="action/arrow-right" data-icon="inline-end" /></Button></>
      : <><Button variant="outline" onClick={() => void flow.prev()}><Icon name="action/arrow-left" data-icon="inline-start" />上一步</Button>
        <Button><Icon name="action/save" data-icon="inline-start" />建成草稿</Button></>;
  return <>
    <NewTypeHeader way="standard" />
    <FlowLayout steps={<Stepper label="按标准生成的步骤" steps={steps} />} footer={footer}>
      {step === 'conditions' ? <StandardConditions /> : step === 'create' ? <StandardCreate /> : <div className="flex max-w-4xl flex-col gap-8">
        <FormSection title="标准给出的尺寸"
          description={`${PROPOSAL.standard} · ${compact(inputs.u0_v / 1000)}/${compact(inputs.u_v / 1000)} kV · ${CORE_WORD[inputs.cores] ?? `${inputs.cores} 芯`} · ${CONDUCTOR_WORD[inputs.conductor] ?? inputs.conductor} ${inputs.area_mm2} mm² · ${inputs.insulation} 绝缘 · ${ARMOUR_WORD[inputs.armour] ?? inputs.armour} · ${inputs.screened ? '有' : '无'}半导电屏蔽`}
          aside={<Badge variant="outline">{methodLabel(`${PROPOSAL.method.plugin_id}/${PROPOSAL.method.capability}`, PROPOSAL.method.method_version)}</Badge>}>
          <DataTable framed rows={proposal.dimensions} rowKey={dimension => dimension.field} columns={PROPOSAL_COLUMNS} />
          <Disclosure title={`内衬、钢带和外护套怎么来的（附录 A 假设直径，${STAGES.length} 步）`}>
            <DataTable framed rows={STAGES} rowKey={stage => String(stage.step)} columns={STAGE_COLUMNS} />
          </Disclosure>
        </FormSection>
        <FormSection title="还要你给的" description={`标准不规定这 ${proposal.missing.length} 项；下一步按实际值填写。`}>
          <DataTable framed rows={proposal.missing} rowKey={item => item.field} columns={MISSING_COLUMNS} />
        </FormSection>
        <FormNote title="这份提案不说明什么">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4">{proposal.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        </FormNote>
      </div>}
    </FlowLayout>
  </>;
}

// ---- 参数: electrical parameters and short-circuit currents of one version ----

type Quantity = (typeof WORKSPACE.electrical)[number];
// Per metre in the method, per kilometre (or μF/km) on the page; four significant figures.
const PER_KM: Record<string, { factor: number; unit: string }> = {
  'Ω/m': { factor: 1000, unit: 'Ω/km' }, 'F/m': { factor: 1e9, unit: 'μF/km' }, 'A/m': { factor: 1000, unit: 'A/km' }, 'H/m': { factor: 1e6, unit: 'mH/km' },
};
const nameOf = (title: string) => title.replace(/^芯 1 · /, '');
// The component a row is about, from its id: the generic 金属组件 of the title becomes the screen or the armour.
const COMPONENT: [string, string][] = [['core/1:metallic_screen', '金属屏蔽'], ['common:armour', '铠装']];
const labelOf = (row: Quantity) => {
  const component = COMPONENT.find(([prefix]) => row.id.startsWith(prefix))?.[1];
  return component ? nameOf(row.title).replace('金属组件', component) : nameOf(row.title);
};
const STATUS_WORD: Record<string, string> = { missing: '缺项', uncovered: '未覆盖' };
const quantityValue = (row: Quantity) => {
  const scale = PER_KM[row.unit];
  return { value: row.value === null ? '—' : compact(row.value * (scale?.factor ?? 1), 4), unit: scale?.unit ?? (row.unit === '1' ? '' : row.unit) };
};
const QUANTITY_COLUMNS: Column<Quantity>[] = [
  { key: 'title', header: '参数', cell: row => nameOf(row.title) },
  { key: 'value', header: '数值', numeric: true, width: 'w-28', cell: row => <span className="font-medium">{quantityValue(row).value}</span> },
  { key: 'unit', header: '单位', width: 'w-20', cell: row => <span className="text-ink-2">{quantityValue(row).unit}</span> },
  { key: 'basis', header: '依据', width: 'w-56', cell: row => <span className="truncate text-ink-2">{row.standard ? `${row.standard} ${String(row.clause ?? '').split('，')[0]}` : '—'}</span> },
];

function Missing({ rows }: { rows: Quantity[] }) {
  return <ul className="m-0 flex list-none flex-col p-0">
    {rows.map(row => <li key={row.id} className="grid grid-cols-property items-start gap-x-4 border-b border-line px-4 py-2 text-sm last:border-b-0">
      <span className="flex flex-col gap-1">
        <span className="text-ink">{labelOf(row)}</span>
        <span className="text-ink-2">{row.reason}</span>
      </span>
      <Badge variant={row.status === 'uncovered' ? 'outline' : 'secondary'}>{STATUS_WORD[row.status] ?? row.status}</Badge>
      <span />
    </li>)}
  </ul>;
}

function SeriesParamsBody() {
  const electrical = WORKSPACE.electrical.filter(row => row.status === 'available');
  const short = WORKSPACE.short_circuit.filter(row => row.status === 'available');
  const value = (id: string) => WORKSPACE.short_circuit.find(row => row.id === id)?.value ?? null;
  const kA = (id: string) => { const amps = value(id); return amps === null ? null : amps / 1000; };
  const adiabatic = kA('core/1:conductor-adiabatic');
  const factor = value('core/1:conductor-factor');
  const conditions = WORKSPACE.short_circuit_conditions;
  return <SeriesShell page="params" version={WORKSPACE.version.number}
    primary={<Button><Icon name="object/file" data-icon="inline-start" />规格书</Button>}>
    <Split panes={[
      { id: 'electrical', size: 56, min: 40, children: <Panel title="每芯电气参数" tools={<Badge variant="outline">{methodLabel(WORKSPACE.electrical_method.plugin_id, WORKSPACE.electrical_method.plugin_version)}</Badge>}>
          <DataTable rows={electrical} rowKey={row => row.id} columns={QUANTITY_COLUMNS} />
          <Disclosure title={`没有给出的 ${WORKSPACE.electrical.length - electrical.length} 项`} defaultOpen>
            <Missing rows={WORKSPACE.electrical.filter(row => row.status !== 'available')} />
          </Disclosure>
        </Panel> },
      { id: 'short', size: 44, min: 32, children: <Panel title="短路电流" tools={<Badge variant="outline">{methodLabel(WORKSPACE.short_circuit_method.plugin_id, WORKSPACE.short_circuit_method.plugin_version)}</Badge>}>
          <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
            <Metric label="导体非绝热允许短路电流" value={fixed(kA('core/1:conductor-nonadiabatic'), 2)} unit="kA"
              detail={adiabatic !== null && factor !== null ? `绝热 ${fixed(adiabatic, 2)} kA × 修正因数 ${fixed(factor, 4)}` : undefined} />
          </div>
          <dl className="m-0 flex flex-col gap-2 border-b border-line px-4 py-4 text-sm">
            {Object.entries(conditions.sources).map(([key, text]) => <div key={key} className="grid grid-cols-label gap-x-4">
              <dt className="text-ink-2">{{ duration_s: '持续时间', initial_temperature_k: '起始温度', final_temperature_k: '允许终温' }[key]}</dt>
              <dd className="m-0 text-ink">{text}</dd>
            </div>)}
          </dl>
          <Disclosure title={`金属屏蔽与铠装没有给出的 ${WORKSPACE.short_circuit.length - short.length} 项`}>
            <Missing rows={WORKSPACE.short_circuit.filter(row => row.status !== 'available')} />
          </Disclosure>
        </Panel> },
    ]} />
  </SeriesShell>;
}

// ---- 载流量表: the table kept on a version, conditions down, layings across ----

function SeriesRatingBody() {
  const layouts = [...new Set(RATING_TABLE.rows.map(row => row.layout))];
  const soils = [...new Set(RATING_TABLE.rows.map(row => row.soil))];
  const cell = (layout: string, soil: number) => RATING_TABLE.rows.find(row => row.layout === layout && row.soil === soil);
  const basis = (layout: string) => RATING_TABLE.rows.find(row => row.layout === layout)?.basis;
  const shared = (key: 'depth' | 'ambient') => [...new Set(RATING_TABLE.rows.map(row => row[key]))].join('、');
  return <SeriesShell page="rating" version={RATING_TABLE.version} primary={<Button><Icon name="module/rating-table" data-icon="inline-start" />新算一张</Button>}>
    <PremiseStrip asked="允许持续载流量">
      <Given label="埋深" value={`${shared('depth')} m`} />
      <Given label="环境" value={`${shared('ambient')} °C`} />
      <Given label="敷设" value={`${layouts.length} 种`} />
      <Given label="土壤热阻率" value={`${soils.length} 档`} />
    </PremiseStrip>
    <div className="flex min-h-0 flex-1">
      <Panel title="载流量表" tools={<><span className="mr-2 text-sm text-ink-2 tabular-nums">算于 {when(RATING_TABLE.created)}</span><Button variant="ghost" size="sm"><Icon name="action/export" data-icon="inline-start" />导出 CSV</Button></>}>
        <DataTable rows={soils} rowKey={soil => String(soil)} columns={[
          { key: 'soil', header: '土壤热阻率', unit: 'K·m/W', numeric: true, width: 'w-36', cell: soil => fixed(soil, 1) },
          ...layouts.map(layout => ({ key: layout, header: basis(layout) ? `${layout}（${basis(layout)}）` : layout, unit: 'A', numeric: true, width: 'w-64',
            cell: (soil: number) => { const row = cell(layout, soil); return row ? fixed(row.ampacity, 1) : '—'; } })),
        ]} />
      </Panel>
      <Panel title="可信分档" tools={<TierMark tier={RATING_TABLE.tierKey as Tier} />} className="w-80 flex-none border-l border-line" bodyClassName="flex flex-col gap-4 px-4 py-4 text-sm">
        <p className="m-0 text-ink">{RATING_TABLE.tierMeaning}</p>
        {RATING_TABLE.tierBasis.map(text => <p key={text} className="m-0 text-ink-2">{text}</p>)}
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <span className="text-ink-2">方法</span>
          <span className="text-ink">{methodText(RATING_TABLE.method)}</span>
          <span className="text-ink-2">{RATING_TABLE.warning}</span>
        </div>
      </Panel>
    </div>
  </SeriesShell>;
}

// ---- 版本与文件: the versions, where the selected one stands in review, and its files ----

type Version = (typeof VERSIONS)[number];
const VERSION_COLUMNS: Column<Version>[] = [
  { key: 'number', header: '版本', width: 'w-20', cell: version => <span className="font-medium">第 {version.number} 版</span> },
  { key: 'review', header: '审核', width: 'w-24', cell: version => <ReviewMark state={version.review as Review} /> },
  { key: 'note', header: '说明', cell: version => <span className="whitespace-normal">{version.note}</span> },
  { key: 'check', header: '标准核对', width: 'w-32', cell: version => <VerdictBar counts={version.check} /> },
  { key: 'created', header: '建于', width: 'w-36', cell: version => <span className="text-ink-2 tabular-nums">{when(version.created)}</span> },
];

function SeriesVersionsBody() {
  const shown = VERSIONS.find(version => version.number === WORKSPACE.version.number)!;
  const stamps = { submitted: shown.submitted, reviewed: shown.reviewed, published: shown.published };
  const files = DOCUMENTS.filter(document => document.version === shown.number);
  return <SeriesShell page="versions" version={WORKSPACE.version.number}>
    <Split panes={[
      { id: 'versions', size: 60, min: 44, children: <Panel title="版本">
          <DataTable rows={VERSIONS} rowKey={version => String(version.number)} selected={String(shown.number)} onSelect={() => undefined} columns={VERSION_COLUMNS} />
        </Panel> },
      { id: 'version', size: 40, min: 30, children: <Panel title={`第 ${shown.number} 版`} tools={<ReviewActions state={shown.review as Review} />}
          bodyClassName="flex flex-col gap-6 px-4 py-4">
          <ReviewTrack state={shown.review as Review} created={shown.created} stamps={stamps} when={when} />
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-h3 text-ink">文件</h3>
            {files.length === 0 && <FormNote title="这一版还没有导出文件">
              <div><Button variant="outline" size="sm"><Icon name="object/file" data-icon="inline-start" />导出规格书</Button></div>
            </FormNote>}
            {files.map(document => <Item key={`${document.title}/${document.created}`} variant="outline">
              <ItemMedia variant="tile"><Icon name="object/file" /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full truncate">{document.title}</ItemTitle>
                <ItemDescription className="flex min-w-0 items-center gap-2"><ReviewMark state={document.review as Review} /><span className="truncate">规格书 · PDF · {when(document.created)}</span></ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="ghost" size="icon-sm" aria-label="下载规格书"><Icon name="action/export" /></Button>
              </ItemActions>
            </Item>)}
          </section>
        </Panel> },
    ]} />
  </SeriesShell>;
}

export const ImportScreen = ImportBody;
export const TypeNewManual = TypeNewManualBody;
export const TypeNewStandard = TypeNewStandardBody;
export const SeriesParams = SeriesParamsBody;
export const SeriesRating = SeriesRatingBody;
export const SeriesVersions = SeriesVersionsBody;
