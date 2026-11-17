import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { workspaces, type StudyRow } from "@/api/research";
import { methodCardsQuery } from '@/lib/study-queries';
import { message, optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { AddStudyDialog } from "@/components/add-study-dialog";
import { DataTable, type Column } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { calculationKind, headlineText, ProjectExplorer } from "@/components/project-explorer";
import { InlineEmpty, ErrorState, LoadingState } from "@/components/states";
import { StatusMark } from "@/components/status-mark";
import {StudyRecalculate, studyPresentation} from '@/components/study-status';
import '@/components/workbench-inspector.css';
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AgentPanel } from "@/features/agent/agent-panel";
import { CableSection } from "@/features/drawing/cable-section";
import { LayingSection } from "@/features/drawing/laying-section";
import { entityLabel, type DomainDocument } from "@/lib/domain-fields";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { projectStudiesQuery, workspaceQuery } from "@/lib/study-queries";
import { modelViews, projectSuggestions } from '@/components/study-workbench-config';
import { readableCableVersion } from '@/components/study-workbench-config';
import { RelationPanel } from '@/components/relation-panel';
import { ObjectChip } from '@/components/object-link';
import { WorkbenchSplitter } from '@/components/workbench-splitter';
import { CommandBar, type CommandAction } from '@/components/command-bar';
import { formatDateTime } from '@/lib/format';
import { STATUS_WORDS } from '@/lib/status-vocabulary';

type Theme = "light" | "dark";


/** 研究名常以工程名开头（“城北变电站 · …”），在工程内部省掉这段前缀。 */
const shortTitle = (title: string, project: string) => {
  const prefix = project.split(" · ")[0] + " · ";
  return title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : title;
};

/**
 * 工程首页：与研究工作台同一骨架。命令栏（模型 / 计算 / 交付）、左侧工程浏览器、
 * 中间是工程模型的截面与本工程全部研究，右侧是工程属性与 Agent。
 * 工程模型在研究里编辑（同一份模型，所有研究共用），这里只读展示。
 */
