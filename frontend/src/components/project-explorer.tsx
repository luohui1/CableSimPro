import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { methodCatalog, studyIndex, studyRuns, typeIndex, workspaces, type StudyRow } from "@/api/research";
import { deliveries } from "@/api/delivery";
import { optionalRecord, text } from "@/api/client";
import { entityLabel, type DomainDocument } from "@/lib/domain-fields";
import { formatNumber } from "@/lib/format";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { Icon } from "./icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

type Theme = "light" | "dark";
type Plugin = Record<string, unknown>;

/** 计算的图标与类型名：驱动方式（选型、扫描、批量、对比）由宿主决定，单次计算按插件声明的分析类型与运行位置。 */
export function calculationKind(study: StudyRow, catalog: Plugin[]) {
  const kind = text(optionalRecord(study.definition.driver).kind);
  const pin = optionalRecord(study.definition.method);
  const plugin = catalog.find((row) => text(optionalRecord(row.method).plugin_id) === text(pin.plugin_id));
  const capability = (Array.isArray(plugin?.capabilities) ? plugin!.capabilities : []).map(optionalRecord).find((cap) => text(cap.id) === text(pin.capability));
  const hpc = text(optionalRecord(plugin?.execution_policy).backend) === "slurm";
  const icon = kind === "selection" ? "calc/selection" : kind === "sweep" ? "calc/sweep" : kind === "batch" ? "nav/simulation" : kind === "crosscheck" ? "module/method-compare"
    : hpc || text(capability?.analysis) === "transient" ? "calc/thermal-field" : text(capability?.analysis) === "geometry" ? "object/section" : "calc/ampacity";
  // 能力标题里的括注（标准条款、适用场景）留给方法页，列表只用主名
  return { icon, label: (text(capability?.title) || study.task).replace(/\s*[（(][^（）()]*[）)]\s*$/, ""), hpc };
}

/** 运行状态：来自运行摘要，不读结果正文。有插件声明的关键结论时直接显示答案（如允许电流），否则显示状态点。 */
function RunDot({ study }: { study: StudyRow }) {
  const runs = useQuery({ queryKey: ["runs", study.workspace, study.id, "summary"], queryFn: ({ signal }) => studyRuns(study.workspace, study.id, signal, "summary") });
  const latest = runs.data?.at(-1), status = text(latest?.status);
  const kind = ["succeeded", "partial"].includes(status) ? "is-ok" : ["failed", "rejected", "cancelled"].includes(status) ? "is-error" : status ? "is-running" : "is-off";
  const answer = kind === "is-ok" && latest?.freshness !== "historical" && singleAnswer(study) ? headlineText(latest?.headlines, 1) : "";
  if (answer) return <span className="explorer-answer" title={headlineText(latest?.headlines)}>{answer}</span>;
  return <span className={`status-dot ${kind}`} title={kind === "is-ok" ? "已有结果" : kind === "is-error" ? "运行失败" : kind === "is-running" ? "运行中" : "未运行"} />;
}

/**
 * 关键结论只对单次计算显示：选型、扫描、批量、对比的运行包含多个候选或样本，
 * 宿主跨工况取极值并不是这个研究的答案（选型的答案是推荐候选）。
 */
export const singleAnswer = (study: StudyRow) => !study.definition.driver?.kind || study.definition.driver.kind === "single";

/** 关键结论文字：数值 + 显示单位；多于一项时带名称（提示与表格）。 */
export function headlineText(value: unknown, limit = 3): string {
  return (Array.isArray(value) ? value : []).map(optionalRecord).filter((row) => typeof row.display_value === "number").slice(0, limit)
    .map((row) => `${limit > 1 ? text(row.title) + " " : ""}${formatNumber(row.display_value as number, 4)}${text(row.display_unit) ? " " + text(row.display_unit) : ""}`).join(" · ");
}

function Section({ icon, title, count, children }: { icon: string; title: string; count?: number; children: ReactNode }) {
  return <section className="explorer-section" aria-label={title}>
    <h3><Icon name={icon} />{title}{count !== undefined && <span>{count}</span>}</h3>
    <div className="explorer-items">{children}</div>
  </section>;
}

/**
 * 工程浏览器：侧栏右侧的第二层，只列本工程真实存在的对象。
 * 模型 = 工程模型里的敷设截面、电缆、负荷工况；研究 = 本工程的研究；交付 = 已封存的计算书。
 */
