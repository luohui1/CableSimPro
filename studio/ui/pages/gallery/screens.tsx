// The five screens, laid out from kit parts and the real example data, as they should look in the product. Each opens at
// full size at /gallery#screen=<id>; the sentence above each is what the engineer gets done on it (studio/DESIGN.md).
import type { ReactNode } from 'react';
import { AppFrame, TopBar, type Mode } from '@/kit/frame';
import { CardAction, FileCard, OpenInWorkbench, ProposalCard, RatingCard } from '@/kit/chat/cards';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerInput, ComposerSend } from '@/kit/chat/composer';
import { AgentEmpty, TaskStarter } from '@/kit/chat/empty';
import { AssistantMessage, Prose, ThreadColumn, UserMessage } from '@/kit/chat/messages';
import { ChatGroup, ChatItem, ChatSearch, ChatSidebar, NewChatButton } from '@/kit/chat/sidebar';
import { StepTrace } from '@/kit/chat/steps';
import { useTheme } from '@/state/theme';
import { SectionThumb } from './figures';
import { LibraryBody, RatingBody, SeriesBody, WorkbenchSide } from './workbench-screens';
import {
  ACTIVE_CHAT, CHATS, EXPORT_ASK, EXPORT_STEPS, MODEL, NEW_PROJECT, RATING, RATING_ASK, RATING_STEPS, SHEET, STARTERS,
} from './samples';

export interface ScreenSpec { id: string; title: string; job: string; render: () => ReactNode }

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
        lead="导入结构表、按国标核对、算载流量、出规格书和计算书，交给我做，改动由你审。"
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
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
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

export const SCREENS: ScreenSpec[] = [
  { id: 'agent-empty', title: 'Agent 模式 · 空状态', job: '工程师在这屏把一件电缆的事交给 Agent：说一句话、拖入结构表，或点一个现成的任务。', render: () => <AgentEmptyScreen /> },
  { id: 'agent-chat', title: 'Agent 模式 · 做完的对话', job: '工程师在这屏看 Agent 做了什么、算出了什么，审它提的改动，拿走结果和文件。', render: () => <AgentChatScreen /> },
  { id: 'library', title: '工作台 · 型号库', job: '工程师在这屏找到一款型号，看清它每个规格的尺寸、审核状态和核对结果，打开它或导入新的结构表。',
    render: () => <Frame mode="workbench" side={<WorkbenchSide at="library" />}><LibraryBody /></Frame> },
  { id: 'series', title: '工作台 · 一款型号的工作区', job: '工程师在这屏把一个规格的结构、参数和标准核对看全，决定改哪一层、出新版本。',
    render: () => <Frame mode="workbench" side={<WorkbenchSide at="series" />}><SeriesBody /></Frame> },
  { id: 'rating', title: '工作台 · 载流量计算', job: '工程师在这屏回答：这款电缆这样敷设能带多大电流，哪根先到温限，依据是什么。',
    render: () => <Frame mode="workbench" side={<WorkbenchSide at="project" />}><RatingBody /></Frame> },
];
