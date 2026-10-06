import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { methodCatalog } from "@/api/research";
import { optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { StatusMark } from "@/components/status-mark";
import { illustration } from "@/lib/illustrations";

type Tool = { name: string; detail: string };

/** 工作台模块对应的 Agent 工具：与人在工作台里做的事一一对应，改动只进方案，批准由人完成。 */
const WORKBENCH_TOOLS: [string, string, Tool[]][] = [
  ["读取", "只读，不改任何数据", [
    { name: "读取研究", detail: "敷设截面、工况、方法参数与判据" },
    { name: "读取运行结果", detail: "结果汇总、结果详情、验证与范围" },
    { name: "读取型号库", detail: "型号结构、版本与资料来源" },
  ]],
  ["在方案里修改", "改动写在独立方案，不影响已保存研究", [
    { name: "敷设截面", detail: "排管、埋深、回路间距" },
    { name: "工况", detail: "土壤热阻率、环境温度、负荷" },
    { name: "方法参数", detail: "按插件输入契约校验后写入" },
  ]],
  ["交付", "草稿需人工审核后才能发出", [
    { name: "计算书草稿", detail: "只从指定运行生成" },
  ]],
];

/**
 * Agent 模式：与工作台并行，调用的是同一批模块和插件能力。
 * 模型尚未连接时如实显示，并列出它将能调用的全部工具（插件能力自动成为工具）。
 */
export function AgentPage() {
  const { theme } = usePageTheme();
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const pluginTools = (catalog.data || []).map(optionalRecord).map((plugin) => ({
    plugin: text(plugin.name),
    id: text(optionalRecord(plugin.method).plugin_id),
    hpc: text(optionalRecord(plugin.execution_policy).backend) === "slurm",
    caps: (Array.isArray(plugin.capabilities) ? plugin.capabilities : []).map(optionalRecord).map((cap) => text(cap.title)),
  }));
  const art = illustration("settings-model");
  return (
    <AppShell title="Agent" status={<StatusMark kind="draft" label="未连接模型" />} actions={null} theme={theme} onTheme={() => {}} onUnavailable={() => {}}>
      <div className="agent-page" data-page="agent">
        <section className="agent-conversation" aria-label="对话">
          <div className="agent-intro">
            {art && <img src={art} alt="" />}
            <h2>Agent 与工作台用同一套模块</h2>
            <p>它能做的每一步，都是你在工作台里也能做的事：读取研究与结果、在独立方案里修改输入、调用插件运行、起草计算书。每一步都留下记录，改动要你批准后才生效。</p>
            <p className="muted">模型连接方式确定后即可使用；在<Link to="/settings" search={{ theme }}>设置</Link>里查看状态。</p>
          </div>
          <div className="agent-composer" aria-disabled="true">
            <textarea disabled placeholder="模型未连接。连接后可在这里描述任务，用 @ 引用研究或型号。" aria-label="任务描述" />
          </div>
        </section>
        <aside className="agent-tools" aria-label="可调用的工具">
          <h2>可调用的工具</h2>
          {WORKBENCH_TOOLS.map(([group, rule, tools]) => <section key={group}>
            <h3>{group}<span>{rule}</span></h3>
            <ul>{tools.map((tool) => <li key={tool.name}><b>{tool.name}</b><span>{tool.detail}</span></li>)}</ul>
          </section>)}
          <section>
            <h3>运行插件<span>每个插件能力自动成为一个工具</span></h3>
            <ul>{pluginTools.map((plugin) => <li key={plugin.id}>
              <b>{plugin.plugin}{plugin.hpc ? " · 超算" : ""}</b>
              <span>{plugin.caps.slice(0, 3).join("、")}{plugin.caps.length > 3 ? ` 等 ${plugin.caps.length} 项` : ""}</span>
            </li>)}</ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
