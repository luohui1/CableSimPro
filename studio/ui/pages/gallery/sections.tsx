// The gallery's sections: the theme, the base controls, and every kit part in each of its states, with real data.
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CardAction, CardLoading, CheckCard, FileCard, ModelCard, OpenInWorkbench, ProposalCard, RatingCard, RefusalCard, type ProposalPhase } from '@/kit/chat/cards';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerInput, ComposerSend, ComposerStop, FileChip } from '@/kit/chat/composer';
import { ChatNotice, TaskStarter } from '@/kit/chat/empty';
import { AssistantMessage, Prose, Typing, UserMessage } from '@/kit/chat/messages';
import { ChatGroup, ChatItem, ChatListEmpty, ChatSearch, ChatSidebar, NewChatButton } from '@/kit/chat/sidebar';
import { StepTrace } from '@/kit/chat/steps';
import { ModeSwitch, ModelBadge, ThemeToggle } from '@/kit/frame';
import { Icon } from '@/kit/icon';
import { Dot, ReviewMark, TierMark, VerdictMark } from '@/kit/marks';
import { LimitMeter, Metric } from '@/kit/metric';
import { PropertyGroup, PropertyList } from '@/kit/properties';
import { CanvasLayer, CanvasTool, CanvasToolbar, CanvasToolbarSeparator, TemperatureLegend } from '@/kit/workbench/canvas';
import { DataTable } from '@/kit/workbench/data-table';
import { NavItem, NavSection, WorkbenchNav } from '@/kit/workbench/nav';
import { PageHeader } from '@/kit/workbench/page';
import { EmptyState, Given, PremiseStrip } from '@/kit/workbench/premise';
import { compact, fixed } from '@shared/format';
import { useTheme } from '@/state/theme';
import { CableSection, SectionThumb, fieldStops } from './figures';
import { LIBRARY, WORKSPACE } from './library-data';
import {
  CHATS, CHECK_V1, CHECK_V2, EXPORT_STEPS, HOST_DOWN, MODEL, MODEL_FACTS, MODEL_REFUSAL, MODEL_STEPS_RUNNING, NEW_PROJECT, RATING, RATING_ASK,
  RATING_STEPS, REFUSED_IMPORT, REFUSED_RATING, SHEET, STARTERS, STEPS_FAILED, STEPS_RECOVERED, STEPS_STOPPED, STEPS_WAITING, THINNER,
  SHORT_CIRCUIT, THINNER_FAILURES, THINNER_NOTE, UNCHECKED,
} from './samples';

/** One part: its name, the rule it follows, and its states side by side, each named. */
export function Specimen({ title, rule, children, wide }: { title: string; rule: string; children: ReactNode; wide?: boolean }) {
  return <section className="flex flex-col gap-4 border-t border-line pt-6">
    <header className="flex flex-col gap-1">
      <h3 className="m-0 text-h2 text-ink">{title}</h3>
      <p className="m-0 text-sm text-ink-2">{rule}</p>
    </header>
    <div className={wide ? 'flex flex-col gap-6' : 'flex flex-wrap items-start gap-6'}>{children}</div>
  </section>;
}

