import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { methodCatalog, studyIndex, studyRuns, typeIndex, workspaces, type StudyRow } from "@/api/research";
import { message, optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { Conclusion } from "@/components/conclusion";
import { CreateStudyDialog } from "@/components/create-study-dialog";
import { DataTable, type Column } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { calculationKind, ProjectExplorer } from "@/components/project-explorer";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusMark, type StatusKind } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AgentPanel } from "@/features/agent/agent-panel";
import { CableSection } from "@/features/drawing/cable-section";
import { LayingSection } from "@/features/drawing/laying-section";
import { entityLabel, type DomainDocument } from "@/lib/domain-fields";
import { displayName } from "@/lib/display-names";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { workspaceQuery } from "@/lib/study-queries";
import { isVersionStale } from "@/lib/version-status";

type Theme = "light" | "dark";

const PROJECT_SUGGESTIONS = ["这个工程里哪些研究还没有结果？", "汇总各研究的载流量结论和限制因素", "检查工程模型还缺哪些输入"];

/** 研究名常以工程名开头（“城北变电站 · …”），在工程内部省掉这段前缀。 */
const shortTitle = (title: string, project: string) => {
  const prefix = project.split(" · ")[0] + " · ";
  return title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : title;
};

/** 运行摘要 → 状态标记；只读状态，不读结果正文。 */
function runStatus(run: Record<string, unknown> | undefined, stale: boolean): [StatusKind, string] {
  const status = text(run?.status);
  if (stale || run?.freshness === "historical") return ["historical", "历史结果"];
  if (!run) return ["draft", "未运行"];
  if (["succeeded", "partial"].includes(status)) return ["current", status === "partial" ? "部分成功" : "已有结果"];
  if (["accepted", "queued", "running", "validating"].includes(status)) return ["running", "运行中"];
  return ["error", "失败"];
}

/**
 * 工程首页：与研究工作台同一骨架。命令栏（模型 / 计算 / 交付）、左侧工程浏览器、
 * 中间是工程模型的截面与本工程全部研究，右侧是工程属性与 Agent。
 * 工程模型在研究里编辑（同一份模型，所有研究共用），这里只读展示。
 */
