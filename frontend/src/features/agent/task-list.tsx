import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { workspaces } from "@/api/research";
import { text } from "@/api/client";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { WorkingMark } from "./conversation";
import { agentSessions, type AgentSessionSummary } from "./agent-api";

const WAITING: Record<string, string> = { missing_input: "待补齐输入", scope_confirmation: "待确认运行范围", external_job: "等待外部作业", capability: "需人工处理", budget: "预算已用尽", human_review: "待审核方案" };

/** 任务状态说明：一句话说清停在哪里。 */
export function taskState(task: Pick<AgentSessionSummary, "state" | "waiting_reason" | "pending_proposals">) {
  if (task.pending_proposals > 0) return { tone: "review", text: `待审核 ${task.pending_proposals} 项改动` };
  switch (task.state) {
    case "planning": case "running": return { tone: "running", text: "执行中" };
    case "reviewing": return { tone: "review", text: "待审核" };
    case "completed": return { tone: "done", text: "已完成" };
    case "waiting": return { tone: "waiting", text: `等待 · ${WAITING[task.waiting_reason || ""] || "人工处理"}` };
    case "blocked": return { tone: "error", text: `受阻 · ${WAITING[task.waiting_reason || ""] || "需要人工处理"}` };
    case "failed": return { tone: "error", text: "任务未完成" };
    case "cancelled": return { tone: "waiting", text: "已取消" };
    default: return { tone: "waiting", text: "未开始" };
  }
}

const when = (value: string) => {
  const date = new Date(value), now = new Date();
  const pad = (number: number) => String(number).padStart(2, "0");
  return date.toDateString() === now.toDateString() ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getMonth() + 1}-${pad(date.getDate())}`;
};

/** Agent 模式的左栏：新任务 + 按工程分组的任务（参考组件陈列“左栏 · 任务”）。 */
export function AgentTaskList({ theme }: { theme: "light" | "dark" }) {
  const search = useSearch({ strict: false }) as { task?: string; workspace?: string };
  const sessions = useQuery({ queryKey: ["agent-sessions"], queryFn: ({ signal }) => agentSessions(undefined, signal), retry: false, refetchInterval: (query) => query.state.data?.some((row) => ["planning", "running"].includes(row.state)) ? 3000 : false });
  const spaces = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const names = new Map((spaces.data || []).map((row) => [text(row.id), text(row.name)]));
  const groups = [...new Set((sessions.data || []).map((row) => row.workspace_id))];
  return <>
    <Button asChild variant="secondary" className="sidebar-new"><Link to="/agent" search={{ theme, workspace: search.workspace }}><Icon name="action/edit" /><span>新任务</span></Link></Button>
    <div className="sidebar-scroll agent-tasks">
      {sessions.isPending ? <div className="tree-empty">读取中</div>
        : sessions.isError ? <div className="tree-empty">任务读取失败</div>
          : !groups.length ? <div className="tree-empty">还没有任务</div>
            : groups.map((wid) => <section key={wid} aria-label={names.get(wid) || "工程"}>
              <div className="tree-caption"><Icon name="object/folder" /><span className="tree-label">{names.get(wid) || "工程"}</span></div>
              {(sessions.data || []).filter((row) => row.workspace_id === wid).map((row) => {
                const state = taskState(row);
                return <Link key={row.id} className="agent-task" to="/agent" search={{ theme, task: row.id, workspace: row.workspace_id }} aria-current={row.id === search.task ? "page" : undefined}>
                  <span className={`agent-task-mark is-${state.tone}`}>{state.tone === "running" ? <WorkingMark state="working" /> : <Icon name={state.tone === "review" ? "agent/proposal" : state.tone === "done" ? "agent/approve" : state.tone === "error" ? "status/warning" : "status/pending"} />}</span>
                  <span className="agent-task-title" title={row.title || undefined}>{row.title || "未命名任务"}</span>
                  <time>{when(row.updated)}</time>
                  <span className="agent-task-detail">{state.text}</span>
                </Link>;
              })}
            </section>)}
    </div>
  </>;
}
