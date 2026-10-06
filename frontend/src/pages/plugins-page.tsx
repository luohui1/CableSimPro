import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { methodCatalog, studyIndex } from "@/api/research";
import { optionalRecord, text } from "@/api/client";
import { downloadJson } from "@/lib/download";
import { pluginArt } from "@/lib/illustrations";
import { ANALYSIS_KINDS, isBenchmarked, validationLevel } from "@/lib/plugin-labels";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

type Row = Record<string, unknown>;

const GROUPS: [string, string[]][] = [
  ["计算方法", ["cablesim.iec60287", "cablesim.type-electrical", "cablesim.thermal-network", "cablesim.hybrid-rating"]],
  ["建模", ["cablesim.cable-geometry"]],
  ["仿真", ["cablesim.simulation", "cablesim.native-reference", "cablesim.comsol-bridge"]],
  ["数据与标准", ["cablesim.standard-check", "cablesim.datasheet-extract"]],
];
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const pluginId = (row: Row) => text(optionalRecord(row.method).plugin_id);

/** 插件：左侧按领域分组的已安装插件，右侧逐项剖析选中插件（能力、验证、范围、运行策略、被谁使用）。 */
export function PluginsPage() {
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const { theme } = usePageTheme();
  const { pid } = useParams({ strict: false }) as { pid?: string };
  const rows = (catalog.data || []) as Row[];
  const known = new Set(GROUPS.flatMap(([, ids]) => ids));
  const groups: [string, Row[]][] = [
    ...GROUPS.map(([label, ids]) => [label, ids.map((id) => rows.find((row) => pluginId(row) === id)).filter(Boolean) as Row[]] as [string, Row[]]),
    ["其他", rows.filter((row) => !known.has(pluginId(row)))],
  ].filter(([, items]) => items.length) as [string, Row[]][];
  const selected = rows.find((row) => pluginId(row) === pid) || groups[0]?.[1][0];

  return (
    <CatalogShell title="插件" active="插件" status={<span className="muted">已安装 {rows.length} 个 · 计算方法全部来自插件</span>}
      actions={<Tooltip content="宿主尚未提供插件安装接口"><span><Button size="compact" disabled>从文件安装</Button></span></Tooltip>}>
      <div data-page={pid ? "plugin-detail" : "plugins"} className="plugins-page">
        <QueryState query={catalog} empty={!rows.length && "尚无已安装插件"}>
          <nav className="plugin-list" aria-label="已安装插件">
            {groups.map(([label, items]) => <section key={label}>
              <h2>{label}</h2>
              {items.map((row) => {
                const id = pluginId(row);
                const art = pluginArt(id);
                const policy = optionalRecord(row.execution_policy);
                return <Link key={id} className="plugin-item" to="/plugins/$pid" params={{ pid: id }} search={{ theme }} aria-current={row === selected ? "page" : undefined}>
                  {art ? <img src={art} alt="" /> : <span className="plugin-item-art" />}
                  <span className="plugin-item-text"><b>{text(row.name)}</b><span>{text(optionalRecord(row.method).version)} · {text(policy.backend) === "slurm" ? "超算" : "本机"}</span></span>
                  <span className={`status-dot ${row.platform_supported === true ? "is-ok" : "is-off"}`} aria-label={row.platform_supported === true ? "支持当前平台" : "当前平台未覆盖"} />
                </Link>;
              })}
            </section>)}
          </nav>
          {selected ? <PluginDetail row={selected} studies={(studies.data || []).filter((study) => usesPlugin(study.definition, pluginId(selected)))} theme={theme} /> : <EmptyState art="plugin" title="该插件未安装" description="在左侧选择已安装插件。" />}
        </QueryState>
      </div>
    </CatalogShell>
  );
}

/** 研究定义（含各模块与交叉校核）里是否引用了该插件。 */
function usesPlugin(definition: unknown, id: string): boolean {
  const def = optionalRecord(definition);
  const methods = [def.method, ...Object.values(optionalRecord(def.modules)).map((m) => optionalRecord(m).method), ...list(def.crosschecks).map((c) => optionalRecord(c).method)];
  return methods.some((m) => text(optionalRecord(m).plugin_id) === id);
}

