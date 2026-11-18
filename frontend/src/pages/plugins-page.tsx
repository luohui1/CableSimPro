import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { studyIndex } from "@/api/research";
import { pluginCatalogQuery } from '@/lib/catalog-queries';
import { message, optionalRecord, text } from "@/api/client";
import { objectRelations, type ObjectCard, type ValidationMetric } from "@/api/object-index";
import { downloadJson } from "@/lib/download";
import { pluginArt } from "@/lib/illustrations";
import { ANALYSIS_KINDS, isBenchmarked, validationLevel } from "@/lib/plugin-labels";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { EmptyState, ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { DataTable } from "@/components/data-table";
import { ObjectLink, statusMark } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { METRIC_STATES, quantityLabel, percentText } from "@/lib/validation-labels";
import { displayUnit } from "@/lib/display-names";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { RelationPanel } from "@/components/relation-panel";
import { SolverLocation } from '@/components/solver-location';
import type { SolverCapability } from '@/lib/solver-location';
import { statusLabel } from '@/lib/status-vocabulary';

type Row = Record<string, unknown>;

/** 清单说明多是逐条拼接的：收掉“。；”这类重复标点，标准号与年份之间补空格（IEC60853 → IEC 60853）。 */
const prose = (value: string) => value.replace(/[。．.]\s*；/g, "；").replace(/；\s*；/g, "；").replace(/\b(IEC|GB\/T|GB)(\d)/g, "$1 $2").replaceAll('COMSOL/ACDC/HEATTRANSFER', 'COMSOL 交流/直流模块与传热模块').replace(/\breference_only\b/g, '仅供参考').replace(/\bx_p\b/g, 'xₚ');
/** 测试文件位置是追溯信息：原文保留在悬停，不占图的正文说明。 */
const figureCaption = (value: string) => !value.trim() ? '' : prose(value).replace(/\s*\btest_[A-Za-z0-9_]+\.py(?::[\d–—-]+)?[。.]?/g, '').trim().replace(/[；;]$/, '。') || '测试记录';

/** 插件类别：以清单 presentation.category 为准；早期清单没有声明时按分析类型与运行位置推断。 */
const CATEGORIES: [string, string][] = [["calculation", "计算方法"], ["modeling", "建模"], ["simulation", "仿真"], ["data-standard", "数据与标准"], ["report", "报告"], ["agent-skill", "Agent 技能"]];
function pluginGroup(row: Row): string {
  const declared = text(optionalRecord(row.presentation).category);
  if (CATEGORIES.some(([id]) => id === declared)) return declared;
  const analyses = (Array.isArray(row.capabilities) ? row.capabilities : []).map((cap) => text(optionalRecord(cap).analysis));
  if (analyses.some((kind) => kind === "extraction" || kind === "standard_check")) return "data-standard";
  if (text(optionalRecord(row.execution_policy).backend) === "slurm" || analyses.some((kind) => kind === "mesh" || kind === "frequency_domain" || kind === "postprocess")) return "simulation";
  if (analyses.length && analyses.every((kind) => kind === "geometry")) return "modeling";
  return "calculation";
}
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const pluginId = (row: Row) => text(optionalRecord(row.method).plugin_id);
/** 插件封签内的展示资源（封面、方法图、验证图），由宿主核验摘要后提供。 */
const resource = (row: Row, role: string) => list(row.resources).map(optionalRecord).find((item) => text(item.role) === role);

/** 图内文字随缩略图缩小；阅读窗口使用同一封签资源，独立滚动，不更改图或其来源。 */
function PluginFigure({ figure }: { figure: Row }) {
  const title = text(figure.title) || "插件示意图";
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState("1");
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const image = useRef<HTMLImageElement>(null);

  async function decoded(target: HTMLImageElement) {
    try {
      await target.decode();
      if (target === image.current && target.isConnected)
        setImageState(target.complete && target.naturalWidth > 0 && target.naturalHeight > 0 ? "ready" : "error");
    } catch {
      if (target === image.current && target.isConnected) setImageState("error");
    }
  }

  return <figure className="plugin-figure">
    <img src={text(figure.url)} alt={title} />
    <figcaption title={text(figure.description)}><b>{title}</b>{figureCaption(text(figure.description))}</figcaption>
    <Dialog open={open} onOpenChange={(next) => {
      if (next) { setZoom("1"); setImageState("loading"); }
      setOpen(next);
    }}>
      <DialogTrigger asChild><Button size="compact" className="plugin-figure-open">放大阅读</Button></DialogTrigger>
      <DialogContent className="plugin-figure-dialog">
        <header className="plugin-figure-header">
          <div>
            <DialogTitle className="dialog-title">{title}</DialogTitle>
            <DialogDescription className="plugin-figure-help">滚动查看完整图片；按 Esc 返回。</DialogDescription>
          </div>
          <DialogClose asChild><Button size="compact">关闭</Button></DialogClose>
        </header>
        <div className="plugin-figure-toolbar">
          <Select label="阅读大小" value={zoom} onChange={setZoom} options={[
            { value: "1", label: "标准大小" }, { value: "1.5", label: "放大1.5倍" },
            { value: "2", label: "放大2倍" }, { value: "3", label: "放大3倍" },
          ]} />
          <p className="plugin-figure-status" role="status">{imageState === "loading" ? "正在读取图片" : imageState === "error" ? "图片读取失败" : "图片已载入"}</p>
        </div>
        <div className="plugin-figure-scroll" role="region" aria-label={`${title}大图`} tabIndex={0} data-zoom={zoom} aria-busy={imageState === "loading"}>
          {imageState === "error" && <div className="plugin-figure-error">
            <p role="alert">图片未能读取，请重试。</p>
            <Button size="compact" onClick={() => { setImageState("loading"); setAttempt((value) => value + 1); }}>重新读取图片</Button>
          </div>}
          <img key={attempt} ref={image} className="plugin-figure-reading-image" data-state={imageState}
            src={text(figure.url)} alt={title} onLoad={(event) => void decoded(event.currentTarget)} onError={() => setImageState("error")} />
        </div>
      </DialogContent>
    </Dialog>
  </figure>;
}

const FILE_INSTALL_UNAVAILABLE_REASON = "本版本暂不支持从文件安装插件；插件随软件发布，更新软件即可获得新版本";

/** 插件：左侧按领域分组的已安装插件，右侧逐项剖析选中插件（能力、验证、范围、运行策略、被谁使用）。 */
export function PluginsPage() {
  const catalog = useQuery(pluginCatalogQuery());
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const { theme } = usePageTheme();
  const { pid } = useParams({ strict: false }) as { pid?: string };
  const rows = (catalog.data || []) as Row[];
  const groups: [string, Row[]][] = CATEGORIES.map(([id, label]) => [text(optionalRecord(rows.find((row) => pluginGroup(row) === id)?.presentation).category_title) || label, rows.filter((row) => pluginGroup(row) === id)] as [string, Row[]]).filter(([, items]) => items.length);
  const selected = rows.find((row) => pluginId(row) === pid) || groups[0]?.[1][0];

  return (
    <CatalogShell title="插件" status={<span className="muted">已安装 {rows.length} 个 · 计算方法全部来自插件</span>}
      actions={<Tooltip content={FILE_INSTALL_UNAVAILABLE_REASON}>
        <span role="note" tabIndex={0} aria-label={`从文件安装不可用：${FILE_INSTALL_UNAVAILABLE_REASON}`}>
          <Button size="compact" disabled>从文件安装</Button>
        </span>
      </Tooltip>}>
      <div data-page={pid ? "plugin-detail" : "plugins"} className="plugins-page">
        <QueryState query={catalog} empty={!rows.length && "尚无已安装插件"}>
          <nav className="plugin-list" aria-label="已安装插件">
            {groups.map(([label, items]) => <section key={label}>
              <h2>{label}</h2>
              {items.map((row) => {
                const id = pluginId(row);
                const art = text(resource(row, "cover")?.url) || pluginArt(id);
                return <Link key={id} className="plugin-item" to="/plugins/$pid" params={{ pid: id }} search={{ theme }} aria-current={row === selected ? "page" : undefined}>
                  {art ? <img src={art} alt="" /> : <span className="plugin-item-art" />}
                  <span className="plugin-item-text"><b>{text(row.name)}</b><span>{text(optionalRecord(row.method).version)} · {list(row.capabilities).length} 项能力</span></span>
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

/** 一条关键结果：“情形：量 偏差”，比较状态另起一段弱化显示；有相对偏差用百分数，否则用差值。 */
function MetricLine({ metric }: { metric: ValidationMetric }) {
  const deviation = typeof metric.relative_difference_percent === "number" ? percentText(metric.relative_difference_percent)
    : typeof metric.difference === "number" ? `${metric.difference > 0 ? "+" : metric.difference < 0 ? "−" : ""}${Math.abs(Number(metric.difference.toPrecision(3)))} ${displayUnit(metric.unit || "")}`.trim() : "";
  return <li><span>{metric.variant}：{quantityLabel(metric.quantity)} {deviation}</span> <span className="muted">{METRIC_STATES[metric.status] || metric.status}</span></li>;
}

/**
 * 插件 › 验证：用这个插件复现过的公开算例（来自复现库，统一索引的 plugin → validation 关联）。
 * 部分复现、超出容差、口径不可比照原样显示；清单声明只计数，逐条见“能力”页签。
 */
function PluginValidation({ pluginId }: { pluginId: string }) {
  const relations = useQuery({ queryKey: ["object-relations", "plugin", pluginId], queryFn: ({ signal }) => objectRelations("plugin", pluginId, signal) });
  if (relations.isPending) return <LoadingState title="正在读取验证证据" />;
  if (relations.error) return <ErrorState title="验证证据读取失败" description={message(relations.error)} action={<Button size="compact" onClick={() => void relations.refetch()}>重新读取</Button>} />;
  const rows = relations.data.uses.filter((row) => row.role === "validation");
  const reproduced = rows.filter((row) => row.target.subtype === "reproduced").map((row) => row.target as ObjectCard & { id: string });
  const declared = rows.length - reproduced.length;
  const missing = relations.data.unresolved.filter((row) => row.role === "validation");
  return <section className="object-section" aria-label="公开算例复现">
    <header><h2>公开算例复现</h2><span className="muted">{reproduced.length} 个算例{declared ? ` · 清单另声明 ${declared} 项，见“能力”` : ""}</span></header>
    {reproduced.length ? <DataTable<ObjectCard & { id: string }> label="公开算例复现" showGroups={false} rowLabel={(row) => row.name}
      groups={[{ id: "reproduced", label: "复现", rows: reproduced }]}
      columns={[
        { id: "name", label: "算例", wrap: true, render: (row) => <ObjectLink card={row} /> },
        { id: "status", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={statusLabel(row.status.code, row.status.label)} detail={row.status.reason || undefined} /> },
        { id: "metrics", label: "关键结果", wrap: true, render: (row) => {
          const evidence = row.validation;
          if (!evidence?.metrics.length) return "没有保存的量值";
          return <ul className="metric-lines">{evidence.metrics.map((metric) => <MetricLine key={metric.id} metric={metric} />)}
            {evidence.total_metrics > evidence.metrics.length && <li className="muted">共 {evidence.total_metrics} 项，其余在算例页</li>}</ul>;
        } },
        { id: "convergence", label: "收敛", render: (row) => row.validation?.convergence_passed === true ? "通过" : row.validation?.convergence_passed === false ? "未通过" : "无记录" },
      ]} />
      : <InlineEmpty title="还没有用这个插件复现的公开算例" />}
    {missing.map((row, index) => <ErrorState key={index} title="复现证据不可用" description={row.reason} />)}
  </section>;
}

function PluginDetail({ row, studies, theme }: { row: Row; studies: { id: string; title: string; workspace: string; definition: unknown }[]; theme: "light" | "dark" }) {
  const id = pluginId(row);
  const method = optionalRecord(row.method);
  const policy = optionalRecord(row.execution_policy);
  const caps = list(row.capabilities).map(optionalRecord);
  const platforms = list(row.platforms).map(text).map((p) => p.replace("windows", "Windows").replace("linux", "Linux").replace("darwin", "macOS").replace("-x64", " x64").replace("-arm64", " arm64"));
  const art = text(resource(row, "cover")?.url) || pluginArt(id);
  const figure = resource(row, "method"), validationFigure = resource(row, "validation");
  const presentation = optionalRecord(row.presentation);
  const enforced = [policy.timeout_enforced && "强制超时", policy.parent_death_enforced && "宿主退出即终止", policy.process_tree_cleanup_enforced && "清理子进程", policy.memory_limit_enforced && "内存上限", policy.network_isolation_enforced && "断网运行"].filter(Boolean) as string[];
  const levels = caps.map((cap) => text(optionalRecord(cap.validation).level)).filter(Boolean);
  const best = levels.find(isBenchmarked) || levels[0];
  // 详情页模板（§2.4）：页头 → 页签 → 正文与右侧名片；运行约束、平台、插件 ID、封签放进“技术信息”
  return <article className="plugin-detail" aria-label={text(row.name)}>
    <header className="plugin-hero">
      {art && <img src={art} alt="" />}
      <div>
        <h1>{text(row.name)}<span className="muted">{text(method.version)}</span>{text(presentation.category_title) && <span className="tag">{text(presentation.category_title)}</span>}</h1>
              <p className="plugin-description" title={text(row.description)}>{prose(text(row.description))}</p>
      </div>
    </header>
    <div className="detail-body">
      <Tabs defaultValue="method" className="detail-tabs">
        <TabsList aria-label="插件详情">
          <TabsTrigger value="method">方法</TabsTrigger>
          <TabsTrigger value="capabilities">能力 {caps.length}</TabsTrigger>
          <TabsTrigger value="validation">验证</TabsTrigger>
          <TabsTrigger value="usage">关联</TabsTrigger>
          <TabsTrigger value="technical">技术信息</TabsTrigger>
        </TabsList>
        <TabsContent value="method" className="plugin-section">
          {figure ? <PluginFigure key={text(figure.url)} figure={figure} />
            : <InlineEmpty title="插件没有提供方法示意图。" />}
        </TabsContent>
        <TabsContent value="capabilities" className="plugin-section">
          <ol className="capability-list">
            {caps.map((cap) => {
              const validation = optionalRecord(cap.validation);
              const cases = list(validation.cases).map(text).filter(Boolean);
              const limits = list(cap.limitations).map(text).filter(Boolean);
              const outputs = list(cap.outputs).map((o) => text(optionalRecord(o).key)).filter(Boolean);
              const parameters = Object.values(optionalRecord(optionalRecord(cap.parameter_schema).properties)).map(optionalRecord);
              const basic = parameters.filter((item) => !item["x-level"] || item["x-level"] === "basic").length;
              const headlines = list(cap["x-headline"]).map(optionalRecord);
              return <li key={text(cap.id)} className="capability">
                <div className="capability-head">
                  <h3>{text(cap.title)}</h3>
                  <span className="capability-tags">
                    {text(cap.analysis) && <span className="tag">{ANALYSIS_KINDS[text(cap.analysis)] || text(cap.analysis)}</span>}
                    {cap.preview === true && <span className="tag">支持试算</span>}
                    <span className={`tag ${isBenchmarked(text(validation.level)) ? "tag-good" : ""}`}>{text(validation.level) ? validationLevel(text(validation.level)) : "未声明验证"}</span>
                  </span>
                </div>
                <SolverLocation pluginId={id} capability={cap as SolverCapability} />
                {text(cap.description) && <p className="capability-description" title={text(cap.description)}>{prose(text(cap.description))}</p>}
                {!!headlines.length && <p className="capability-headlines"><span className="muted">关键结论</span>{headlines.map((item) => <span key={text(item.key)}>{text(item.title)}{text(optionalRecord(item.unit).display) && ` / ${text(optionalRecord(item.unit).display)}`}</span>)}</p>}
                <p className="capability-meta">{!!outputs.length && <span>输出 {outputs.length} 项</span>}{!!parameters.length && <span>参数 {parameters.length} 项（常用 {basic}）</span>}</p>
                {!!cases.length && <details><summary>参考算例 {cases.length}</summary><ul>{cases.map((c) => <li key={c}>{c}</li>)}</ul></details>}
                {!!limits.length && <details><summary>适用范围 {limits.length}</summary><ul>{limits.map((c) => <li key={c}>{prose(c)}</li>)}</ul></details>}
              </li>;
            })}
          </ol>
        </TabsContent>
        <TabsContent value="validation" className="plugin-section">
          {validationFigure && <PluginFigure key={text(validationFigure.url)} figure={validationFigure} />}
          {text(presentation.validation_note) && <p className="muted">{text(presentation.validation_note)}</p>}
          <PluginValidation pluginId={id} />
          <Link className="detail-link" to="/validation" search={{ theme, snapshot: "" }}>全部验证算例</Link>
        </TabsContent>
        <TabsContent value="usage" className="plugin-section">
          {/* 关联来自统一索引：用这个插件的研究，以及它的验证证据 */}
          <RelationPanel kind="plugin" id={id} hideRoles={["validation"]} />
        </TabsContent>
        <TabsContent value="technical" className="plugin-section">
          <dl className="detail-meta">
            <div><dt>插件标识</dt><dd><code>{id}</code></dd></div>
            <div><dt>版本</dt><dd>{text(method.version)}</dd></div>
            <div><dt>发行封签</dt><dd><code>{text(method.release_digest).slice(0, 16) || "—"}</code></dd></div>
            <div><dt>运行约束</dt><dd>{enforced.length ? enforced.join("、") : "—"}</dd></div>
            <div><dt>平台</dt><dd>{platforms.join("、") || "—"}</dd></div>
            <div><dt>能力标识</dt><dd>{caps.map((cap) => <code key={text(cap.id)}>{text(cap.id)}</code>)}</dd></div>
          </dl>
          <p className="muted">每次运行都记录插件版本与发行封签；封签与清单不一致时宿主拒绝执行。插件只给出结果，批准由人完成。</p>
          <Button size="compact" onClick={() => downloadJson({ method, execution_policy: policy, validation: caps.map((cap) => ({ capability: cap.id, ...optionalRecord(cap.validation) })) }, "plugin-evidence.json")}>下载验证证据与发行摘要</Button>
        </TabsContent>
      </Tabs>
      <dl className="detail-card" aria-label="名片">
        <div><dt>求解位置</dt><dd>按能力显示，见“能力”</dd></div>
        <div><dt>验证等级</dt><dd>{best ? validationLevel(best) : "未声明"}</dd></div>
        <div><dt>能力</dt><dd>{caps.length} 项</dd></div>
        <div><dt>被研究使用</dt><dd>{studies.length} 项</dd></div>
      </dl>
    </div>
  </article>;
}
