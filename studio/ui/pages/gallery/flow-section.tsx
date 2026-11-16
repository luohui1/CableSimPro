// The gallery section of round two's parts: forms, stepped tasks, where a value came from, the run records of a project, a
// version's review, the side editor and the charts of results, each in its states. Data as in the screens.
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { CurveChart, TargetBar } from '@/kit/workbench/chart';
import { Stepper } from '@/kit/workbench/flow';
import { ChoiceCards, ChoiceSelect, ConnectionCheck, DropZone, FormNote, FormRow, ReadonlyValue, Segmented, SourceTag, UnitInput } from '@/kit/workbench/form';
import { Metric, MetricGroup } from '@/kit/metric';
import { PageTabs } from '@/kit/workbench/page';
import { ReviewActions, ReviewTrack, VersionSelect, type ReviewStamp } from '@/kit/workbench/review';
import { RunRail } from '@/kit/workbench/runs';
import { SideEditor, SideEditorSection } from '@/kit/workbench/side-editor';
import type { Review } from '@/kit/marks';
import { BONDING_NAMES, fixed } from '@shared/format';
import { DEFAULTS, IMPORT, LAYOUTS, PROPOSAL, RUNS, SELECTION, SWEEP, VERSIONS } from './host-records';
import { MODEL, REFUSED_IMPORT } from './samples';
import { Specimen, State } from './sections';
import { when } from './type-screens';

const FIRST = VERSIONS.find(version => version.number === 1)!;
const THIRD = VERSIONS.find(version => version.number === 3)!;
// Each state as a version really passed through it: version 3 submitted by one person and approved by another, version 1
// published.
const REVIEW_STATES: { state: Review; label: string; created: string; stamps: Partial<Record<'submitted' | 'reviewed' | 'published', ReviewStamp>> }[] = [
  { state: 'draft', label: '草稿', created: THIRD.created, stamps: {} },
  { state: 'submitted', label: '待审核', created: THIRD.created, stamps: { submitted: THIRD.submitted! } },
  { state: 'reviewed', label: '已审核', created: THIRD.created, stamps: { submitted: THIRD.submitted!, reviewed: THIRD.reviewed! } },
  { state: 'published', label: '已发布', created: FIRST.created, stamps: { submitted: FIRST.submitted!, reviewed: FIRST.reviewed!, published: FIRST.published! } },
];
const dimension = (field: string) => PROPOSAL.complete.dimensions.find(item => item.field === field)!;
const { installation, conditions } = DEFAULTS;

