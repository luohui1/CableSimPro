// The screens, laid out from kit parts and the real example data, as they should look in the product, grouped by where they
// live. Each opens at full size at /gallery#screen=<id>; the sentence above each is what the engineer gets done on it
// (studio/DESIGN.md).
import type { ReactNode } from 'react';
import { AppFrame, TopBar, type Mode } from '@/kit/frame';
import { CardAction, FileCard, ModelCard, OpenInWorkbench, ProposalCard, RatingCard, RefusalCard } from '@/kit/chat/cards';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerInput, ComposerSend, ComposerStop, FileChip } from '@/kit/chat/composer';
import { AgentEmpty, ChatNotice, EmptyStatus, TaskStarter, TileFact } from '@/kit/chat/empty';
import { AssistantMessage, Prose, StreamCaret, ThreadColumn, TurnSpacer, UserMessage, threadViewportClass, useLastTurnAtTop } from '@/kit/chat/messages';
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { cn } from '@/lib/utils';
import { ChatGroup, ChatItem, ChatSearch, ChatSidebar, NewChatButton } from '@/kit/chat/sidebar';
import { StepTrace } from '@/kit/chat/steps';
import { useTheme } from '@/state/theme';
import { CableSection, SectionThumb } from './figures';
import { LIBRARY } from './library-data';
import { ProjectNew, RatingBody, RatingEdit, RatingSelection, RatingSweep } from './rating-screens';
import { ImportScreen, SeriesParams, SeriesRating, SeriesVersions, TypeNewManual, TypeNewStandard, type ImportStep } from './type-screens';
import { LibraryBody, PROJECTS, SeriesBody, WorkbenchSide } from './workbench-screens';
import { DropZone } from '@/kit/workbench/form';
import { PROPOSAL, RUN_METHOD } from './host-records';
import { WORKSPACE } from './library-data';
import { AgentModelCard, SettingsModelBody, useHostStatus } from './live-screens';
import {
  ACTIVE_CHAT, CHATS, EXPORT_ASK, EXPORT_STEPS, HOST_DOWN, MODEL, MODEL_STEPS_DONE, MODEL_STEPS_RUNNING, NEW_PROJECT, NOT_CONFIGURED, RATING, RATING_ASK, RATING_STEPS, REFUSED_ASK,
  REFUSED_RATING, SHEET, STARTERS, STEPS_CUT, STEPS_FAILED, STEPS_WAITING, STREAMED, STREAMING_LINE, UPLOADING,
} from './samples';

export type ScreenGroup = 'agent' | 'types' | 'rating' | 'settings';
export interface ScreenSpec {
  id: string;
  group: ScreenGroup;
  title: string;
  job: string;
  render: () => ReactNode;
  /** The screen makes the host do real work (build a solid): the gallery's preview does not draw it, only the full screen. */
  heavy?: boolean;
}
export const GROUPS: { id: ScreenGroup; title: string }[] = [
  { id: 'agent', title: 'Agent 模式' }, { id: 'types', title: '电缆型号' }, { id: 'rating', title: '载流量计算' }, { id: 'settings', title: '设置' },
];

