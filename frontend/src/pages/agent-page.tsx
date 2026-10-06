import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { methodCatalog, typeIndex, workspaces } from "@/api/research";
import { optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { StatusMark } from "@/components/status-mark";
import { Select } from "@/components/ui/select";
import { AgentPanel } from "@/features/agent/agent-panel";
import { agentStatus, agentTools, AgentUnavailable, type AgentTool } from "@/features/agent/agent-api";

const PROJECT_SUGGESTIONS = ["这个工程里哪些计算还没有结果？", "汇总各计算的载流量结论和限制因素", "检查工程模型还缺哪些输入"];
const KINDS: [AgentTool["kind"], string, string][] = [
  ["read", "读取", "只读，不改任何数据"],
  ["propose", "生成方案", "改动写进方案，批准后才保存"],
  ["run", "运行", "预检与快速试算；正式运行和超算提交要你批准"],
];

/**
 * Agent 模式：与工作台并行，调用同一批模块和插件能力。
 * 左边是对话（绑定一个工程），右边是它此刻真正能调用的工具——来自 Agent 服务的工具注册表，
 * 服务未部署时只列出插件清单里将成为工具的能力，不写死任何工具。
 */
export function AgentPage() {
  const { theme } = usePageTheme();
  const search = useSearch({ from: "/agent" });
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["agent-status"], queryFn: ({ signal }) => agentStatus(signal), retry: false, staleTime: 60_000 });
  const tools = useQuery({ queryKey: ["agent-tools"], queryFn: ({ signal }) => agentTools(signal), retry: false, staleTime: 60_000 });
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal), enabled: tools.isError });
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const types = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal) });
  const typeIds = new Set((types.data || []).map((row) => text(row.id)));
  const options = (projects.data || []).filter((row) => !typeIds.has(text(row.id))).map((row) => ({ value: text(row.id), label: text(row.name) }));
  const workspace = options.find((option) => option.value === search.workspace) || options[0];
  const ready = !!status.data?.configured;
  const label = ready ? status.data?.model || "已连接" : status.error instanceof AgentUnavailable ? "服务尚未部署" : status.isPending ? "检查中" : "模型未配置";

  // 服务注册表按权限分组；服务未部署时按插件列出清单里的能力（它们会自动成为“运行”类工具）
  const groups = tools.data
    ? KINDS.map(([kind, title, note]) => ({ key: kind, title, note, rows: tools.data.filter((tool) => tool.kind === kind) }))
    : (catalog.data || []).map(optionalRecord).map((plugin) => ({
      key: text(optionalRecord(plugin.method).plugin_id),
      title: text(plugin.name),
      note: text(optionalRecord(plugin.execution_policy).backend) === "slurm" ? "超算" : "本机",
      rows: (Array.isArray(plugin.capabilities) ? plugin.capabilities : []).map(optionalRecord).map((cap) => ({ name: text(cap.id), title: text(cap.title) || text(cap.id) } as Pick<AgentTool, "name" | "title" | "description">)),
    }));
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <AppShell title="Agent" status={<StatusMark kind={ready ? "success" : "draft"} label={label} />} actions={null} theme={theme} onTheme={() => {}} onUnavailable={() => {}}>
      <div className="agent-page" data-page="agent">
        <section className="agent-conversation" aria-label="对话">
          <div className="agent-scope">
            <Select label="工程" value={workspace?.value} options={options} loading={projects.isPending} placeholder="选择工程"
              onChange={(value) => void navigate({ to: "/agent", search: { theme, workspace: value }, replace: true })} />
          </div>
          {workspace ? <AgentPanel key={workspace.value} workspaceId={workspace.value} context={workspace.label} suggestions={PROJECT_SUGGESTIONS} />
            : !projects.isPending && <p className="muted">还没有工程。先在工程页新建一个，Agent 才有工作对象。</p>}
        </section>
        <aside className="agent-tools" aria-label="可调用的工具">
          <h2>可调用的工具{count > 0 && <span>{count}</span>}</h2>
          {!tools.data && <p className="muted">{tools.isPending ? "读取工具注册表" : "Agent 服务部署后显示完整注册表。下面是插件清单里的能力，每项会自动成为一个工具。"}</p>}
          {groups.filter((group) => group.rows.length > 0).map((group) => <section key={group.key}>
            <h3>{group.title}<span>{group.note}</span></h3>
            <ul>{group.rows.map((tool) => <li key={tool.name}>{tool.title}{tool.description && <span>{tool.description}</span>}</li>)}</ul>
          </section>)}
        </aside>
      </div>
    </AppShell>
  );
}
