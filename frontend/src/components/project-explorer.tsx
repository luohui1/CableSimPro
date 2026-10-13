import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { StudyRow } from "@/api/research";
import { deliveries } from "@/api/delivery";
import { optionalRecord, text } from "@/api/client";
import { projectStudiesQuery, methodCardsQuery } from '@/lib/study-queries';
import { entityLabel, type DomainDocument } from "@/lib/domain-fields";
import { significantNumber, formatDateTime } from "@/lib/format";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { Icon } from "./icon";
import { driverViews } from "./study-workbench-config";
import {StatusMark} from './status-mark';
import {studyPresentation, type StudyPresentation} from './study-status';
import './workbench-inspector.css';

type Theme = "light" | "dark";
type Plugin = Record<string, unknown>;

/** 计算的图标与类型名：驱动方式（选型、扫描、批量、对比）由宿主决定，单次计算按插件声明的分析类型与运行位置。 */
export function calculationKind(study: StudyRow, catalog: Plugin[]) {
  const kind = text(optionalRecord(study.definition.driver).kind);
  const pin = optionalRecord(study.definition.method);
  const plugin = catalog.find((row) => text(optionalRecord(row.method).plugin_id) === text(pin.plugin_id));
  const capability = (Array.isArray(plugin?.capabilities) ? plugin!.capabilities : []).map(optionalRecord).find((cap) => text(cap.id) === text(pin.capability));
  const hpc = text(optionalRecord(plugin?.execution_policy).backend) === "slurm";
  const icon = driverViews[kind]?.icon || (hpc || text(capability?.analysis) === "transient" ? "calc/thermal-field" : text(capability?.analysis) === "geometry" ? "object/section" : "calc/ampacity");
  // 能力标题里的括注（标准条款、适用场景）留给方法页，列表只用主名
  return { icon, label: driverViews[kind]?.label || study.task,
    methodName: text(plugin?.name) || text(pin.plugin_id), hpc };
}

/** 运行状态：来自运行摘要，不读结果正文。有插件声明的关键结论时直接显示答案（如允许电流），否则显示状态点。 */
function RunDot({ study, state }: { study: StudyRow; state?: StudyPresentation }) {
  const latest = optionalRecord(study.raw.latest_run);
  const shown = state || studyPresentation(study, latest.id ? latest : undefined);
  return <span className="explorer-state" title={shown.reason}><StatusMark kind={shown.mark} label={shown.label} /></span>;
}

/**
 * 单次计算：只有一个工况，单工况的试算才能代表这个研究。宿主的关键结论已按驱动方式投影
 * （选型取推荐候选，扫描、批量、对比不跨样本聚合），列表直接显示返回的结论。
 */
export const singleAnswer = (study: StudyRow) => !study.definition.driver?.kind || study.definition.driver.kind === "single";

/** 关键结论文字：数值 + 显示单位；多于一项时带名称（提示与表格）。 */
export function headlineText(value: unknown, limit = 3): string {
  return (Array.isArray(value) ? value : []).map(optionalRecord).filter((row) => typeof row.display_value === "number").slice(0, limit)
    .map((row) => `${limit > 1 ? text(row.title) + " " : ""}${significantNumber(row.display_value as number, 4)}${text(row.display_unit) ? " " + text(row.display_unit) : ""}`).join(" · ");
}

function Section({ icon, title, count, children, expanded, onToggle }: { icon: string; title: string; count?: number; children: ReactNode; expanded?: boolean; onToggle?: () => void }) {
  return <section className="explorer-section" aria-label={title}>
    <h3><Icon name={icon} />{onToggle ? <button type="button" className="explorer-group-toggle" aria-expanded={expanded} onClick={onToggle} aria-label={`${expanded ? '收起' : '展开'}${title}`}>{title}</button> : title}{count !== undefined && <span>{count}</span>}</h3>
    <div className="explorer-items">{children}</div>
  </section>;
}

/**
 * 工程浏览器：侧栏右侧的第二层，只列本工程真实存在的对象。
 * 模型 = 工程模型里的敷设截面、电缆、负荷工况；研究 = 本工程的研究；交付 = 已封存的计算书。
 */