export function ProjectHome({ workspaceId, theme }: { workspaceId: string; theme: Theme }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"section" | "cable">("section");
  const [chosen, setChosen] = useState("");
  const [inspector, setInspector] = useState<"project" | "agent">("project");
  const workspace = useQuery(workspaceQuery(workspaceId));
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const types = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal) });
  const rows = (studies.data || []).filter((row) => row.workspace === workspaceId).sort((a, b) => b.updated.localeCompare(a.updated));
  const runs = useQueries({
    queries: rows.map((row) => ({
      queryKey: ["runs", row.workspace, row.id, "summary"],
      queryFn: ({ signal }: { signal: AbortSignal }) => studyRuns(row.workspace, row.id, signal, "summary"),
      enabled: !isVersionStale(row.raw),
    })),
  });
  const latest = new Map(rows.map((row, index) => [row.id, runs[index]?.data?.at(-1)]));
  const name = text((projects.data || []).find((row) => text(row.id) === workspaceId)?.name) || "工程";
  const isType = (types.data || []).some((row) => text(row.id) === workspaceId);
  const document = workspace.data?.domain as DomainDocument | undefined;
  const reference = optionalRecord(workspace.data?.study_cable_reference);
  const section = document?.sections.find((item) => item.id === chosen) || document?.sections[0];
  const cable = document?.cable_types.find((item) => item.id === chosen) || document?.cable_types[0];
  const done = rows.filter((row) => runStatus(latest.get(row.id), isVersionStale(row.raw))[0] === "current").length;
  const open = (row: StudyRow, extra: Record<string, unknown> = {}) => navigate({
    to: "/studies/$sid/$module/$tab",
    params: { sid: row.id, module: rootModule(row.definition), tab: studyEntryTab(rootModule(row.definition)) },
    search: { workspace: row.workspace, theme, run: "", delivery: "", ...extra },
  });

  const columns: Column<StudyRow>[] = [
    { id: "name", label: "研究", wrap: true, render: (row) => {
      const kind = calculationKind(row, catalog.data || []);
      return <Link className="object-link project-calc" to="/studies/$sid/$module/$tab" params={{ sid: row.id, module: rootModule(row.definition), tab: studyEntryTab(rootModule(row.definition)) }} search={{ workspace: row.workspace, theme, run: "", delivery: "" }}>
        <Icon name={kind.icon} /><span>{shortTitle(row.title, name)}</span>
      </Link>;
    } },
    { id: "kind", label: "任务", render: (row) => row.task || calculationKind(row, catalog.data || []).label },
    { id: "method", label: "插件", wrap: true, render: (row) => `${displayName(text(row.definition.method?.plugin_id))} ${text(row.definition.method?.version)} · ${calculationKind(row, catalog.data || []).hpc ? "超算" : "本机"}` },
    { id: "state", label: "状态", render: (row) => { const [kind, label] = runStatus(latest.get(row.id), isVersionStale(row.raw)); return <StatusMark kind={kind} label={label} />; } },
    { id: "updated", label: "更新", render: (row) => new Date(row.updated).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) },
  ];

  const facts = document ? [
    `${document.sections.length} 个敷设截面`, `${document.cable_types.length} 种电缆`, `${document.load_cases.length} 个工况`,
  ].join(" · ") : "";

  const inspectorPanel = <aside className="workbench-inspector" aria-label="属性">
    <div className="inspector-switch" role="tablist" aria-label="属性分页">
      <button type="button" role="tab" aria-selected={inspector === "project"} onClick={() => setInspector("project")}><Icon name="object/folder" />工程</button>
      <button type="button" role="tab" aria-selected={inspector === "agent"} onClick={() => setInspector("agent")}><Icon name="agent/agent" />Agent</button>
    </div>
    {inspector === "agent" ? <div className="inspector-agent"><AgentPanel key={workspaceId} workspaceId={workspaceId} context={name} suggestions={PROJECT_SUGGESTIONS} /></div> : <>
      <section className="inspector-block" aria-label="工程">
        <header><Icon name="object/folder" /><h2>工程</h2></header>
        <dl className="inspector-list">
          <div><dt>名称</dt><dd>{name}</dd></div>
          <div><dt>模型修订</dt><dd>{workspace.data ? `第 ${String(workspace.data.revision)} 版` : "—"}</dd></div>
          <div><dt>更新</dt><dd>{workspace.data ? new Date(text(workspace.data.updated_at)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div>
          <div><dt>引用型号</dt><dd>{text(reference.name) ? `${text(reference.name)} ${text(reference.version)}` : "—"}</dd></div>
        </dl>
      </section>
      {document && <section className="inspector-block" aria-label="工程模型">
        <header><Icon name="object/section" /><h2>工程模型</h2></header>
        <dl className="inspector-list">
          {document.sections.map((item) => <div key={item.id}><dt>敷设截面</dt><dd>{item.label || entityLabel(document, item.id)}</dd></div>)}
          {document.cable_types.map((item) => <div key={item.id}><dt>电缆</dt><dd>{item.label || entityLabel(document, item.id)}</dd></div>)}
          {document.load_cases.map((item) => <div key={item.id}><dt>工况</dt><dd>{entityLabel(document, item.id)}</dd></div>)}
        </dl>
        <p className="inspector-note">模型由本工程全部研究共用；在任一研究里修改并保存，其他研究的结果会标为待重算。</p>
      </section>}
    </>}
  </aside>;

  const commandBar = <div className="command-bar" role="toolbar" aria-label="工程命令">
    <div className="command-group" role="group" aria-label="模型">
      <span className="command-caption">模型</span>
      <Button size="compact" variant="ghost" disabled={!rows.length} onClick={() => rows[0] && void open(rows[0], { view: "section" })}><Icon name="action/edit" />编辑模型</Button>
    </div>
    <div className="command-group" role="group" aria-label="计算">
      <span className="command-caption">计算</span>
      <Button size="compact" variant="primary" onClick={() => setCreating(true)}><Icon name="action/add" />新建研究</Button>
    </div>
    <div className="command-group" role="group" aria-label="交付">
      <span className="command-caption">交付</span>
      <Button size="compact" variant="ghost" onClick={() => void navigate({ to: "/library/deliveries", search: { theme, workspace: workspaceId, delivery: "" } })}><Icon name="result/report" />交付记录</Button>
    </div>
    <span className="command-state" role="status">{studies.isPending ? "读取中" : `${rows.length} 个研究 · ${done} 个已有结果`}</span>
  </div>;

  const canvas = !document ? null : <section className="workbench-canvas" aria-label="工程模型">
    <div className="workbench-views" role="group" aria-label="模型视图">
      {([["section", "object/section", "敷设截面"], ["cable", "object/cable", "电缆截面"]] as const).map(([value, icon, label]) =>
        <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); setChosen(""); }}><Icon name={icon} />{label}</button>)}
    </div>
    <div className="study-drawing">
      {(view === "cable" ? document.cable_types : document.sections).length > 1 && <Select label={view === "cable" ? "电缆" : "敷设截面"} value={view === "cable" ? cable?.id : section?.id}
        options={(view === "cable" ? document.cable_types : document.sections).map((item) => ({ value: item.id, label: item.label || item.id }))} onChange={setChosen} />}
      {view === "cable"
        ? <CableSection key={cable?.id} cableType={cable || null} materials={document.materials} state={cable ? "success" : "empty"} editable={false} label="电缆截面" />
        : <LayingSection key={section?.id} document={document} sectionId={section?.id || ""} state={section ? "success" : "empty"} editable={false} label="敷设截面" />}
    </div>
  </section>;

  return <>
    <AppShell title={name} status={workspace.isError ? <StatusMark kind="error" label="读取失败" detail={message(workspace.error)} /> : <StatusMark kind="saved" label="已保存" />}
      actions={null} property={inspectorPanel} theme={theme} onUnavailable={() => {}}
      onTheme={() => void navigate({ to: "/studies", search: { theme: theme === "light" ? "dark" : "light", workspace: workspaceId }, replace: true })}>
      {commandBar}
      <div className="workbench-frame">
        <ProjectExplorer workspaceId={workspaceId} projectName={name} document={document} activeStudy="" view="" theme={theme} onCreate={() => setCreating(true)} />
        <div className={`workbench has-answer ${document ? "" : "workbench-no-canvas"}`}>
          <section className="answer-bar" aria-label="工程概况">
            <Conclusion title={isType ? "型号工程" : "工程"} model={name} description={facts || (workspace.isPending ? "读取工程模型" : "工程模型不可用")}
              metrics={[{ label: "研究", value: rows.length, unit: "个" }, { label: "已有结果", value: done, unit: "个" }, { label: "未运行或待重算", value: rows.length - done, unit: "个" }]} />
          </section>
          {canvas}
          <section className="workbench-dock" aria-label="本工程研究">
            <div className="workbench-dock-bar"><span className="workbench-dock-title">本工程研究</span></div>
            <div className="workbench-dock-body">
              {studies.isPending ? <LoadingState title="正在读取研究" />
                : studies.isError ? <ErrorState description={message(studies.error)} action={<Button onClick={() => void studies.refetch()}>重新读取</Button>} />
                  : rows.length ? <DataTable label="本工程研究" columns={columns} groups={[{ id: "calculations", label: "研究", rows }]} showGroups={false} rowLabel={(row) => row.title} onSelect={(row) => void open(row)} />
                    : <EmptyState title="还没有研究" description="新建一个研究：选择任务和插件，工程模型会自动带入。" action={<Button variant="primary" onClick={() => setCreating(true)}>新建研究</Button>} />}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
    <CreateStudyDialog open={creating} onOpenChange={setCreating} theme={theme} />
  </>;
}
