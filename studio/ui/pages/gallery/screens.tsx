// The screens, laid out from kit parts and the real example data, as they should look in the product, grouped by where they
// live. Each opens at full size at /gallery#screen=<id>; the sentence above each is what the engineer gets done on it
// (studio/DESIGN.md).
import type { ReactNode } from 'react';
import { AppFrame, TopBar, type Mode } from '@/kit/frame';
import { CardAction, FileCard, OpenInWorkbench, ProposalCard, RatingCard } from '@/kit/chat/cards';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerInput, ComposerSend } from '@/kit/chat/composer';
import { AgentEmpty, TaskStarter } from '@/kit/chat/empty';
import { AssistantMessage, Prose, ThreadColumn, UserMessage, threadViewportClass } from '@/kit/chat/messages';
import { cn } from '@/lib/utils';
import { ChatGroup, ChatItem, ChatSearch, ChatSidebar, NewChatButton } from '@/kit/chat/sidebar';
import { StepTrace } from '@/kit/chat/steps';
import { useTheme } from '@/state/theme';
import { SectionThumb } from './figures';
import { ProjectNew, RatingBody, RatingEdit, RatingSelection, RatingSweep } from './rating-screens';
import { ImportScreen, SeriesParams, SeriesRating, SeriesVersions, TypeNewManual, TypeNewStandard, type ImportStep } from './type-screens';
import { LibraryBody, SeriesBody, WorkbenchSide } from './workbench-screens';
import {
  ACTIVE_CHAT, CHATS, EXPORT_ASK, EXPORT_STEPS, MODEL, NEW_PROJECT, RATING, RATING_ASK, RATING_STEPS, SHEET, STARTERS,
} from './samples';

export type ScreenGroup = 'agent' | 'types' | 'rating';
export interface ScreenSpec { id: string; group: ScreenGroup; title: string; job: string; render: () => ReactNode }
export const GROUPS: { id: ScreenGroup; title: string }[] = [
  { id: 'agent', title: 'Agent 模式' }, { id: 'types', title: '电缆型号' }, { id: 'rating', title: '载流量计算' },
];

function Frame({ mode, side, children }: { mode: Mode; side?: ReactNode; children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return <AppFrame top={<TopBar mode={mode} model={MODEL} theme={theme} onThemeToggle={toggle} />} side={side}>{children}</AppFrame>;
}

function Conversations({ active }: { active?: string }) {
  return <ChatSidebar header={<><NewChatButton /><ChatSearch /></>}>
    <ChatGroup label="今天">
      {CHATS.map(chat => <ChatItem key={chat.id} title={chat.title} active={chat.id === active} />)}
    </ChatGroup>
  </ChatSidebar>;
}

function Composer({ placeholder = '交办一件事，或把 Excel、CSV 结构表拖到这里' }: { placeholder?: string }) {
  return <ComposerFrame>
    <ComposerInput placeholder={placeholder} />
    <ComposerBar start={<ComposerAttach />} end={<ComposerSend disabled />} />
  </ComposerFrame>;
}

// ---- Agent 模式 ----

function AgentEmptyScreen() {
  return <Frame mode="agent" side={<Conversations />}>
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-12">
      <AgentEmpty
        title="今天要处理哪款电缆？"
        lead="导入结构表、按国标核对、算载流量、出规格书和计算书——交给我做，改动由你审。"
        composer={<Composer />}
        groups={[
          { label: '电缆型号', icon: 'nav/cable-type', tasks: STARTERS.types.map(task => <TaskStarter key={task.title} icon={task.icon} title={task.title} result={task.result} />) },
          { label: '载流量计算', icon: 'calc/ampacity', tasks: STARTERS.rating.map(task => <TaskStarter key={task.title} icon={task.icon} title={task.title} result={task.result} />) },
        ]} />
    </div>
  </Frame>;
}

function AgentChatScreen() {
  return <Frame mode="agent" side={<Conversations active={ACTIVE_CHAT} />}>
    {/* A finished conversation opens at its end, as a chat does. */}
    <div className={cn(threadViewportClass, 'flex-col-reverse')}>
      <ThreadColumn className="gap-8 pt-8 pb-6">
        <UserMessage>{RATING_ASK}</UserMessage>
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
        <UserMessage>{EXPORT_ASK}</UserMessage>
        <AssistantMessage>
          <StepTrace steps={EXPORT_STEPS} />
          <FileCard {...SHEET} />
          <Prose>
            <p>规格书已导出：YJV22-8.7/15 kV 3×240 第 1 版，含结构表、电气参数和标准核对结论（通过 13 项、不通过 0 项、缺项 21 项）。这一版还没审核，文件上标着“草稿”，能否对外由你决定。</p>
          </Prose>
        </AssistantMessage>
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
  { id: 'agent-empty', group: 'agent', title: 'Agent 模式 · 空状态', job: '工程师在这屏把一件电缆的事交给 Agent：说一句话、拖入结构表，或点一个现成的任务。', render: () => <AgentEmptyScreen /> },
  { id: 'agent-chat', group: 'agent', title: 'Agent 模式 · 做完的对话', job: '工程师在这屏看 Agent 做了什么、算出了什么，审它提的改动，拿走结果和文件。', render: () => <AgentChatScreen /> },
  { id: 'library', group: 'types', title: '工作台 · 型号库', job: '工程师在这屏找到一款型号，看清它每个规格的尺寸、审核状态和核对结果，打开它或导入新的结构表。',
    render: () => workbench('library', <LibraryBody />) },
  ...IMPORT_SCREENS.map(item => ({ id: `import-${item.step}`, group: 'types' as const, title: `工作台 · ${item.title}`, job: item.job,
    render: () => workbench('library', <ImportScreen at={item.step} />) })),
  { id: 'type-new-manual', group: 'types', title: '工作台 · 新建型号 · 从零填写', job: '工程师在这屏从导体往外逐层填出一个规格，边填边看断面，建成第 1 版草稿。',
    render: () => workbench('library', <TypeNewManual />) },
  { id: 'type-new-standard', group: 'types', title: '工作台 · 新建型号 · 按标准生成', job: '工程师在这屏看标准给出的各层尺寸和每个数的出处，与厂家手册对照，再决定补齐并建成草稿。',
    render: () => workbench('library', <TypeNewStandard />) },
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
];