function PluginDetail({ row, studies, theme }: { row: Row; studies: { id: string; title: string; workspace: string; definition: unknown }[]; theme: "light" | "dark" }) {
  const id = pluginId(row);
  const method = optionalRecord(row.method);
  const policy = optionalRecord(row.execution_policy);
  const caps = list(row.capabilities).map(optionalRecord);
  const platforms = list(row.platforms).map(text).map((p) => p.replace("windows", "Windows").replace("linux", "Linux").replace("darwin", "macOS").replace("-x64", " x64").replace("-arm64", " arm64"));
  const art = pluginArt(id);
  const enforced = [policy.timeout_enforced && "强制超时", policy.parent_death_enforced && "宿主退出即终止", policy.process_tree_cleanup_enforced && "清理子进程", policy.memory_limit_enforced && "内存上限", policy.network_isolation_enforced && "断网运行"].filter(Boolean) as string[];
  return <article className="plugin-detail" aria-label={text(row.name)}>
    <header className="plugin-hero">
      {art && <img src={art} alt="" />}
      <div>
        <h1>{text(row.name)}</h1>
        <p className="plugin-id"><code>{id}</code><span>{text(method.version)}</span></p>
        <p className="plugin-description">{text(row.description)}</p>
      </div>
    </header>

    <dl className="plugin-facts">
      <div><dt>运行位置</dt><dd>{text(policy.backend) === "slurm" ? "超算（Slurm 作业）" : "本机 · 独立进程"}</dd></div>
      <div><dt>运行约束</dt><dd>{enforced.length ? enforced.join("、") : "—"}</dd></div>
      <div><dt>平台</dt><dd>{platforms.join("、") || "—"}</dd></div>
      <div><dt>被研究使用</dt><dd>{studies.length} 个</dd></div>
    </dl>

    <section className="plugin-section">
      <h2>能力 <span className="muted">{caps.length}</span></h2>
      <ol className="capability-list">
        {caps.map((cap) => {
          const validation = optionalRecord(cap.validation);
          const cases = list(validation.cases).map(text).filter(Boolean);
          const limits = list(cap.limitations).map(text).filter(Boolean);
          const outputs = list(cap.outputs).map((o) => text(optionalRecord(o).key)).filter(Boolean);
          return <li key={text(cap.id)} className="capability">
            <div className="capability-head">
              <h3>{text(cap.title)}</h3>
              <span className="capability-tags">
                {text(cap.analysis) && <span className="tag">{ANALYSIS_KINDS[text(cap.analysis)] || text(cap.analysis)}</span>}
                <span className={`tag ${isBenchmarked(text(validation.level)) ? "tag-good" : ""}`}>{text(validation.level) ? validationLevel(text(validation.level)) : "未声明验证"}</span>
              </span>
            </div>
            <p className="capability-meta"><code>{text(cap.id)}</code>{text(cap.method_version) && <span>{text(cap.method_version)}</span>}{!!outputs.length && <span>输出 {outputs.length} 项</span>}</p>
            {!!cases.length && <details><summary>参考算例 {cases.length}</summary><ul>{cases.map((c) => <li key={c}>{c}</li>)}</ul></details>}
            {!!limits.length && <details><summary>适用范围 {limits.length}</summary><ul>{limits.map((c) => <li key={c}>{c}</li>)}</ul></details>}
          </li>;
        })}
      </ol>
    </section>

    {!!studies.length && <section className="plugin-section">
      <h2>使用它的研究</h2>
      <ul className="plugin-usage">{studies.map((study) => <li key={study.id}><Link to="/studies" search={{ theme, workspace: study.workspace }}>{study.title}</Link></li>)}</ul>
    </section>}

    <section className="plugin-section plugin-trust">
      <h2>可信与追溯</h2>
      <p>每次运行都记录该插件的版本与发行封签{text(method.release_digest) ? `（${text(method.release_digest).slice(0, 12)}…）` : ""}；封签与清单不一致时宿主拒绝执行。插件只给出结果，批准由人完成。</p>
      <Button size="compact" onClick={() => downloadJson({ method, execution_policy: policy, validation: caps.map((cap) => ({ capability: cap.id, ...optionalRecord(cap.validation) })) }, "plugin-evidence.json")}>下载验证证据与发行摘要</Button>
    </section>
  </article>;
}