export function ProjectHome({ workspaceId, theme }: { workspaceId: string; theme: Theme }) {
  const navigate = useNavigate();
  useEffect(() => { window.document.documentElement.dataset.theme = theme; }, [theme]);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"section" | "cable">("section");
  const [chosen, setChosen] = useState("");
  const [inspector, setInspector] = useState<"project" | "agent">("project");
  const [recalculateQueue,setRecalculateQueue] = useState<StudyRow[]>([]);
  const workspace = useQuery(workspaceQuery(workspaceId));
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const studies = useQuery(projectStudiesQuery(workspaceId));
  const catalog = useQuery(methodCardsQuery());
  const rows = (studies.data || []).filter((row) => row.workspace === workspaceId).sort((a, b) => b.updated.localeCompare(a.updated));
  // latest_run 已由宿主在同一只读快照核验；首页不为结论逐项下载运行历史。
  const latest = new Map(rows.map(row => {
    const run = optionalRecord(row.raw.latest_run);
    return [row.id, run.id ? run : undefined] as const;
  }));
  const name = text((projects.data || []).find((row) => text(row.id) === workspaceId)?.name) || "工程";
  const document = workspace.data?.domain as DomainDocument | undefined;
  const reference = optionalRecord(workspace.data?.study_cable_reference);
  const section = document?.sections.find((item) => item.id === chosen) || document?.sections[0];
  const cable = document?.cable_types.find((item) => item.id === chosen) || document?.cable_types[0];
  const states = new Map(rows.map(row=>[row.id,studyPresentation(row,latest.get(row.id),0,studies.error,studies.isPending)]));
  const outdated = rows.filter(row=>states.get(row.id)?.code==='outdated');
  const open = (row: StudyRow, extra: Record<string, unknown> = {}, hash = '') => navigate({
    to: "/studies/$sid/$module/$tab",
    params: { sid: row.id, module: rootModule(row.definition), tab: studyEntryTab(rootModule(row.definition)) },
    search: { workspace: row.workspace, theme, run: "", delivery: "", ...extra },
    hash,
  });

  const columns: Column<StudyRow>[] = [
    { id: "name", label: "研究", wrap: true, render: (row) => {
      const kind = calculationKind(row, catalog.data || []);
      return <Link className="object-link project-calc" title={row.title} to="/studies/$sid/$module/$tab" params={{ sid: row.id, module: rootModule(row.definition), tab: studyEntryTab(rootModule(row.definition)) }} search={{ workspace: row.workspace, theme, run: "", delivery: "" }}>
        <Icon name={kind.icon} /><span>{shortTitle(row.title, name)}</span>
      </Link>;
    } },
    { id: "kind", label: "任务", wrap: true, render: (row) => calculationKind(row, catalog.data || []).label },
    { id: "method", label: "插件", wrap: true, render: (row) => `${calculationKind(row, catalog.data || []).methodName} ${text(row.definition.method?.version)} · ${calculationKind(row, catalog.data || []).hpc ? "超算" : "本机"}` },
    { id: "answer", label: "结论", wrap: true, numeric: true, render: (row) => { const run = latest.get(row.id); return <span>{headlineText(run?.headlines, 1) || '—'}{states.get(row.id)?.historical && <small> · {STATUS_WORDS.historical}</small>}</span>; } },
    { id: "state", label: "状态", wrap: true, render: (row) => { const state=states.get(row.id)!; return <span title={state.reason}><StatusMark kind={state.mark} label={state.label} /></span>; } },
  ];

  const inspectorPanel = <aside className="workbench-inspector study-inspector" aria-label="属性">
    <div className="inspector-switch" role="tablist" aria-label="属性分页">
      <button type="button" role="tab" aria-selected={inspector === "project"} onClick={() => setInspector("project")}><Icon name="object/folder" />工程</button>
      <button type="button" role="tab" aria-selected={inspector === "agent"} onClick={() => setInspector("agent")}><Icon name="agent/agent" />Agent</button>
    </div>
    {inspector === "agent" ? <div className="inspector-agent"><AgentPanel key={workspaceId} workspaceId={workspaceId} context={name} suggestions={projectSuggestions} /></div> : <>
      <section className="inspector-block" aria-label="工程">
        <header><Icon name="object/folder" /><h2>工程</h2></header>
        <dl className="inspector-list">
          <div><dt>名称</dt><dd>{name}</dd></div>
          <div><dt>模型修订</dt><dd>{workspace.data ? `第 ${String(workspace.data.revision)} 版` : "—"}</dd></div>
          <div><dt>更新</dt><dd>{workspace.data ? formatDateTime(text(workspace.data.updated_at)) : "—"}</dd></div>
          <div><dt>引用型号</dt><dd>{text(reference.id) ? <ObjectChip status={false} card={{
            kind:'cable_version',id:text(reference.id).replace(/^candidate:/,''),name:text(reference.name),
            version:readableCableVersion(text(reference.version)),status:{code:'unknown',label:'引用版本'},
          }} /> : "—"}</dd></div>
        </dl>
      </section>
      {document && <section className="inspector-block" aria-label="工程模型">
        <header><Icon name="object/section" /><h2>工程模型</h2></header>
        <dl className="inspector-list">
          {document.sections.map((item) => <div key={item.id}><dt>敷设截面</dt><dd>{item.label || entityLabel(document, item.id)}</dd></div>)}
          {document.cable_types.map((item) => <div key={item.id}><dt>电缆</dt><dd>{item.label || entityLabel(document, item.id)}</dd></div>)}
          {document.load_cases.map((item) => <div key={item.id}><dt>工况</dt><dd>{entityLabel(document, item.id)}</dd></div>)}
        </dl>
      </section>}
      <section className="inspector-block" aria-label="工程关联"><header><Icon name="object/folder" /><h2>关联</h2></header><RelationPanel kind="project" id={workspaceId} /></section>
    </>}
  </aside>;

  const commandActions: CommandAction[] = [
    {id:'new-study',label:'新建研究',icon:'action/add',role:'primary',onSelect:()=>setCreating(true)},
    {id:'edit',label:'编辑模型',icon:'action/edit',priority:80,variant:'ghost',disabledReason:!rows.length?'请先新建研究，在研究中编辑共用模型':undefined,onSelect:()=>{if(rows[0]) void open(rows[0],{view:'section',inspector:'input'},'edit-model');}},
    ...(outdated.length>1 ? [{id:'recalculate',label:'全部重算',priority:60,variant:'ghost' as const,disabledReason:recalculateQueue.length?'正在逐项确认重算':undefined,onSelect:()=>setRecalculateQueue(outdated)}] : []),
    {id:'deliveries',label:'交付记录',icon:'result/report',priority:30,variant:'ghost',onSelect:()=>void navigate({to:'/deliveries',search:{theme,workspace:workspaceId,delivery:''}})},
  ];
  const commandBar = <CommandBar label="工程命令" actions={commandActions} status={studies.isPending?'读取中':outdated.length?`${outdated.length} 项待重算`:'已保存'} />;

  const canvas = !document ? null : <section className="workbench-canvas" aria-label="工程模型">
    <div className="workbench-views" role="group" aria-label="模型视图">
      {modelViews.map(({id: value, icon, label}) =>
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
        <div className={`workbench ${document ? "" : "workbench-no-canvas"}`}>
          {canvas}
          <WorkbenchSplitter kind="project" />
          <section className="workbench-dock" aria-label="本工程研究">
            <div className="workbench-dock-bar"><span className="workbench-dock-title">本工程研究</span></div>
            <div className="workbench-dock-body project-study-table">
              {recalculateQueue[0] && <div className="study-history-line"><span>依次确认：{shortTitle(recalculateQueue[0].title,name)}（剩余 {recalculateQueue.length} 项）</span>
                <StudyRecalculate key={recalculateQueue[0].id} value={states.get(recalculateQueue[0].id)?.staleValue} target={{wid:workspaceId,sid:recalculateQueue[0].id}} onComplete={()=>setRecalculateQueue(queue=>queue.slice(1))} />
                <Button size="compact" variant="ghost" onClick={()=>setRecalculateQueue([])}>结束队列</Button></div>}
              {studies.isPending ? <LoadingState title="正在读取研究" />
                : studies.isError ? <ErrorState description={message(studies.error)} action={<Button onClick={() => void studies.refetch()}>重新读取</Button>} />
                  : rows.length ? <DataTable label="本工程研究" columns={columns} groups={[{ id: "calculations", label: "研究", rows }]} showGroups={false} rowLabel={(row) => row.title} onSelect={(row) => void open(row)} />
                    : <InlineEmpty title="本工程尚无研究" action={<Button variant="primary" onClick={() => setCreating(true)}>新建研究</Button>} />}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
    <AddStudyDialog open={creating} onOpenChange={setCreating} theme={theme} workspaceId={workspaceId} projectName={name} />
  </>;
}