export function ProjectExplorer({ workspaceId, projectName, document, activeStudy, view, theme, onCreate }: {
  workspaceId: string; projectName: string; document?: DomainDocument; activeStudy: string; view: string; theme: Theme; onCreate: () => void;
}) {
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const books = useQuery({ queryKey: ["deliveries", workspaceId], queryFn: ({ signal }) => deliveries(workspaceId, signal) });
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const types = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal) });
  const typeIds = new Set((types.data || []).map((row) => text(row.id)));
  const navigate = useNavigate();
  const rows = (studies.data || []).filter((row) => row.workspace === workspaceId);
  // 切换工程：打开该工程最近的计算；没有计算的工程打开工程页
  const openProject = (id: string) => {
    const entry = (studies.data || []).find((row) => row.workspace === id);
    if (!entry) return void navigate({ to: "/studies", search: { theme, workspace: id } });
    const module = rootModule(entry.definition);
    void navigate({ to: "/studies/$sid/$module/$tab", params: { sid: entry.id, module, tab: studyEntryTab(module) }, search: { workspace: id, theme, run: "", delivery: "" } });
  };
  const current = rows.find((row) => row.id === activeStudy) || rows[0];
  const plugins = (catalog.data || []).map(optionalRecord);
  const at = (study: StudyRow, module: string, tab: string, extra: Record<string, string> = {}) => ({
    to: "/studies/$sid/$module/$tab" as const, params: { sid: study.id, module, tab },
    search: { workspace: study.workspace, theme, run: "", delivery: "", ...extra },
  });
  const calc = current ? rootModule(current.definition) : "";
  const head = projectName.split(" · ")[0];
  return <nav className="project-explorer" aria-label="工程浏览器">
    <header>
      <span className="explorer-kicker"><Icon name="object/folder" />工程</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="explorer-switch" title="切换工程"><strong>{projectName}</strong><Icon name="action/chevrons-up-down" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(projects.data || []).filter((row) => !typeIds.has(text(row.id))).map((row) => <DropdownMenuItem key={text(row.id)} onSelect={() => openProject(text(row.id))}>{text(row.name)}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {current && document && <Section icon="object/overview" title="模型">
      {document.sections.map((section) => <Link key={section.id} className="explorer-item" {...at(current, calc, studyEntryTab(calc), { view: "section" })} aria-current={view === "section" ? "true" : undefined}>
        <Icon name="object/section" /><span>{section.label || "敷设截面"}</span>
      </Link>)}
      {document.cable_types.map((cable) => <Link key={cable.id} className="explorer-item" {...at(current, calc, studyEntryTab(calc), { view: "cable" })} aria-current={view === "cable" ? "true" : undefined}>
        <Icon name="object/cable" /><span>{cable.label}</span>
      </Link>)}
      {document.load_cases.map((load) => <a key={load.id} className="explorer-item" href="#inspector-conditions"><Icon name="object/conditions" /><span>{entityLabel(document, load.id)}</span></a>)}
    </Section>}
    <Section icon="calc/ampacity" title="研究" count={rows.length}>
      {rows.map((study) => {
        const module = rootModule(study.definition), kind = calculationKind(study, plugins);
        const name = head && study.title.startsWith(head + " · ") ? study.title.slice(head.length + 3) : study.title;
        return <Link key={study.id} className="explorer-item explorer-calc" {...at(study, module, studyEntryTab(module))} aria-current={study.id === activeStudy ? "page" : undefined} title={study.title}>
          <Icon name={kind.icon} /><span><b>{name}</b><small>{study.task || kind.label}{kind.hpc ? " · 超算" : ""}</small></span><RunDot study={study} />
        </Link>;
      })}
      <button type="button" className="explorer-item explorer-add" onClick={onCreate}><Icon name="action/add" /><span>新建研究</span></button>
    </Section>
    {current && <Section icon="object/delivery" title="交付" count={books.data?.length}>
      {(books.data || []).map((book) => <Link key={book.id} className="explorer-item" {...at(current, "report", "preview", { delivery: book.id })}>
        <Icon name="result/report" /><span><b>{book.kind === "specification" ? "规格书" : "计算书"} 第 {book.version} 版</b><small>{new Date(book.created).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span>
      </Link>)}
      <Link className="explorer-item explorer-add" {...at(current, "report", "content")}><Icon name="action/add" /><span>{books.data?.length ? "生成新版计算书" : "生成计算书"}</span></Link>
    </Section>}
  </nav>;
}