export function State({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <figure className={`m-0 flex min-w-0 flex-col gap-2 ${className ?? ''}`}>
    <figcaption className="text-xs font-medium text-ink-2">{label}</figcaption>
    {children}
  </figure>;
}

export function SectionTitle({ id, title, lead }: { id: string; title: string; lead: string }) {
  return <header id={id} className="flex scroll-mt-6 flex-col gap-2 pt-4">
    <h2 className="m-0 text-h1 text-ink">{title}</h2>
    <p className="m-0 max-w-prose text-prose text-ink-2">{lead}</p>
  </header>;
}

// ---- 主题 ----

const SWATCHES = [
  { name: '底 ground', token: 'bg-canvas' }, { name: '面 surface', token: 'bg-surface' }, { name: '浅底 subtle', token: 'bg-subtle' },
  { name: '悬停 hover', token: 'bg-hover' }, { name: '分隔线 line', token: 'bg-line' }, { name: '控件边 line-strong', token: 'bg-line-strong' },
  { name: '正文 ink', token: 'bg-ink' }, { name: '次要 ink-2', token: 'bg-ink-2' }, { name: '最弱 ink-3', token: 'bg-ink-3' },
  { name: '铜 copper', token: 'bg-copper' }, { name: '选中 copper-fill', token: 'bg-copper-fill' }, { name: 'Agent', token: 'bg-agent' },
  { name: '通过 success', token: 'bg-success' }, { name: '注意 attention', token: 'bg-attention' }, { name: '不通过 error', token: 'bg-error' },
];

const TYPE = [
  { name: 'display 28/36', className: 'text-display', sample: '今天要处理哪款电缆？' },
  { name: 'h1 20/28', className: 'text-h1', sample: 'YJV22-8.7/15 kV 3×240' },
  { name: 'h2 16/24', className: 'text-h2', sample: '保存负荷下的温度' },
  { name: 'h3 14/22', className: 'text-h3', sample: '先到温限' },
  { name: 'prose 15/26', className: 'text-prose', sample: '允许电流 458.7 A；保存负荷 300 A 时导体 49.7 °C。' },
  { name: 'ui 14/22', className: 'text-ui', sample: '绝缘标称厚度 4.5 mm' },
  { name: 'caption 13/20', className: 'text-caption', sample: '今天 · 状态栏 · 分组名' },
  { name: 'metric 32/36', className: 'text-metric tabular-nums', sample: '458.7' },
];

export function ThemeSection() {
  return <>
    <Specimen title="颜色" rule="中性色分层：底、面、浅底、分隔线。铜色只给主按钮、选中和焦点；三种结论色总配图标。">
      <div className="grid w-full grid-cols-5 gap-3">
        {SWATCHES.map(swatch => <div key={swatch.name} className="flex flex-col gap-2">
          <span className={`h-12 rounded-lg border border-line ${swatch.token}`} />
          <span className="text-xs text-ink-2">{swatch.name}</span>
        </div>)}
      </div>
    </Specimen>
    <Specimen title="字号" rule="界面 14 px，对话正文 15 px，标题三级，任何文字不小于 13 px；数字用等宽数字。次要文字对白底 6.6:1。" wide>
      <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {TYPE.map(row => <div key={row.name} className="grid grid-cols-label items-baseline gap-4 px-4 py-3">
          <span className="text-xs text-ink-2">{row.name}</span>
          <span className={`${row.className} text-ink`}>{row.sample}</span>
        </div>)}
      </div>
    </Specimen>
    <Specimen title="圆角、阴影与间距" rule="字段 8、列表项 10、卡片 12、面板 16、输入框 24，按钮与标签是胶囊。只有浮起来的东西有阴影。间距是 4 的倍数。">
      <State label="卡片 12"><div className="h-16 w-32 rounded-card border border-line bg-surface" /></State>
      <State label="输入框 24 + 阴影"><div className="h-16 w-40 rounded-composer border border-line-strong bg-surface shadow-composer" /></State>
      <State label="菜单 12 + 阴影"><div className="h-16 w-32 rounded-xl border border-line bg-surface shadow-menu" /></State>
      <State label="间距 4 · 8 · 12 · 16 · 24 · 32">
        <div className="flex items-end gap-2">{['size-1', 'size-2', 'size-3', 'size-4', 'size-6', 'size-8'].map(size => <span key={size} className={`${size} rounded-xs bg-ink-2`} />)}</div>
      </State>
    </Specimen>
  </>;
}

// ---- 基础控件 ----

export function ControlsSection() {
  return <>
    <Specimen title="按钮" rule="胶囊形。铜色是一屏唯一的主按钮；墨色给发送这类强动作；其余是描边和无底。">
      <State label="主按钮"><Button><Icon name="run/run" data-icon="inline-start" />运行校核</Button></State>
      <State label="墨色"><Button variant="ink">发送</Button></State>
      <State label="描边"><Button variant="outline"><Icon name="object/file" data-icon="inline-start" />规格书</Button></State>
      <State label="浅底"><Button variant="secondary">次要</Button></State>
      <State label="无底"><Button variant="ghost">取消</Button></State>
      <State label="危险"><Button variant="destructive">删除草稿</Button></State>
      <State label="紧凑 32"><Button size="sm" variant="outline">计算书</Button></State>
      <State label="不可用"><Button disabled>运行校核</Button></State>
      <State label="图标"><Button variant="ghost" size="icon-sm" aria-label="更多"><Icon name="action/more" /></Button></State>
      <State label="链接（按钮的样子）"><ButtonLink variant="outline" href="#controls"><Icon name="action/export" data-icon="inline-start" />下载 PDF</ButtonLink></State>
    </Specimen>
    <Specimen title="标记" rule="一个事实一个词加图标：可信分档、审核状态、核对结论。颜色不单独表达意思。">
      <State label="可信分档"><div className="flex gap-2"><TierMark tier="deliverable" /><TierMark tier="reference" /><TierMark tier="exploratory" /></div></State>
      <State label="审核状态"><div className="flex gap-2"><ReviewMark state="draft" /><ReviewMark state="submitted" /><ReviewMark state="reviewed" /><ReviewMark state="published" /></div></State>
      <State label="核对结论"><div className="flex gap-4"><VerdictMark verdict="passed" count={13} /><VerdictMark verdict="failed" count={3} /><VerdictMark verdict="missing" count={21} /><VerdictMark verdict="uncovered" count={4} /></div></State>
      <State label="状态点"><div className="flex items-center gap-3"><Dot tone="success" /><Dot tone="attention" /><Dot tone="error" /><Dot tone="agent" pulse /></div></State>
    </Specimen>
    <Specimen title="字段" rule="36 px 高，8 px 圆角；聚焦时边线加深并有铜色焦点环；出错时边线变成不通过色。">
      <State label="空"><Input placeholder="搜索型号" className="w-56" /></State>
      <State label="有值"><Input defaultValue="4.5" className="w-56" /></State>
      <State label="出错"><Input defaultValue="-1" aria-invalid className="w-56" /></State>
      <State label="不可用"><Input defaultValue="0.0754" disabled className="w-56" /></State>
      <State label="带图标"><InputGroup className="w-64"><InputGroupAddon><Icon name="action/search" /></InputGroupAddon><InputGroupInput placeholder="搜索型号、规格或制造商" /></InputGroup></State>
      <State label="下拉（与字段同高）"><Select value="both_ends" items={[{ value: 'both_ends', label: '两端接地' }, { value: 'single_point', label: '单点接地' }]}>
        <SelectTrigger className="w-56" aria-label="护套接地"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="both_ends">两端接地</SelectItem><SelectItem value="single_point">单点接地</SelectItem></SelectContent>
      </Select></State>
    </Specimen>
    <Specimen title="勾选与进度" rule="勾选是 16 px 方框，选中是铜色；点击范围包括旁边的字。进度条 8 px，墨色，名称和计数在上面。">
      <State label="未勾"><label className="flex items-center gap-2 text-sm text-ink"><Checkbox />只导入可用的行</label></State>
      <State label="已勾"><label className="flex items-center gap-2 text-sm text-ink"><Checkbox defaultChecked />只导入可用的行</label></State>
      <State label="不可用"><label className="flex items-center gap-2 text-sm text-ink-2"><Checkbox disabled />只导入可用的行</label></State>
      <State label="进行中，还没有计数" className="w-72"><Progress value={null}><ProgressLabel>计算全系列</ProgressLabel></Progress></State>
      <State label="完成" className="w-72"><Progress value={LIBRARY[0].specs.length} max={LIBRARY[0].specs.length}>
        <ProgressLabel>计算全系列</ProgressLabel><ProgressValue>{() => `${LIBRARY[0].specs.length} / ${LIBRARY[0].specs.length} 个规格`}</ProgressValue>
      </Progress></State>
    </Specimen>
    <Specimen title="页签与分段" rule="分段是凹槽加白片（同一视图的几种状态）；页签是平字加下划线（同一位置的不同内容）。">
      <State label="分段"><ToggleGroup defaultValue={['overview']} className="rounded-lg border border-line bg-surface p-1"><ToggleGroupItem value="cluster">电缆簇</ToggleGroupItem><ToggleGroupItem value="overview">全景</ToggleGroupItem></ToggleGroup></State>
      <State label="页签">
        <Tabs defaultValue="check" className="w-72">
          <TabsList variant="line"><TabsTrigger value="params">参数</TabsTrigger><TabsTrigger value="check">标准核对</TabsTrigger><TabsTrigger value="versions">版本</TabsTrigger></TabsList>
          <TabsContent value="check" className="pt-2 text-ink-2">标准核对的内容</TabsContent>
        </Tabs>
      </State>
    </Specimen>
  </>;
}

// ---- Agent 部件 ----

function ProposalStates() {
  const [note, setNote] = useState('');
  const consequence = <>改后按 GB/T 12706.2—2020 核对：<strong className="font-semibold">3 项不通过</strong>（三芯绝缘标称厚度，表 7）</>;
  const states: { label: string; phase: ProposalPhase }[] = [{ label: '等你审阅', phase: 'pending' }, { label: '拒绝时写原因', phase: 'rejecting' }];
  return <>
    {states.map(state => <State key={state.phase} label={state.label} className="w-full max-w-thread">
      <ProposalCard action="修改结构" subject="YJV22-8.7/15 kV 3×240 · 第 1 版" changes={THINNER} phase={state.phase} consequence={consequence}
        note={note} onNoteChange={setNote} />
    </State>)}
    <State label="新对象（没有改前值）" className="w-full max-w-thread">
      <ProposalCard action="新建工程" subject="YJV22-8.7/15 3×240 直埋载流量校核" changes={NEW_PROJECT} phase="pending" />
    </State>
    <State label="已接受（收成一行，点开看改了什么）" className="w-full max-w-thread">
      <ProposalCard action="修改结构" subject="YJV22-8.7/15 kV 3×240 · 第 1 版 → 第 2 版" changes={THINNER} phase="accepted" />
    </State>
    <State label="已拒绝" className="w-full max-w-thread">
      <ProposalCard action="修改结构" subject="YJV22-8.7/15 kV 3×240 · 第 1 版" changes={THINNER} phase="rejected" note="按客户原要求保留 4.5 mm" />
    </State>
  </>;
}

export function AgentSection() {
  const { theme, toggle } = useTheme();
  return <>
    <Specimen title="顶栏" rule="品牌、模式切换在同一位置；右边是 Agent 用的模型和深浅色切换。">
      <State label="模式切换"><ModeSwitch value="agent" /></State>
      <State label="模型已配置"><ModelBadge name={MODEL} /></State>
      <State label="模型未配置"><ModelBadge name={null} /></State>
      <State label="深浅色"><ThemeToggle theme={theme} onToggle={toggle} /></State>
    </Specimen>
    <Specimen title="会话侧栏" rule="新对话、搜索，会话按时间分组。打开的会话是选中色；正在干活的会话有转圈；长标题在行尾淡出，悬停看全名。">
      <State label="有对话"><div className="h-96 w-64 rounded-card border border-line bg-canvas pt-3">
        <ChatSidebar header={<><NewChatButton /><ChatSearch /></>}>
          <ChatGroup label="今天">
            {CHATS.slice(0, 5).map((chat, index) => <ChatItem key={chat.id} title={chat.title} active={index === 3} running={index === 0} />)}
          </ChatGroup>
        </ChatSidebar>
      </div></State>
      <State label="还没有对话"><div className="h-96 w-64 rounded-card border border-line bg-canvas pt-3">
        <ChatSidebar header={<><NewChatButton /><ChatSearch disabled /></>}><ChatListEmpty /></ChatSidebar>
      </div></State>
    </Specimen>
    <Specimen title="现成任务" rule="一个任务一行：图标、要做什么、交回什么。点一下就发出。">
      <div className="grid w-full max-w-thread grid-cols-2 gap-2">
        {[...STARTERS.types.slice(0, 2), ...STARTERS.rating.slice(0, 2)].map(task => <TaskStarter key={task.title} icon={task.icon} title={task.title} result={task.result} />)}
      </div>
    </Specimen>
    <Specimen title="消息" rule="人的话在右边灰色气泡里；Agent 的话不加气泡，15 px，交代不超过五行，数只来自工具结果。" wide>
      <div className="flex max-w-thread flex-col gap-6">
        <UserMessage>{RATING_ASK}</UserMessage>
        <UserMessage attachments={<FileChip name="人民电缆 8.7-15kV 结构表（公开手册）.xlsx" detail="4 张工作表" />}>导入这张结构表，算参数并按国标核对。</UserMessage>
        <State label="正在回答"><AssistantMessage><StepTrace steps={MODEL_STEPS_RUNNING} /><Typing /></AssistantMessage></State>
        <AssistantMessage>
          <Prose>
            <p>已选 <strong>YJV22-8.7/15 kV 3×240</strong>，按三芯直埋单回、埋深 1.2 m 算了一条运行记录。</p>
            <ul><li>允许电流 <strong>458.7 A</strong>，先到温限的是这根三芯电缆本身。</li><li>可信分档为<strong>参考</strong>，交付前请另行核对。</li></ul>
          </Prose>
        </AssistantMessage>
      </div>
    </Specimen>
    <Specimen title="步骤" rule="一次任务的步骤收成一行，默认收起；点开是时间线，每步可再点开看要点。失败的原因总是露在外面。" wide>
      <div className="grid max-w-thread grid-cols-2 gap-6">
        <State label="做完（收起）"><StepTrace steps={RATING_STEPS} /></State>
        <State label="进行中"><StepTrace steps={MODEL_STEPS_RUNNING} /></State>
        <State label="等你审阅"><StepTrace steps={STEPS_WAITING} /></State>
        <State label="失败"><StepTrace steps={STEPS_FAILED} /></State>
        <State label="中途有一步没成，任务继续"><StepTrace steps={STEPS_RECOVERED} /></State>
        <State label="已中止"><StepTrace steps={STEPS_STOPPED} /></State>
      </div>
      <State label="做完（展开）" className="max-w-thread"><StepTrace steps={EXPORT_STEPS} defaultOpen /></State>
    </Specimen>
    <Specimen title="载流量结果卡" rule="主数字是允许电流；旁边是先到温限的电缆和它的导体温度离限值多远；右上是可信分档。" wide>
      <State label="有结果" className="max-w-thread"><RatingCard {...RATING} figure={<SectionThumb />} actions={<><CardAction icon="result/report">计算书</CardAction><OpenInWorkbench /></>} /></State>
      <State label="读取中（卡片取数时）" className="max-w-thread"><CardLoading icon="calc/ampacity" title="YJV22-8.7/15 kV 3×240 · 三芯直埋" height="h-40" /></State>
    </Specimen>
    <Specimen title="标准核对结果卡" rule="通过、不通过、缺项三个数；不通过的项逐条列出，同一要求的三芯合成一条，写明条款。" wide>
      <State label="有不通过（第 2 版，绝缘减到 4 mm）" className="max-w-thread"><CheckCard title="标准核对 · YJV22-8.7/15 kV 3×240 · 第 2 版" counts={CHECK_V2} failures={THINNER_FAILURES} actions={<OpenInWorkbench />} /></State>
      <State label="没有不通过（第 1 版）" className="max-w-thread"><CheckCard title="标准核对 · YJV22-8.7/15 kV 3×240 · 第 1 版" counts={CHECK_V1} failures={[]} actions={<OpenInWorkbench />} /></State>
      <State label="还有规格没核对" className="max-w-thread"><CheckCard title={UNCHECKED.title} counts={{}} failures={[]} unchecked={UNCHECKED.unchecked} actions={<OpenInWorkbench />} /></State>
    </Specimen>
    <Specimen title="待审卡" rule="改前和改后、带单位；改动会带来的后果写在下面。接受是这屏的主按钮，拒绝可写原因。审完收成一行。" wide>
      <ProposalStates />
    </Specimen>
    <Specimen title="文件卡" rule="规格书、计算书：文件名、种类、审核状态；预览和下载。" wide>
      <div className="flex max-w-thread flex-col gap-3">
        <FileCard {...SHEET} />
        <FileCard title="运行记录 1 · 校核 · 458.7 A" kind="计算书" format="HTML" onOpen={() => undefined} />
      </div>
    </Specimen>
    <Specimen title="三维模型卡" rule="视口放工作台自己的三维视图（CadViewport）；陈列页没有三维网格数据，视口里放同一根电缆的断面示意位置。" wide>
      <div className="grid max-w-thread grid-cols-1 gap-4">
        <State label="已生成"><ModelCard title="三维结构 · YJV22-8.7/15 kV 3×240" state="ready" facts={MODEL_FACTS}
          viewport={<div className="absolute inset-8"><CableSection /></div>} actions={<><CardAction icon="action/import">下载 STEP</CardAction><OpenInWorkbench /></>} /></State>
        <State label="生成中"><ModelCard title="三维结构 · YJV22-8.7/15 kV 3×240" state="loading" /></State>
        <State label="插件拒绝"><ModelCard title="三维结构 · YJV22-8.7/15 kV 3×240" state="failed" error={MODEL_REFUSAL} /></State>
      </div>
    </Specimen>
    <Specimen title="拒算或出错卡" rule="方法或数据说不：原因照方法的原话，缺什么、超出什么、可以怎么做逐条写明。出错是另一回事（服务断了），给重试。" wide>
      <div className="flex max-w-thread flex-col gap-4">
        <RefusalCard kind="refused" title={REFUSED_RATING.title} reason={REFUSED_RATING.reason} missing={REFUSED_RATING.missing} actions={<OpenInWorkbench />} />
        <RefusalCard kind="refused" title={REFUSED_IMPORT.title} reason={REFUSED_IMPORT.reason} missing={REFUSED_IMPORT.missing} actions={<CardAction icon="action/edit">补系列声明</CardAction>} />
        <RefusalCard kind="error" title="运行校核 · YJV22-8.7/15 3×240 直埋载流量校核" reason={HOST_DOWN} actions={<CardAction icon="action/refresh">重试</CardAction>} />
      </div>
    </Specimen>
    <Specimen title="输入框" rule="唯一有阴影的东西。附件在左，发送在右（墨色）；任务进行中出现停止。拖入结构表时边线变铜色虚线。" wide>
      <div className="grid max-w-thread grid-cols-1 gap-4">
        <State label="空"><ComposerFrame><ComposerInput placeholder="交办一件事，或把 Excel、CSV 结构表拖到这里" /><ComposerBar start={<ComposerAttach />} end={<ComposerSend disabled />} /></ComposerFrame></State>
        <State label="带附件"><ComposerFrame>
          <div className="flex flex-wrap gap-2 px-2 pt-1"><FileChip name="人民电缆 8.7-15kV 结构表（公开手册）.xlsx" detail="已上传" onRemove={() => undefined} /><FileChip name="补充结构表.csv" state="uploading" detail="上传中" /></div>
          <ComposerInput defaultValue="导入这张结构表，算参数并按国标核对，列出不通过项。" /><ComposerBar start={<ComposerAttach />} end={<ComposerSend />} />
        </ComposerFrame></State>
        <State label="任务进行中（可插话、可停止）"><ComposerFrame><ComposerInput placeholder="插一句话，Agent 做完这一步就看到" /><ComposerBar start={<ComposerAttach />} end={<><ComposerStop /><ComposerSend disabled /></>} /></ComposerFrame></State>
        <State label="拖入中"><ComposerFrame dragging><ComposerInput placeholder="松开即附上结构表" /><ComposerBar start={<ComposerAttach />} end={<ComposerSend disabled />} /></ComposerFrame></State>
        <State label="模型未配置"><ChatNotice>模型未配置，Agent 暂时不能干活：设置 CABLE_STUDIO_MODEL_BASE_URL、CABLE_STUDIO_MODEL_ID、CABLE_STUDIO_MODEL_API_KEY 后重启。</ChatNotice></State>
      </div>
    </Specimen>
  </>;
}

// ---- 工作台部件 ----

export function WorkbenchSection() {
  const [field, setField] = useState(true);
  return <>
    <Specimen title="工作台导航" rule="两个工作区，各自的入口和最近打开的对象。选中是铜色浅底；长名字可占两行，悬停看全名。">
      <div className="h-80 w-64 rounded-card border border-line bg-canvas pt-3">
        <WorkbenchNav>
          <NavSection icon="nav/cable-type" label="电缆型号">
            <NavItem icon="nav/library" label="型号库" count={10} />
            <NavItem label="人民电缆集团 YJV22-8.7/15 kV 三芯" nested active />
          </NavSection>
          <NavSection icon="calc/ampacity" label="载流量计算">
            <NavItem icon="object/study" label="全部工程" count={2} />
            <NavItem label="YJV22-8.7/15 3×240 直埋载流量校核" nested />
          </NavSection>
        </WorkbenchNav>
      </div>
    </Specimen>
    <Specimen title="页头" rule="标题加唯一的主按钮（下一步）；位置在上一行，标记跟在标题后。" wide>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <PageHeader trail={[{ label: '型号库' }, { label: '人民电缆集团 YJV22-8.7/15 kV 三芯' }]} title="YJV22-8.7/15 kV 3×240"
          marks={<><Badge variant="outline">第 1 版</Badge><ReviewMark state="draft" /></>}
          actions={<Button variant="outline"><Icon name="object/file" data-icon="inline-start" />规格书</Button>}
          primary={<Button><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>} />
      </div>
    </Specimen>
    <Specimen title="数据表" rule="表头固定、行高 36、单位写在表头、数值右对齐用等宽数字、选中行铜色浅底、可分组、可带汇总行。" wide>
      <div className="h-72 overflow-hidden rounded-card border border-line bg-surface">
        <DataTable rowKey={row => row.key} rows={WORKSPACE.structure.slice(0, 8)} selected="insulation_thickness" onSelect={() => undefined}
          sort={{ key: 'value', direction: 'desc' }} onSort={() => undefined}
          columns={[
            { key: 'label', header: '层', width: 'w-48', cell: row => row.label },
            { key: 'value', header: '厚度 / 直径', unit: 'mm', numeric: true, width: 'w-36', cell: row => row.value },
            { key: 'origin', header: '来源', width: 'w-24', cell: row => <span className="text-ink-2">{{ table: '表列', series: '系列', standard: '标准' }[row.origin]}</span> },
          ]}
          footer={{ label: '外径闭合', cells: { value: `${fixed(WORKSPACE.closure.residual_mm, 2)} / ${fixed(WORKSPACE.closure.tolerance_mm, 2)}` } }} />
      </div>
      <State label="空表">
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <DataTable rowKey={(row: { id: string }) => row.id} rows={[]} columns={[{ key: 'id', header: '规格', cell: row => row.id }]}
            empty={<EmptyState icon="action/import" title="这个系列还没有规格" description="导入一张结构表，每一行成为一个规格的第 1 版草稿。" action={<Button>导入结构表</Button>} />} />
        </div>
      </State>
    </Specimen>
    <Specimen title="属性面板" rule="名称、数值、单位三列对齐，一组一个标题；数值等宽右对齐，缺的值是破折号。">
      <div className="w-80 overflow-hidden rounded-card border border-line bg-surface">
        <PropertyGroup title="保存负荷下的温度"><PropertyList rows={[{ label: '导体', value: '49.7', unit: '°C' }, { label: '金属屏蔽', value: '47.7', unit: '°C' }, { label: '电缆表面', value: '40.7', unit: '°C' }]} /></PropertyGroup>
        <PropertyGroup title="还没有算"><PropertyList rows={[{ label: '正序阻抗 Z₁', value: '', missing: true, unit: '缺依据' }]} /></PropertyGroup>
      </div>
      <div className="flex w-80 flex-col gap-6 rounded-card border border-line bg-surface p-4">
        <Metric label="允许电流" value="458.7" unit="A" detail={<><TierMark tier="reference" />单回路能力</>} />
        <Metric label="短路电流 1 s" value={compact(SHORT_CIRCUIT.value)} unit={SHORT_CIRCUIT.unit} size="md" />
        <LimitMeter label="导体温度" value={49.7} limit={90} from={25} unit="°C" caption="保存负荷 300 A，余量 158.7 A" />
      </div>
    </Specimen>
    <Specimen title="求什么、已知什么" rule="计算屏的第一行。每个已知是一个能点开改的字段；改过还没重算的带一个点。" wide>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <PremiseStrip asked="允许电流 · 单回路能力">
          <Given label="型号" value="YJV22-8.7/15 kV 3×240" />
          <Given label="埋深" value="1.2 m" />
          <Given label="土壤热阻率" value="1 K·m/W" changed />
          <Given label="环境" value="25 °C" />
        </PremiseStrip>
      </div>
    </Specimen>
    <Specimen title="画布外框" rule="工具浮在左上（图层开关、缩放），视图切换在右上，温度图例在左下，状态栏在画布下面。画布内容是现有的自有绘图。">
      <State label="工具条"><CanvasToolbar label="画布工具">
        <CanvasLayer icon="result/field" label="温度场" pressed={field} onPressedChange={setField} />
        <CanvasLayer icon="result/radial" label="等温线" pressed={false} />
        <CanvasToolbarSeparator />
        <CanvasTool icon="tool/zoom-out" label="缩小" /><CanvasTool icon="tool/fit" label="回到全貌" /><CanvasTool icon="tool/zoom-in" label="放大" />
      </CanvasToolbar></State>
      <State label="温度图例"><TemperatureLegend title="颜色是土壤温度" ambient={25} limit={90} stops={fieldStops()} lines={5} /></State>
    </Specimen>
  </>;
}