export function ProjectExplorer({ workspaceId, projectName, document, modelLabel = '模型', activeStudy, activeRow, activeState, view, theme, onCreate }: {
  workspaceId: string; projectName: string; document?: DomainDocument; modelLabel?: string; activeStudy: string; activeRow?: StudyRow; activeState?: StudyPresentation; view: string; theme: Theme; onCreate: () => void;
}) {
  const [studiesExpanded,setStudiesExpanded] = useState(!activeRow);
  const [booksExpanded,setBooksExpanded] = useState(false);
  const studies = useQuery({...projectStudiesQuery(workspaceId),enabled:studiesExpanded || !activeRow});
  const catalog = useQuery(methodCardsQuery());
  const books = useQuery({ queryKey: ["deliveries", workspaceId], queryFn: ({ signal }) => deliveries(workspaceId, signal),enabled:booksExpanded });
  const rows = (studiesExpanded ? studies.data || (activeRow ? [activeRow] : []) : activeRow ? [activeRow] : studies.data || []).filter((row) => row.workspace === workspaceId);
  const current = activeRow || rows.find((row) => row.id === activeStudy) || rows[0];
  const plugins = (catalog.data || []).map(optionalRecord);
  const at = (study: StudyRow, module: string, tab: string, extra: Record<string, string> = {}) => ({
    to: "/studies/$sid/$module/$tab" as const, params: { sid: study.id, module, tab },
    search: { workspace: study.workspace, theme, run: "", delivery: "", ...extra },
  });
  const calc = current ? rootModule(current.definition) : "";
  const head = projectName.split(" · ")[0];
  return <nav className="project-explorer" aria-label="工程浏览器">
    <header>
      <strong title={projectName}>{projectName}</strong>
    </header>
    {current && document && <Section icon="object/overview" title={modelLabel}>
      {document.sections.map((section) => <Link key={section.id} className="explorer-item" {...at(current, calc, studyEntryTab(calc), { view: "section" })} aria-current={view === "section" ? "true" : undefined}>
        <Icon name="object/section" /><span>{section.label || "敷设截面"}</span>
      </Link>)}
      {document.cable_types.map((cable) => <Link key={cable.id} className="explorer-item" {...at(current, calc, studyEntryTab(calc), { view: "cable" })} aria-current={view === "cable" ? "true" : undefined}>
        <Icon name="object/cable" /><span>{cable.label}</span>
      </Link>)}
      {document.load_cases.map((load) => <a key={load.id} className="explorer-item" href="#inspector-conditions"><Icon name="object/conditions" /><span>{entityLabel(document, load.id)}</span></a>)}
    </Section>}
    <Section icon="calc/ampacity" title="研究" count={studies.data?.length} expanded={studiesExpanded} onToggle={()=>setStudiesExpanded(value=>!value)}>
      {studiesExpanded && studies.isFetching && <span role="status">正在读取本工程研究</span>}
      {studiesExpanded && studies.error && <button type="button" onClick={()=>void studies.refetch()}>研究列表读取失败 · 重试</button>}
      {rows.map((study) => {
        const module = rootModule(study.definition), kind = calculationKind(study, plugins);
        const name = head && study.title.startsWith(head + " · ") ? study.title.slice(head.length + 3) : study.title;
        return <Link key={study.id} className="explorer-item explorer-calc" {...at(study, module, studyEntryTab(module))} aria-current={study.id === activeStudy ? "page" : undefined} title={study.title}>
          <Icon name={kind.icon} /><span className="explorer-study-name"><b>{name}</b><small>{kind.label}{kind.hpc ? " · 超算" : ""}</small></span><RunDot study={study} state={study.id===activeStudy ? activeState : undefined} />
        </Link>;
      })}
      <button type="button" className="explorer-item explorer-add" onClick={onCreate}><Icon name="action/add" /><span>新建研究</span></button>
    </Section>
    {current && <Section icon="object/delivery" title="交付" count={books.data?.length} expanded={booksExpanded} onToggle={()=>setBooksExpanded(value=>!value)}>
      {booksExpanded && books.isFetching && <span role="status">正在读取交付列表</span>}
      {booksExpanded && books.error && <button type="button" onClick={()=>void books.refetch()}>交付列表读取失败 · 重试</button>}
      {(booksExpanded ? books.data || [] : []).map((book) => <Link key={book.id} className="explorer-item" {...at(current, "report", "preview", { delivery: book.id })}>
        <Icon name="result/report" /><span><b>{book.kind === "specification" ? "规格书" : "计算书"} 第 {book.version} 版</b><small>{formatDateTime(book.created)}</small></span>
      </Link>)}
      <Link className="explorer-item explorer-add" {...at(current, "report", "content")}><Icon name="result/report" /><span>计算书内容</span></Link>
    </Section>}
  </nav>;
}