export function FlowSection() {
  return <>
    <Specimen title="表单行与带单位的数" rule="左边名称，右边控件；单位在框内右侧成列，数值右对齐用等宽数字。改过还没重算的带一个点，需要时在下面一行说明。">
      <State label="普通" className="w-96"><FormRow label="埋深" htmlFor="specimen-depth"><UnitInput id="specimen-depth" unit="m" defaultValue={installation.depth_m} /></FormRow></State>
      <State label="改过" className="w-96"><FormRow label="土壤热阻率" htmlFor="specimen-soil" changed hint={`运行记录 #1 用的是 ${conditions.soil_thermal_resistivity} K·m/W`}><UnitInput id="specimen-soil" unit="K·m/W" defaultValue="1.5" /></FormRow></State>
      <State label="一行几个" className="w-96"><FormRow label="电压"><div className="grid grid-cols-2 gap-2"><UnitInput aria-label="U₀" prefix="U₀" unit="kV" defaultValue="8.7" /><UnitInput aria-label="U" prefix="U" unit="kV" defaultValue="15" /></div></FormRow></State>
      <State label="出错" className="w-96"><FormRow label="埋深" htmlFor="specimen-bad"><UnitInput id="specimen-bad" unit="m" defaultValue="-1" aria-invalid /></FormRow></State>
    </Specimen>
    <Specimen title="只读值与连通检查" rule="来自环境变量的值只显示、不在页面上改，放在浅底框里；密钥只说有没有。连通检查说状态和时间，连不上时给宿主的原话（宿主还没有检查连通的操作，接上之前按钮不可用）。">
      <State label="有值" className="w-72"><ReadonlyValue>{MODEL}</ReadonlyValue></State>
      <State label="没有值" className="w-72"><ReadonlyValue empty /></State>
      <State label="还没检查"><ConnectionCheck state="idle" /></State>
      <State label="正在检查"><ConnectionCheck state="checking" /></State>
      <State label="连通"><ConnectionCheck state="ok" /></State>
      <State label="还不能检查"><ConnectionCheck state="idle" disabled /></State>
    </Specimen>
    <Specimen title="选择" rule="几种互斥的做法用卡片，选中是铜色边和浅底；固定清单里的一项用下拉。" wide>
      <State label="卡片" className="w-full"><ChoiceCards label="敷设方式" columns="grid-cols-3" value={installation.layout} options={LAYOUTS.slice(0, 3).map(layout => ({
        value: layout.kind, title: layout.label, icon: layout.ducted ? 'tool/duct-bank' : 'tool/place-cable', detail: `${layout.circuits} 个回路${layout.ducted ? ' · 排管' : ''}`,
      }))} /></State>
      <State label="下拉" className="w-72"><ChoiceSelect label="护套接地" value={installation.bonding} options={Object.entries(BONDING_NAMES).map(([value, label]) => ({ value, label }))} /></State>
      <State label="分段"><Segmented label="芯数" value={String(PROPOSAL.inputs.cores)} options={[{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }]} /></State>
    </Specimen>
    <Specimen title="出处" rule="每个值从哪来：标准（条款与页码）、推算（按哪条算出）、给定、厂家表、人工填写。一个图标一个词，位置跟在后面。">
      <State label="标准"><SourceTag kind="standard" place={`${dimension('insulation_thickness').clause} · PDF 第 ${dimension('insulation_thickness').pdf_page} 页`} /></State>
      <State label="推算"><SourceTag kind="derived" place={`${dimension('oversheath_thickness').clause} · PDF 第 ${dimension('oversheath_thickness').pdf_page} 页`} /></State>
      <State label="给定"><SourceTag kind="given" /></State>
      <State label="厂家表"><SourceTag kind="table" place={IMPORT.sheet} /></State>
      <State label="人工填写"><SourceTag kind="manual" /></State>
    </Specimen>
    <Specimen title="说明块" rule="动手前要知道的事，放在内容流里，正文字号：跳过的行、提案不说明什么。只有会出错的事用提醒色。" wide>
      <State label="说明" className="w-full max-w-prose"><FormNote title={`第 ${IMPORT.skipped[0].row} 行不导入`}>{IMPORT.skipped[0].text}</FormNote></State>
      <State label="提醒" className="w-full max-w-prose"><FormNote tone="attention" title={REFUSED_IMPORT.title}>{REFUSED_IMPORT.reason}</FormNote></State>
    </Specimen>
    <Specimen title="指标组" rule="几个一起读的数放进一个框：数用等宽数字，单位跟在后面。" wide>
      <State label="导入预览" className="w-full max-w-prose"><MetricGroup>
        <Metric size="md" label="可导入" value={IMPORT.ready} unit="行" />
        <Metric size="md" label="不能导入" value={IMPORT.failed} unit="行" />
        <Metric size="md" label="不是数据，跳过" value={IMPORT.skipped.length} unit="行" />
      </MetricGroup></State>
    </Specimen>
    <Specimen title="拖放区" rule="说清收什么文件，给不拖的人一个按钮。文件拖到上面时变铜色。">
      <State label="等文件" className="w-96"><DropZone title="把结构表拖到这里" formats="支持 .xlsx、.xls 和 .csv 的结构表" /></State>
      <State label="文件在上面" className="w-96"><DropZone title="松开就上传" formats="支持 .xlsx、.xls 和 .csv 的结构表" dragging /></State>
    </Specimen>
    <Specimen title="分步" rule="一屏分步的任务：步骤在左边一列，做完的写下定了什么；当前步铜色；出错的步骤说出错在哪。">
      <State label="进行中" className="w-64"><Stepper label="导入步骤" steps={[
        { title: '上传文件', status: 'done', detail: IMPORT.file }, { title: '选工作表', status: 'done', detail: IMPORT.sheet },
        { title: '列对应', status: 'current' }, { title: '预览', status: 'upcoming' }, { title: '导入', status: 'upcoming' },
      ]} /></State>
      <State label="出错" className="w-64"><Stepper label="导入步骤" steps={[
        { title: '上传文件', status: 'done', detail: IMPORT.file }, { title: '选工作表', status: 'done', detail: IMPORT.sheet },
        { title: '列对应', status: 'done', detail: `${IMPORT.columns.filter(column => column.field).length} 列对上字段` },
        { title: '预览', status: 'error', detail: REFUSED_IMPORT.reason.split('。').filter(Boolean).pop() }, { title: '导入', status: 'upcoming' },
      ]} /></State>
    </Specimen>
    <Specimen title="页签" rule="同一个对象的几页（结构与核对、参数、载流量表、版本与文件）：平字加下划线，条数跟在后面。" wide>
      <State label="型号工作区" className="w-full"><div className="rounded-card border border-line bg-surface">
        <PageTabs value="versions" items={[{ value: 'structure', label: '结构与核对' }, { value: 'params', label: '参数' }, { value: 'rating', label: '载流量表' }, { value: 'versions', label: '版本与文件', count: VERSIONS.length }]} />
      </div></State>
    </Specimen>
    <Specimen title="运行记录" rule="一个工程的运行记录排成一行，旧的在前，新的接在后面；多了横向滚动。选中的是浅底描边；Agent 算的带 Agent 色的点，输入改过之后的带提醒点并在悬停时说明。" wide>
      <State label="人算的三条" className="w-full"><div className="rounded-card border border-line bg-surface"><RunRail runs={RUNS} active={RUNS[2].id} /></div></State>
      <State label="Agent 算的" className="w-full"><div className="rounded-card border border-line bg-surface"><RunRail runs={[{ id: 'run-agent', sequence: 1, title: '校核 · 458.7 A', by: 'agent' }]} active="run-agent" /></div></State>
    </Specimen>
    <Specimen title="版本与审核" rule="审核是人的事：草稿提交审核，待审核可退回或通过，已审核可退回或发布，已发布不再改、改就出新版本。每个到过的状态记下谁、何时、说了什么。" wide>
      <State label="版本切换"><VersionSelect value={3} versions={VERSIONS.map(version => ({ number: version.number, review: version.review as Review }))} /></State>
      <div className="grid w-full grid-cols-4 gap-6">
        {REVIEW_STATES.map(item => <State key={item.state} label={item.label}>
          <div className="flex flex-col gap-4">
            <ReviewTrack state={item.state} created={item.created} stamps={item.stamps} when={when} />
            <ReviewActions state={item.state} />
          </div>
        </State>)}
      </div>
    </Specimen>
    <Specimen title="侧栏编辑" rule="改一屏所示的东西时从右边停靠出来，占结论面板的位置，画面留在原处；底部是唯一的应用动作和改了几项。">
      <State label="改已知条件" className="h-96 w-96"><div className="flex h-full overflow-hidden rounded-card border border-line">
        <SideEditor title="已知条件" className="w-full border-l-0" footer={<Button size="sm"><Icon name="run/run" data-icon="inline-start" />按新条件计算</Button>}>
          <SideEditorSection title="环境">
            <FormRow label="土壤热阻率" changed><UnitInput aria-label="土壤热阻率" unit="K·m/W" defaultValue="1.5" /></FormRow>
            <FormRow label="环境温度"><UnitInput aria-label="环境温度" unit="°C" defaultValue={conditions.ambient_temperature_c} /></FormRow>
          </SideEditorSection>
        </SideEditor>
      </div></State>
    </Specimen>
    <Specimen title="结果图" rule="一个结果随一个条件变化：墨色曲线，工程取值是铜色竖线和点，比较的水平（负荷、限值）是提醒色虚线。表格里的比例条：选中铜色、满足墨色、不足浅灰，竖线是目标。" wide>
      <State label="曲线" className="w-full max-w-prose"><CurveChart className="h-64" data={SWEEP.points} x={{ key: 'value', label: SWEEP.label, unit: SWEEP.unit, format: value => fixed(value, 1) }}
        y={{ key: 'ampacity', label: '允许电流', unit: 'A', format: value => fixed(value, 1) }} at={{ value: conditions.soil_thermal_resistivity, label: `工程取值 ${conditions.soil_thermal_resistivity}` }} limit={{ value: SWEEP.load, label: `保存负荷 ${SWEEP.load} A` }} /></State>
      <State label="比例条" className="w-64"><div className="flex flex-col gap-3">
        {SELECTION.candidates.filter(candidate => ['s-89150e51.3x185', 's-89150e51.3x240', 's-89150e51.3x300'].includes(candidate.id)).map(candidate => <div key={candidate.id} className="flex items-center gap-3 text-sm">
          <span className="w-16 shrink-0 text-ink">{candidate.name.split(' ').pop()}</span>
          <TargetBar value={candidate.ampacity} target={SELECTION.target} max={Math.max(SELECTION.target, ...SELECTION.candidates.map(item => item.ampacity ?? 0))} tone={candidate.id === SELECTION.chosen ? 'chosen' : candidate.meets ? 'meets' : 'short'} />
        </div>)}
      </div></State>
    </Specimen>
  </>;
}
