import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { methodCatalog } from "@/api/research";
import { optionalRecord, text } from "@/api/client";
import { displayName } from "@/lib/display-names";
import { moduleConfiguration } from "@/lib/study-config";
import { ARTIFACT_KINDS, validationLevel } from "@/lib/plugin-labels";
import { useStudy } from "./study-provider";
import { usePageTheme } from "./catalog-shell";
import { EmptyState, LoadingState } from "./states";

const list = (value: unknown) => (Array.isArray(value) ? value : []);
const INPUTS: [string, string, string][] = [["cable", "电缆", "section"], ["section", "敷设截面", "section"], ["conditions", "工况", "inputs"]];

/**
 * 仿真运行前：按「输入 → 求解参数 → 运行位置 → 产出」说明这次将如何计算。
 * 全部来自研究定义与插件清单；没有运行结果时不显示任何数值结果。
 */
export function SimulationSetup({ module }: { module: string }) {
  const context = useStudy();
  const { theme } = usePageTheme();
  const definition = context.draft?.definition || context.study.definition;
  const configuration = moduleConfiguration(definition, module);
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  if (!configuration) return <EmptyState title="当前研究没有该模块的方法配置" description="" />;
  if (catalog.isPending) return <LoadingState title="正在读取插件清单" />;
  const method = configuration.method;
  const plugin = (catalog.data || []).map(optionalRecord).find((row) => text(optionalRecord(row.method).plugin_id) === method.plugin_id);
  const capability = list(plugin?.capabilities).map(optionalRecord).find((cap) => text(cap.id) === method.capability);
  const hpc = text(optionalRecord(plugin?.execution_policy).backend) === "slurm";
  const parameters = Object.entries(optionalRecord(configuration.parameters));
  const artifacts = list(capability?.artifacts).map((a) => text(optionalRecord(a).type));
  const outputs = list(capability?.outputs).map((o) => text(optionalRecord(o).key));
  const validation = optionalRecord(capability?.validation);
  const limits = list(capability?.limitations).map(text).filter(Boolean);
  const link = (target: string, tab: string) => ({ to: "/studies/$sid/$module/$tab" as const, params: { sid: context.study.id, module: target, tab }, search: { theme, workspace: context.study.workspace, run: "", delivery: "" } });

  return <div className="sim-setup" data-state="setup">
    <header className="sim-setup-head">
      <h2>尚未运行</h2>
      <p>{plugin ? `${text(plugin.name)} · ${text(capability?.title) || method.capability} · ${method.version}` : `插件 ${method.plugin_id} 未安装`}</p>
    </header>
    <ol className="sim-steps">
      <li>
        <h3>输入</h3>
        <p className="muted">{configuration.input_source === "domain" ? "使用本研究已保存的电缆、敷设截面与工况。" : "使用方法专用输入。"}</p>
        {configuration.input_source === "domain" && <div className="sim-links">{INPUTS.map(([target, label, tab]) => <Link key={target} {...link(target, tab)}>{label}</Link>)}</div>}
      </li>
      <li>
        <h3>求解参数<Link {...link(module, "parameters")}>修改</Link></h3>
        {parameters.length ? <dl className="sim-params">{parameters.map(([key, value]) => <div key={key}><dt>{displayName(key, key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : <p className="muted">使用插件默认参数。</p>}
      </li>
      <li>
        <h3>运行位置</h3>
        <p>{hpc ? "超算：以 Slurm 作业提交，完成后自动回收结果" : "本机：独立进程运行"}</p>
      </li>
      <li>
        <h3>产出</h3>
        <ul className="sim-outputs">
          {outputs.map((key) => <li key={key}>{displayName(key, key)}</li>)}
          {artifacts.map((type) => <li key={type}>{ARTIFACT_KINDS[type] || type}</li>)}
        </ul>
      </li>
    </ol>
    {capability && <section className="sim-scope" aria-label="方法验证与适用范围">
      <h3>方法验证 <span className="muted">{validationLevel(text(validation.level))} · 参考算例 {list(validation.cases).length}</span></h3>
      {!!limits.length && <ul>{limits.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>}
  </div>;
}