/** `model`: the name in the top bar; null when none is configured, false while the host has not said. */
function Frame({ mode, side, model = MODEL, children }: { mode: Mode; side?: ReactNode; model?: string | null | false; children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return <AppFrame top={<TopBar mode={mode} model={model === false ? undefined : model} theme={theme} onThemeToggle={toggle} />} side={side}>{children}</AppFrame>;
}

function Conversations({ active, running }: { active?: string; running?: boolean }) {
  return <ChatSidebar header={<><NewChatButton /><ChatSearch /></>}>
    <ChatGroup label="今天">
      {CHATS.map(chat => <ChatItem key={chat.id} title={chat.title} active={chat.id === active} running={running && chat.id === active} />)}
    </ChatGroup>
  </ChatSidebar>;
}

function Composer({ placeholder = '交办一件事，或把 Excel、CSV 结构表拖到这里', working, attachments }: { placeholder?: string; working?: boolean; attachments?: ReactNode }) {
  return <ComposerFrame>
    {attachments && <div className="flex flex-wrap gap-2 px-3 pt-3">{attachments}</div>}
    <ComposerInput placeholder={placeholder} />
    <ComposerBar start={<ComposerAttach />} end={working ? <ComposerStop /> : <ComposerSend disabled />} />
  </ComposerFrame>;
}

/** A conversation screen: the thread from its start (it is short), and the composer under it. */
function Thread({ active, running, composer, children }: { active: string; running?: boolean; composer: ReactNode; children: ReactNode }) {
  return <Frame mode="agent" side={<Conversations active={active} running={running} />}>
    <div className={cn(threadViewportClass, 'flex-col-reverse')}>
      <ThreadColumn className="gap-8 pt-8 pb-6">{children}</ThreadColumn>
    </div>
    <div className="shrink-0 pb-4"><ThreadColumn className="gap-3">{composer}</ThreadColumn></div>
  </Frame>;
}

// ---- Agent 模式 ----

const SPECS = LIBRARY.reduce((sum, series) => sum + series.specs.length, 0);
// What the work stands on: the standards the check and the parameters cite, and the methods with their versions.
const STANDARDS = [...new Set([...WORKSPACE.check.map(row => String(row.standard)), ...WORKSPACE.electrical.flatMap(row => row.standard ? [row.standard] : [])])];
const METHODS = [`${RUN_METHOD.plugin} ${RUN_METHOD.version}`, `${WORKSPACE.check_method.plugin_id} ${WORKSPACE.check_method.plugin_version}`,
  `${WORKSPACE.electrical_method.plugin_id} ${WORKSPACE.electrical_method.plugin_version}`, `${PROPOSAL.method.plugin_id} ${PROPOSAL.method.plugin_version}`];

function AgentEmptyScreen() {
  return <Frame mode="agent" side={<Conversations />}>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-8">
      <AgentEmpty
        title="今天要处理哪款电缆？"
        lead="导入结构表、按国标核对、算载流量、出规格书和计算书——交给我做，改动由你审。"
        className="2xl:max-w-4xl"
        composer={<div className="flex flex-col gap-2">
          <Composer />
          <DropZone compact title="把厂家结构表拖到这里" formats="支持 .xlsx、.xls 和 .csv" accept=".xlsx,.xls,.csv" />
        </div>}
        groups={[
          { label: '电缆型号', icon: 'nav/cable-type', figure: <div className="absolute -right-4 -bottom-10 size-40"><CableSection size={160} /></div>,
            facts: <><TileFact value={LIBRARY.length}>个系列</TileFact><TileFact value={SPECS}>个规格</TileFact></>,
            tasks: STARTERS.types.map(task => <TaskStarter key={task.title} icon={task.icon} title={task.title} result={task.result} />) },
          { label: '载流量计算', icon: 'calc/ampacity', figure: <SectionThumb width={192} height={112} />,
            facts: <><TileFact value={PROJECTS.length}>个工程</TileFact><TileFact before="最近一次校核" value={`${RATING.current} A`} /></>,
            tasks: STARTERS.rating.map(task => <TaskStarter key={task.title} icon={task.icon} title={task.title} result={task.result} />) },
        ]} />
    </div>
    <EmptyStatus facts={[
      { label: '依据', value: STANDARDS.join('、') },
      { label: '型号库', value: `${LIBRARY.length} 个系列，${SPECS} 个规格` },
      { label: '方法', value: [...new Set(METHODS)].join('、') },
    ]} />
  </Frame>;
}

// ---- Conversations under way: a step working, the answer arriving, a proposal waiting, a refusal, the host gone ----

function AgentRunningScreen() {
  return <Thread active={CHATS[0].id} running composer={<Composer placeholder="Agent 在做事；可以接着打字，或停下它" working />}>
    <UserMessage>{CHATS[0].title}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={MODEL_STEPS_RUNNING} defaultOpen />
      <ModelCard title="三维模型 · YJV22-8.7/15 kV 3×240" state="loading" />
    </AssistantMessage>
  </Thread>;
}

function AgentStreamingScreen() {
  return <Thread active={ACTIVE_CHAT} running composer={<Composer placeholder="Agent 在回答；可以接着打字，或停下它" working />}>
    <UserMessage>{RATING_ASK}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={RATING_STEPS} />
      <ProposalCard action="新建工程" subject="YJV22-8.7/15 3×240 直埋载流量校核" changes={NEW_PROJECT} phase="accepted" />
      <RatingCard {...RATING} figure={<SectionThumb />} actions={<><CardAction icon="result/report">计算书</CardAction><OpenInWorkbench /></>} />
      <Prose>
        <p>{STREAMED}</p>
        <ul><li>{STREAMING_LINE}<StreamCaret /></li></ul>
      </Prose>
    </AssistantMessage>
  </Thread>;
}

function AgentWaitingScreen() {
  return <Thread active={ACTIVE_CHAT} composer={<Composer placeholder="接受或拒绝上面的提案，Agent 接着做" />}>
    <UserMessage>{RATING_ASK}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={STEPS_WAITING} />
      <ProposalCard action="新建工程" subject="YJV22-8.7/15 3×240 直埋载流量校核" changes={NEW_PROJECT} phase="pending" />
    </AssistantMessage>
  </Thread>;
}

function AgentRefusedScreen() {
  return <Thread active={ACTIVE_CHAT} composer={<Composer placeholder="接着交办，或追问这条结果" attachments={<FileChip name={UPLOADING.name} detail={UPLOADING.detail} state="uploading" onRemove={() => undefined} />} />}>
    <UserMessage>{REFUSED_ASK}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={STEPS_FAILED.map(step => ({ ...step, reason: undefined }))} />
      <RefusalCard kind="refused" title={REFUSED_RATING.title} reason={REFUSED_RATING.reason} missing={REFUSED_RATING.missing}
        actions={<OpenInWorkbench />} />
    </AssistantMessage>
  </Thread>;
}

/** The settings as the serving host has them: its model in the top bar and in the section. */
function SettingsLiveScreen() {
  const { agent, error } = useHostStatus();
  return <Frame mode="agent" model={agent ? (agent.configured ? agent.model ?? null : null) : false}>
    <SettingsModelBody status={agent} error={error} />
  </Frame>;
}

/** The solid in the conversation, asked of the host when the card shows: the 3×240 of conversation 01a1e248 where the host
 *  has it, the catalogue's otherwise. */
function AgentModelScreen() {
  return <Thread active={CHATS[0].id} composer={<Composer placeholder="接着交办，或追问这条结果" />}>
    <UserMessage>{CHATS[0].title}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={MODEL_STEPS_DONE} />
      <AgentModelCard />
    </AssistantMessage>
  </Thread>;
}

function AgentErrorScreen() {
  return <Thread active={CHATS[4].id} composer={<>
    <ChatNotice tone="error">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{HOST_DOWN}</span>
        <Button variant="outline" size="sm"><Icon name="agent/retry" data-icon="inline-start" />重试</Button>
      </div>
    </ChatNotice>
    <Composer placeholder="接着交办，或追问这条结果" />
  </>}>
    <UserMessage>{EXPORT_ASK}</UserMessage>
    <AssistantMessage>
      <StepTrace steps={STEPS_CUT} defaultOpen />
    </AssistantMessage>
  </Thread>;
}

function AgentChatScreen() {
  const viewport = useLastTurnAtTop<HTMLDivElement>();
  return <Frame mode="agent" side={<Conversations active={ACTIVE_CHAT} />}>
    <div ref={viewport} className={cn(threadViewportClass, 'relative')}>
      <ThreadColumn className="gap-8 pt-8 pb-6">
        <div data-turn-start><UserMessage>{RATING_ASK}</UserMessage></div>
        <AssistantMessage>
          <StepTrace steps={RATING_STEPS} />
          <ProposalCard action="新建工程" subject="YJV22-8.7/15 3×240 直埋载流量校核" changes={NEW_PROJECT} phase="accepted" />
          <RatingCard {...RATING} figure={<SectionThumb />}
            actions={<><CardAction icon="result/report">计算书</CardAction><OpenInWorkbench /></>} />
          <Prose>
            <p>已选 <strong>YJV22-8.7/15 kV 3×240</strong>（人民电缆公开结构表，钢带铠装），按三芯直埋单回、埋深 1.2 m、土壤热阻率 1 K·m/W、环境 25 °C 算了一条运行记录。</p>
            <ul>
              <li>允许电流 <strong>458.7 A</strong>；保存负荷 300 A 时导体 49.7 °C（限值 90 °C），离允许电流还差 158.7 A。</li>
              <li>只敷设了一个回路，先到温限的就是这根三芯电缆本身。</li>
              <li>可信分档为<strong>参考</strong>：三芯分支只有组件级手算对照，交付前请另行核对。</li>
            </ul>
          </Prose>
        </AssistantMessage>
        <div data-turn-start><UserMessage>{EXPORT_ASK}</UserMessage></div>
        <AssistantMessage>
          <StepTrace steps={EXPORT_STEPS} />
          <FileCard {...SHEET} />
          <Prose>
            <p>规格书已导出：YJV22-8.7/15 kV 3×240 第 1 版，含结构表、电气参数和标准核对结论（通过 13 项、不通过 0 项、缺项 21 项）。这一版还没审核，文件上标着“草稿”，能否对外由你决定。</p>
          </Prose>
        </AssistantMessage>
        <TurnSpacer />
      </ThreadColumn>
    </div>
    <div className="shrink-0 pb-4"><ThreadColumn><Composer placeholder="接着交办，或追问这条结果" /></ThreadColumn></div>
  </Frame>;
}

const workbench = (at: 'library' | 'series' | 'projects' | 'project', body: ReactNode) =>
  <Frame mode="workbench" side={<WorkbenchSide at={at} />}>{body}</Frame>;

const IMPORT_SCREENS: { step: ImportStep; title: string; job: string }[] = [
  { step: 'upload', title: '导入结构表 · 上传', job: '工程师在这屏把厂家的结构表交给软件：拖进来，或先用公开样例试一遍。' },
  { step: 'sheet', title: '导入结构表 · 选工作表', job: '工程师在这屏挑出要导入的那张工作表，一张表成一个系列。' },
  { step: 'columns', title: '导入结构表 · 列对应', job: '工程师在这屏确认表里每一列对应哪个字段，不对的改掉，不要的列不导入。' },
  { step: 'preview', title: '导入结构表 · 预览', job: '工程师在这屏看每一行会生成什么规格、哪些行能导入、哪些行跳过，尺寸怎么闭合。' },
  { step: 'commit', title: '导入结构表 · 导入', job: '工程师在这屏补齐系列信息和表里没有的尺寸及依据，把整张表导入成一批第 1 版草稿。' },
];

export const SCREENS: ScreenSpec[] = [
  { id: 'agent-empty', group: 'agent', title: 'Agent 模式 · 空状态', job: '工程师在这屏把一件电缆的事交给 Agent：说一句话、拖入结构表，或从两类现成的任务里点一个。', render: () => <AgentEmptyScreen /> },
  { id: 'agent-chat', group: 'agent', title: 'Agent 模式 · 做完的对话', job: '工程师在这屏看 Agent 做了什么、算出了什么，审它提的改动，拿走结果和文件。', render: () => <AgentChatScreen /> },
  { id: 'agent-running', group: 'agent', title: 'Agent 模式 · 步骤进行中', job: '工程师在这屏看 Agent 正在做哪一步、做完了哪几步，需要时停下它。', render: () => <AgentRunningScreen /> },
  { id: 'agent-streaming', group: 'agent', title: 'Agent 模式 · 回答正在写出', job: '工程师在这屏边看结果卡边读 Agent 正在写的交代，不必等它写完。', render: () => <AgentStreamingScreen /> },
  { id: 'agent-waiting', group: 'agent', title: 'Agent 模式 · 提案等你决定', job: '工程师在这屏看清 Agent 要建或要改的每一项，接受，或写下原因拒绝。', render: () => <AgentWaitingScreen /> },
  { id: 'agent-refused', group: 'agent', title: 'Agent 模式 · 拒算，附件上传中', job: '工程师在这屏看懂为什么没有算出结果、缺什么或超出什么范围，并接着交办下一件事。', render: () => <AgentRefusedScreen /> },
  { id: 'agent-error', group: 'agent', title: 'Agent 模式 · 出错', job: '工程师在这屏知道任务停在哪一步、为什么停，确认服务恢复后重试。', render: () => <AgentErrorScreen /> },
  { id: 'agent-model', group: 'agent', title: 'Agent 模式 · 三维模型卡（实时取自宿主）', job: '工程师在这屏转着看 Agent 建好的三维实体，剖开看各层，下载 STEP，或到工作台接着看。', render: () => <AgentModelScreen />, heavy: true },
  { id: 'library', group: 'types', title: '工作台 · 型号库', job: '工程师在这屏找到一款型号，看清它每个规格的尺寸、审核状态和核对结果，打开它或导入新的结构表。',
    render: () => workbench('library', <LibraryBody />) },
  ...IMPORT_SCREENS.map(item => ({ id: `import-${item.step}`, group: 'types' as const, title: `工作台 · ${item.title}`, job: item.job,
    render: () => workbench('library', <ImportScreen at={item.step} />) })),
  { id: 'type-new-manual', group: 'types', title: '工作台 · 新建型号 · 从零填写', job: '工程师在这屏从导体往外逐层填出一个规格，边填边看断面，建成第 1 版草稿。',
    render: () => workbench('library', <TypeNewManual />) },
  { id: 'type-new-standard-conditions', group: 'types', title: '工作台 · 新建型号 · 按标准生成 · 条件', job: '工程师在这屏说清按哪份标准、什么样的电缆，给出屏蔽厚度，让标准给出初始结构。',
    render: () => workbench('library', <TypeNewStandard at="conditions" />) },
  { id: 'type-new-standard', group: 'types', title: '工作台 · 新建型号 · 按标准生成 · 提案与对照', job: '工程师在这屏看标准给出的各层尺寸和每个数的出处，与厂家手册对照，再决定补齐并建成草稿。',
    render: () => workbench('library', <TypeNewStandard />) },
  { id: 'type-new-standard-create', group: 'types', title: '工作台 · 新建型号 · 按标准生成 · 补齐并建成', job: '工程师在这屏填上标准不规定的导体外径和成品外径，定下放进哪个系列，建成第 1 版草稿。',
    render: () => workbench('library', <TypeNewStandard at="create" />) },
  { id: 'series', group: 'types', title: '工作台 · 型号工作区 · 结构与核对', job: '工程师在这屏把一个规格的结构和标准核对看全，决定改哪一层、出新版本。',
    render: () => workbench('series', <SeriesBody />) },
  { id: 'series-params', group: 'types', title: '工作台 · 型号工作区 · 参数', job: '工程师在这屏查一个版本的电气参数和短路电流：算了哪些、依据哪条，还缺什么。',
    render: () => workbench('series', <SeriesParams />) },
  { id: 'series-rating', group: 'types', title: '工作台 · 型号工作区 · 载流量表', job: '工程师在这屏读一个版本的载流量表：每种敷设、每档土壤热阻率下的允许电流，以及它可信到什么程度。',
    render: () => workbench('series', <SeriesRating />) },
  { id: 'series-versions', group: 'types', title: '工作台 · 型号工作区 · 版本与文件', job: '工程师在这屏看这个规格有哪几版、每版为什么改、审到哪一步，提交、审核、发布或出新版本，拿走文件。',
    render: () => workbench('series', <SeriesVersions />) },
  { id: 'project-new', group: 'rating', title: '工作台 · 新建载流量工程', job: '工程师在这屏为一个规格开一个载流量工程：选规格、选敷设方式、填工况，建好就算。',
    render: () => workbench('projects', <ProjectNew />) },
  { id: 'rating', group: 'rating', title: '工作台 · 载流量计算', job: '工程师在这屏回答：这款电缆这样敷设能带多大电流，哪根先到温限，依据是什么。',
    render: () => workbench('project', <RatingBody />) },
  { id: 'rating-edit', group: 'rating', title: '工作台 · 载流量计算 · 改已知条件', job: '工程师在这屏改一个已知条件，一边看着原来的结果，一边决定按新条件重算。',
    render: () => workbench('project', <RatingEdit />) },
  { id: 'rating-sweep', group: 'rating', title: '工作台 · 载流量计算 · 扫描', job: '工程师在这屏看一个条件从小到大变化时，允许电流和导体温度怎么走，哪一点最紧。',
    render: () => workbench('project', <RatingSweep />) },
  { id: 'rating-selection', group: 'rating', title: '工作台 · 载流量计算 · 选型', job: '工程师在这屏按目标电流从一个系列里选出最小够用的截面，并看清其余规格为什么不选。',
    render: () => workbench('project', <RatingSelection />) },
  { id: 'settings-model', group: 'settings', title: '设置 · Agent 用的模型（实时取自宿主）', job: '工程师在这屏确认 Agent 用的是哪个接口、哪个模型，密钥配了没有，连不连得上。',
    render: () => <SettingsLiveScreen /> },
  { id: 'settings-model-missing', group: 'settings', title: '设置 · 模型未配置', job: '工程师在这屏看到模型还没配置，照着说明设好环境变量再重启。',
    render: () => <Frame mode="agent" model={null}><SettingsModelBody status={{ configured: false, hint: NOT_CONFIGURED }} /></Frame> },
];
