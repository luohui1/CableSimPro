import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { methodCatalog, workspaces } from "@/api/research";
import { displayName } from '@/lib/display-names';
import { Navigate } from "@tanstack/react-router";
import { studyModuleRoute, studyRootRoute } from "@/router";
import { useStudy } from "@/components/study-provider";
import { AppShell } from "@/components/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunRecordsDrawer } from "@/components/run-records-drawer";
import { VersionNotice } from '@/components/version-notice';
import { isVersionStale } from '@/lib/version-status';
import { missingInputDestination, focusPreflightField } from "@/lib/missing-input";
import { StatusMark } from "@/components/status-mark";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { WorkbenchInspector } from "@/components/workbench-inspector";
import { ProjectExplorer, singleAnswer } from "@/components/project-explorer";
import { PreviewControls, PreviewStrip, useStudyPreview } from "@/components/study-preview";
import { AddStudyDialog } from "@/components/add-study-dialog";
import { StudyDrawing } from "@/components/study-drawing";
import { conductorAnnotations } from "@/lib/result-annotations";
import { temperatureView } from "@/lib/temperature-view";
import { FieldView } from "@/features/field/field-view";
import { AgentPanel } from "@/features/agent/agent-panel";
import {
  StudySelection,
  selectedProperties,
} from "@/components/study-selection";
import { StudyReport } from "@/components/study-report";
import { StudyHybrid } from "@/components/study-hybrid";
import { Icon } from "@/components/icon";
import { message, numeric, optionalRecord, text } from "@/api/client";
import { selectionView, type SelectionRow } from "@/lib/selection-view";
import { StudyHeatDetail } from "@/components/study-heat-detail";
import { StudyValidation } from "@/components/study-validation";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import {
  CableInputs,
  ConditionsInputs,
  SectionInputs,
  type InputSelection,
} from "@/components/study-inputs";
import { StudyMethodForm } from "@/components/study-method-form";
import { StudyResults } from "@/components/study-results";
import { StudyTemperature } from "@/components/study-temperature";
import { SimulationSetup } from "@/components/simulation-setup";
import { StudyRunControl } from "@/components/study-run-control";
import { StudyNativeArtifact } from "@/components/study-native-artifact";
import { StudySweep } from "@/components/study-sweep";
import { StudyBatch } from "@/components/study-batch";
import { StudyCompare } from "@/components/study-compare";
import { StudyPhysicsComparison } from "@/components/study-physics-comparison";
import { StudySimulation } from "@/components/study-simulation";
import { entityLabel, savedDomain, type DomainDocument } from "@/lib/domain-fields";
import type { StudyDefinition } from "@/api/research";

import { moduleDefinitions } from "./study-modules";
export { moduleDefinitions } from "./study-modules";
export function StudyEntry() {
  const { study } = useStudy();
  const search = studyRootRoute.useSearch();
  return (
    <Navigate
      to="/studies/$sid/$module/$tab"
      params={{
        sid: study.id,
        module: rootModule(study.definition),
        tab: moduleDefinitions[rootModule(study.definition)].tabs[0].id,
      }}
      search={{ ...search, workspace: study.workspace }}
      replace
    />
  );
}
export function StudyWorkspace() {
  const { sid, module, tab } = studyModuleRoute.useParams();
  const search = studyModuleRoute.useSearch();
  const navigate = studyModuleRoute.useNavigate();
  const context = useStudy();
  const { study, workspace, runs, draft } = context;
  const theme = search.theme;
  const projectIndex = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const [selected, setSelected] = useState<SelectionRow | undefined>();
  // 以曲线为主的研究默认放大数据区；选型、载流量和温度场类研究默认模型与结果各半（温度场画在画布上）
  const plotFirst = (key: string) => ["sweep", "batch", "method-compare", "simulation", "hybrid"].includes(key);
  const [dockMax, setDockMax] = useState(plotFirst(module));
  const [creating, setCreating] = useState(false);
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const [edit, setEdit] = useState(false);
  const [records, setRecords] = useState(false);
  const [inputSelection, setInputSelection] = useState<
    InputSelection | undefined
  >();
  useEffect(() => {
    setDockMax(plotFirst(module));
  }, [module]);
  useEffect(() => {
    setInputSelection(undefined);
    setSelected(undefined);
  }, [module, search.run]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const calculatedModule = rootModule(study.definition);
  const configuredModule = study.definition.modules?.[module] ? module : "";
  const moduleRuns = runs.filter(
    (item) => text(optionalRecord(item.snapshot).module) === configuredModule && (!!configuredModule || module === calculatedModule),
  );
  const run = search.run
    ? runs.find((item) => item.id === search.run)
    : (["cable", "conditions", "section", "report"].includes(module)
        ? runs
        : moduleRuns
      ).at(-1);
  const enabled = [
    "cable",
    "section",
    "conditions",
    calculatedModule,
    "report",
  ];
  for (const key of Object.keys(study.definition.modules || {}))
    if (moduleDefinitions[key] && !enabled.includes(key))
      enabled.splice(enabled.length - 1, 0, key);
  for (const key of ["sweep", "batch", "method-compare", "simulation"])
    if (!enabled.includes(key)) enabled.splice(enabled.length - 1, 0, key);
  if (
    study.definition.task === "operating" &&
    !enabled.includes("thermal-field")
  )
    enabled.splice(enabled.length - 1, 0, "thermal-field");
  const definition = moduleDefinitions[module];
  let selectionError: unknown;
  let view: ReturnType<typeof selectionView> | undefined;
  const pendingRun =
    !!run &&
    ["accepted", "queued", "running", "validating"].includes(text(run.status));
  if (run && !pendingRun && module === "selection")
    try {
      view = selectionView(run);
    } catch (problem) {
      selectionError = problem;
    }
  const selectedRow =
    selected && view?.rows.find((row) => row.id === selected.id);
  // 运行若带温度场工件（有限元，或插件输出的 IEC 土壤温度场），画布默认显示真实温度场；选型显示所选或推荐候选的工况
  const fieldCase = module === "selection" ? selectedRow?.id || view?.recommendation?.id : undefined;
  const fieldView = useMemo(() => {
    if (!run || pendingRun) return undefined;
    try { return temperatureView(run, fieldCase); } catch { return undefined; }
  }, [run, pendingRun, fieldCase]);
  const historical =
    (run?.freshness === "historical" || isVersionStale(run)) &&
    (!["cable", "conditions", "section"].includes(module) || !!search.run);
  const inputModule = ["cable", "conditions", "section"].includes(module);
  const snapshotInput = inputModule && !!search.run;
  const inputDocument = (
    snapshotInput ? (run ? savedDomain(run) : undefined) : context.domain
  ) as DomainDocument | undefined;
  const inputProps = {
    tab,
    document: inputDocument,
    historical: snapshotInput,
    onSelect: (value: InputSelection) => {
      setInputSelection(value);
    },
  };
  const provenance = optionalRecord(
    optionalRecord(
      study.definition.input_source === "study"
        ? study.definition.method_input
        : workspace.domain,
    ).provenance,
  );
  const demo = Object.values(provenance).some(
    (value) => optionalRecord(value).kind === "demo",
  );
  // 工作窗口：模型画布（历史运行显示当时保存的模型）、右侧检查器的方法信息
  // 只有查看已过期的运行时才显示当时保存的模型并只读；刚运行完的当前结果仍可直接继续编辑
  const viewingOldInput = !!search.run && (run?.freshness === "historical" || isVersionStale(run));
  const canvasDocument = (viewingOldInput ? (run ? savedDomain(run) : undefined) : context.domain) as DomainDocument | undefined;
  const showCanvas = module !== "report" && !!canvasDocument && study.definition.input_source !== "study";
  const conductorLimits = (canvasDocument?.cable_types || []).map((cable) => numeric(optionalRecord(optionalRecord(cable.rating).max_conductor_temperature).normal)).filter((value): value is number => value !== null);
  const conductorLimit = conductorLimits.length ? Math.min(...conductorLimits) - 273.15 : undefined;
  const canvasView = search.view || (fieldView ? "field" : "section");
  // 运行后把导体温度直接标在截面电缆上：选型取当前选中或推荐的候选工况
  const annotations = run && !pendingRun ? conductorAnnotations(run, module === "selection" ? selectedRow?.id || view?.recommendation?.id : undefined) : undefined;
  const methodPin = optionalRecord(study.definition.method);
  const pluginEntry = (catalog.data || []).map(optionalRecord).find((row) => text(optionalRecord(row.method).plugin_id) === text(methodPin.plugin_id));
  const capabilityEntry = (Array.isArray(pluginEntry?.capabilities) ? pluginEntry!.capabilities : []).map(optionalRecord).find((cap) => text(cap.id) === text(methodPin.capability));
  const lastRun = runs.at(-1);
  const methodInfo = {
    name: text(pluginEntry?.name) || displayName(text(methodPin.plugin_id)),
    version: text(methodPin.version),
    hpc: text(optionalRecord(pluginEntry?.execution_policy).backend) === "slurm",
    kind: text(capabilityEntry?.title),
    run: !lastRun ? "尚未运行" : `${["succeeded", "partial"].includes(text(lastRun.status)) ? "已有结果" : ["failed", "rejected"].includes(text(lastRun.status)) ? "运行失败" : "运行中"} · ${new Date(text(lastRun.created)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
  };
  // 快速试算：插件声明 preview 且在本机运行的能力，单次计算的研究查看当前输入时开放（选型、扫描的答案跨候选或样本，不用单工况试算代替）
  const preview = useStudyPreview({ module, available: capabilityEntry?.preview === true && !methodInfo.hpc && !search.run && singleAnswer(study) });
  const status = context.dirty
    ? "draft"
    : context.runError
      ? "error"
      : historical
        ? "historical"
        : context.loadingRuns
          ? "running"
          : "saved";
  const title = draft?.title || study.title;
  const projectName = text((projectIndex.data || []).find((space) => text(space.id) === study.workspace)?.name);
  function currentSearch() {
    return { ...search, workspace: study.workspace };
  }
  // 电缆、截面、工况不再是单独页面：并入当前计算的工作窗口，画布切到对应视图
  if (inputModule)
    return (
      <Navigate
        to="/studies/$sid/$module/$tab"
        params={{ sid, module: calculatedModule, tab: studyEntryTab(calculatedModule) }}
        search={{ ...search, workspace: study.workspace, view: module === "cable" ? "cable" : "section" }}
        replace
      />
    );
  // 方法类页签（方法参数、问询条件、扫描设置）属于“改输入”，放在右侧属性区；底部只留结果类页签
  const methodTab = definition.tabs.find((item) => item.id === "parameters" || item.id === "settings")?.id;
  const dockTabs = definition.tabs.filter((item) => item.id !== methodTab);
  const methodHistorical = !!search.run;
  const methodPanel = !methodTab ? undefined
    : module === "sweep" ? <StudySweep run={run} tab="settings" readOnly={methodHistorical} onSelect={inputProps.onSelect} />
      : <StudyMethodForm module={module} historical={methodHistorical}
          definition={methodHistorical ? ((optionalRecord(run?.snapshot).study_definition || optionalRecord(run?.snapshot).definition) as StudyDefinition) : undefined} />;
  // 答案条：先回答这次计算的结论（选型推荐 / 允许电流与最热导体），切换底部页签时保持可见
  const answer = pendingRun || !run ? null
    : module === "selection" && view && !selectionError ? <StudySelection theme={theme} run={run} selectedId={selectedRow?.id} onSelect={(row) => setSelected(row)} dirty={context.dirty} part="conclusion" />
      : ["ampacity", "electrothermal", "transient", "sheath-losses"].includes(module) ? <StudyResults run={run} onSelect={inputProps.onSelect} part="conclusion" />
        : null;
  // 命令栏：只放“做什么”——保存、运行、交付；最右侧给出当前状态
  const runnable = ["ampacity", "thermal-field", "transient", "sheath-losses", "electrothermal", "sweep", "simulation", "selection"].includes(module) ||
    (module === "method-compare" && (!!study.definition.modules?.["method-compare"] || calculatedModule === "method-compare") && !search.compare);
  const latestRun = runs.at(-1);
  const runState = !latestRun ? "尚未运行" : `最近运行 ${new Date(text(latestRun.created)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${["succeeded", "partial"].includes(text(latestRun.status)) ? "成功" : ["failed", "rejected"].includes(text(latestRun.status)) ? "失败" : "进行中"}`;
  const commandBar = (
    <div className="command-bar" role="toolbar" aria-label="工程命令">
      <div className="command-group" role="group" aria-label="模型">
        <span className="command-caption">模型</span>
        <Button size="compact" variant={context.dirty ? "primary" : "ghost"} disabled={!context.dirty} loading={context.saving} onClick={() => void context.save()}><Icon name="action/save" />{context.dirty ? "保存修改" : "已保存"}</Button>
        <IconButton variant="ghost" icon="action/undo" label="撤销" disabled={!context.canUndo || context.saving} onClick={() => void context.undo()} />
        <IconButton variant="ghost" icon="action/redo" label="重做" disabled={!context.canRedo || context.saving} onClick={() => void context.redo()} />
      </div>
      <div className="command-group" role="group" aria-label="计算">
        <span className="command-caption">计算</span>
        <PreviewControls preview={preview} />
        {runnable && !snapshotInput && <StudyRunControl
                        key={sid + module}
                        module={inputModule ? calculatedModule : module}
                        currentInput={inputModule ? module : undefined}
                        autoPreflight={search.preflight}
                        onPreflightConsumed={() =>
                          navigate({
                            search: { ...currentSearch(), preflight: false },
                            replace: true,
                          })
                        }
                        onMissing={(field) => {
                          const { module: destination, tab: nextTab } =
                            missingInputDestination(
                              field,
                              inputModule ? calculatedModule : module,
                              inputModule ? module : undefined,
                            );
                          navigate({
                            params: { sid, module: destination, tab: nextTab },
                            search: { ...currentSearch(), run: "", delivery: "" },
                          }).then(() => focusPreflightField(field, workspace.domain));
                        }}
                        onResult={(id, outputModule) =>
                          navigate({
                            params: {
                              sid,
                              module: outputModule,
                              tab: moduleDefinitions[outputModule].tabs[0].id,
                            },
                            search: { ...currentSearch(), run: id, delivery: "" },
                          })
                        }
                      />}
      </div>
      <div className="command-group" role="group" aria-label="交付">
        <span className="command-caption">交付</span>
        <Button size="compact" variant="ghost" disabled={!run || context.dirty} onClick={() => navigate({ params: { sid, module: "report", tab: "preview" }, search: { ...currentSearch(), generate: true } })}><Icon name="result/report" />生成计算书</Button>
      </div>
      <span className="command-state" role="status">{context.dirty ? "模型有未保存修改" : runState}</span>
    </div>
  );
  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({
            params: { sid, module, tab: value },
            search: currentSearch(),
          })
        }
      >
        <AppShell
          title={projectName && title.startsWith(projectName.split(" · ")[0] + " · ") ? title.slice(projectName.split(" · ")[0].length + 3) : title}
          path={projectName}
          status={
            isVersionStale(run) || isVersionStale(study.raw) ? <VersionNotice value={isVersionStale(run) ? run : study.raw} target={{ wid: study.workspace, sid, module: (search.run || module === 'report' ? text(optionalRecord(run?.snapshot).module) : configuredModule) || undefined }} disabledReason={context.dirty ? '请先保存修改' : undefined} onComplete={next => { const resultModule = text(optionalRecord(next.snapshot).module) || calculatedModule; return navigate({ params: { sid, module: resultModule, tab: studyEntryTab(resultModule) }, search: { ...currentSearch(), run: text(next.id), delivery: '', generate: false } }); }} /> : <StatusMark
              kind={status}
              label={
                context.dirty
                  ? "未保存"
                  : historical
                    ? demo
                      ? "演示工况 · 历史结果"
                      : "历史结果"
                    : demo
                      ? "演示工况 · 已保存"
                      : "已保存"
              }
              detail={
                <div className="status-actions">
                  <span>{`${displayName(text(optionalRecord(study.definition.method).plugin_id))} ${text(optionalRecord(study.definition.method).version)}`}</span>
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => setEdit(true)}
                  >
                    修改研究名称
                  </Button>
                </div>
              }
            />
          }
          actions={null}
          property={module === "report" ? undefined : (
            <WorkbenchInspector
              view={search.inspector === "agent" ? "agent" : methodPanel && search.inspector === "method" ? "method" : "input"}
              agentPanel={<AgentPanel workspaceId={study.workspace} studyId={sid} context={title} />}
              onView={(value) => navigate({ search: { ...currentSearch(), inspector: value }, replace: true })}
              methodPanel={methodPanel}
              document={canvasDocument}
              historical={viewingOldInput}
              selection={inputSelection}
              candidate={module === "selection" && selectedRow ? { title: selectedRow.name, groups: selectedProperties(selectedRow) } : undefined}
              method={methodInfo}
              demo={demo}
            />
          )}
          onGlobalNavigate={(label) =>
            label === "首页"
              ? navigate({ to: "/", search: { theme } })
              : label === "研究"
                ? navigate({ to: "/studies", search: { theme } })
                : context.notice(`${label}即将迁移`)
          }
          onUnavailable={context.notice}
          theme={theme}
          onTheme={() =>
            navigate({
              search: {
                ...search,
                theme: theme === "light" ? "dark" : "light",
              },
              replace: true,
            })
          }
        >
          {commandBar}
          <div className="workbench-frame">
          <ProjectExplorer workspaceId={study.workspace} projectName={projectName} document={context.domain} activeStudy={sid} view={showCanvas ? canvasView : ""} theme={theme} onCreate={() => setCreating(true)} />
          <div className={`workbench ${showCanvas ? "" : "workbench-no-canvas"} ${answer || preview.result || preview.error ? "has-answer" : ""}`} data-dock={dockMax ? "max" : undefined}>
          {(answer || preview.result || preview.error) && <section className="answer-bar" aria-label="结论">{answer}<PreviewStrip preview={preview} saved={run?.headlines} /></section>}
          {showCanvas && (
            <section className="workbench-canvas" aria-label="模型">
              <div className="workbench-views" role="group" aria-label="模型视图">
                {([...(fieldView ? [["field", "calc/thermal-field", fieldView.kind === "iec" ? "土壤温度场" : "温度场"]] : []), ["section", "object/section", "敷设截面"], ["cable", "object/cable", "电缆截面"], ...(["thermal-field", "electrothermal", "transient", "sheath-losses", "simulation"].includes(module) ? [["three", "result/field", "三维"]] : [])] as ["field" | "section" | "cable" | "three", string, string][]).map(([value, icon, label]) => (
                  <button key={value} type="button" aria-pressed={canvasView === value} onClick={() => navigate({ search: { ...currentSearch(), view: value }, replace: true })}>
                    <Icon name={icon} />{label}
                  </button>
                ))}
              </div>
              {canvasView === "field" && fieldView ? (
                <FieldView
                  label={fieldView.kind === "iec" ? "土壤温度场（IEC 解析）" : "温度场"}
                  points={fieldView.points}
                  triangles={fieldView.triangles}
                  values={fieldView.temperatures.map((kelvin) => kelvin - 273.15)}
                  circles={fieldView.excluded.length
                    ? fieldView.excluded.map((region) => ({ x: region.x, z: region.z, r: region.r, label: canvasDocument ? entityLabel(canvasDocument, region.label) : region.label }))
                    : (fieldView.geometry?.cables || []).map((cable) => ({ x: cable.x, z: cable.z, r: cable.shape.radiusM, label: cable.label }))}
                  groundZ={fieldView.geometry ? 0 : undefined}
                  hotspot={{ point: fieldView.hotspot.point, value: fieldView.hotspot.temperature - 273.15, label: fieldView.kind === "iec" ? "土壤最高" : "最高" }}
                  // IEC 解析场只有土壤区域，导体温限画在色标上没有意义
                  limit={conductorLimit === undefined || fieldView.kind === "iec" ? undefined : { value: conductorLimit, label: `${conductorLimit.toFixed(0)} 限值` }}
                />
              ) : (
                <StudyDrawing document={canvasDocument!} historical={viewingOldInput} kind={canvasView === "cable" ? "cable" : canvasView === "three" ? "scene" : "section"} onSelect={inputProps.onSelect} annotations={annotations} />
              )}
              {canvasView === "field" && fieldView?.kind === "iec" && <p className="field-basis" title={fieldView.limitations.join("；")}>{fieldView.limitations[0]}</p>}
            </section>
          )}
          <section className="workbench-dock" aria-label="计算结果">
            <div className="workbench-dock-bar">
              <TabsList aria-label={`${definition.label}页签`}>
                {dockTabs.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <span className="spacer" />
              <Button size="compact" variant="ghost" onClick={() => setRecords(true)}><Icon name="action/history" />运行记录</Button>
              {showCanvas && <IconButton variant="ghost" icon={dockMax ? "action/chevron-down" : "action/chevron-up"} label={dockMax ? "还原结果面板" : "放大结果面板"} onClick={() => setDockMax(!dockMax)} />}
            </div>
          <TabsContent value={tab} className="workbench-dock-body">
          {!!context.saveError && (
            <ErrorState
              title="保存失败，编辑保留"
              description={message(context.saveError)}
            />
          )}
          {inputModule && !snapshotInput ? (
            module === "cable" ? (
              <CableInputs {...inputProps} />
            ) : module === "conditions" ? (
              <ConditionsInputs {...inputProps} />
            ) : (
              <SectionInputs {...inputProps} />
            )
          ) : context.loadingRuns ? (
            <LoadingState title="正在读取运行记录" />
          ) : context.runError ? (
            <ErrorState
              description={message(context.runError)}
              action={<Button onClick={context.refresh}>重新读取</Button>}
            />
          ) : search.run && !run ? (
            <ErrorState description="指定运行不存在或不属于此研究。" />
          ) : pendingRun && !inputModule && tab !== "parameters" ? (
            <LoadingState title="运行尚未完成" />
          ) : inputModule ? (
            run?.integrity !== "verified" ? (
              <ErrorState description="固定运行输入未通过完整性校验" />
            ) : module === "cable" ? (
              <CableInputs {...inputProps} />
            ) : module === "conditions" ? (
              <ConditionsInputs {...inputProps} />
            ) : (
              <SectionInputs {...inputProps} />
            )
          ) : [
              "ampacity",
              "thermal-field",
              "transient",
              "sheath-losses",
              "electrothermal",
            ].includes(module) && tab === "parameters" ? (
            <StudyMethodForm
              module={module}
              historical={!!search.run}
              definition={
                search.run
                  ? ((optionalRecord(run?.snapshot).study_definition ||
                      optionalRecord(run?.snapshot)
                        .definition) as StudyDefinition)
                  : undefined
              }
            />
          ) : ["selection", "ampacity", "sweep"].includes(module) && tab === "validation" ? (
            <StudyValidation run={run} />
          ) : ["selection", "ampacity"].includes(module) && tab === "detail" ? (
            <StudyHeatDetail
              key={`${run?.id || "none"}-${selectedRow?.id || ""}`}
              run={run}
              cases={(view?.rows || []).map((row) => ({ id: row.id, label: row.name }))}
              initialCase={selectedRow?.id || view?.recommendation?.id}
            />
          ) : module === "transient" && tab === "history" ? (
            <StudyNativeArtifact run={run} kind="history" />
          ) : module === "sheath-losses" && tab === "losses" ? (
            <StudyNativeArtifact run={run} kind="losses" />
          ) : ["thermal-field", "electrothermal", "transient"].includes(module) && !run ? (
            <SimulationSetup module={module} />
          ) : ["thermal-field", "electrothermal", "transient"].includes(
              module,
            ) && tab !== "results" ? (
            <StudyTemperature
              run={run}
              tab={tab}
              onSelect={inputProps.onSelect}
            />
          ) : [
              "ampacity",
              "transient",
              "sheath-losses",
              "electrothermal",
            ].includes(module) ? (
            <StudyResults run={run} onSelect={inputProps.onSelect} part="details" />
          ) : module === "selection" && tab === "results" ? (
            selectionError ? (
              <ErrorState
                title="选型结果不可用"
                description={message(selectionError)}
              />
            ) : run ? (
              <StudySelection
                theme={theme}
                run={run}
                selectedId={selectedRow?.id}
                onSelect={(row) => {
                  setSelected(row);
                            }}
                dirty={context.dirty}
                part="details"
              />
            ) : (
              <EmptyState
                title="尚无选型运行"
                description="输入已保存，预检后运行候选比较。"
              />
            )
          ) : module === "selection" && tab === "settings" ? (
            <StudyMethodForm module="selection" historical={!!search.run} />
          ) : module === "hybrid" ? (
            <StudyHybrid key={study.id} run={run} tab={tab} />
          ) : module === "sweep" ? (
            <StudySweep run={run} tab={tab} readOnly={!!search.run} onSelect={inputProps.onSelect} />
          ) : module === "batch" ? (
            <StudyBatch tab={tab} readOnly={!!search.run} datasetId={search.dataset || ""} onDataset={id => navigate({ params: { sid, module: "batch", tab: "results" }, search: { ...currentSearch(), dataset: id, run: "" } })} onSelect={inputProps.onSelect} />
          ) : module === "method-compare" ? (
            (study.definition.modules?.["method-compare"]?.method.capability || (calculatedModule === "method-compare" ? study.definition.method.capability : "")) === "physics-comparison" ? <StudyPhysicsComparison run={run} tab={tab} readOnly={!!search.run} /> : <StudyCompare run={run} tab={tab} readOnly={!!search.run} selectedRuns={search.compare || ""} onComparison={compare => navigate({ params: { sid, module: "method-compare", tab: "inputs" }, search: { ...currentSearch(), compare, run: "" } })} />
          ) : module === "simulation" ? (
            <StudySimulation run={run} tab={tab} readOnly={!!search.run} />
          ) : module === "report" ? (
            <StudyReport
              wid={study.workspace}
              sid={sid}
              run={run}
              did={search.delivery}
              tab={tab}
              dirty={context.dirty}
              autoGenerate={search.generate}
              onGenerateConsumed={() =>
                navigate({
                  search: { ...currentSearch(), generate: false },
                  replace: true,
                })
              }
              onDelivery={(id) =>
                navigate({ search: { ...currentSearch(), delivery: id } })
              }
            />
          ) : (
            <EmptyState
              title={`${definition.label}尚未接入`}
              description="当前模块没有可用的呈现能力。"
            />
          )}
          </TabsContent>
          </section>
          </div>
          </div>
        </AppShell>
      </Tabs>
      <Dialog
        open={edit}
        onOpenChange={setEdit}
        title="研究名称"
        description="修改保留为该研究的草稿，Ctrl+S 保存。"
        initialFocus="form"
        actions={
          <>
            <Button
              onClick={() => {
                context.discard();
                setEdit(false);
              }}
            >
              取消修改
            </Button>
            <Button variant="primary" onClick={() => setEdit(false)}>
              保留草稿
            </Button>
          </>
        }
      >
        <label className="text-field">
          研究名称
          <input
            maxLength={120}
            value={title}
            disabled={context.saving}
            onChange={(event) => context.editTitle(event.target.value)}
          />
        </label>
      </Dialog>
      <AddStudyDialog open={creating} onOpenChange={setCreating} theme={theme} workspaceId={study.workspace} projectName={projectName} />
      <RunRecordsDrawer
        workspace={study.workspace}
        studyId={sid}
        disabledReason={context.dirty ? '请先保存修改' : undefined}
        open={records}
        onOpenChange={setRecords}
        runs={runs}
        selectedId={run ? text(run.id) : undefined}
        loading={context.loadingRuns}
        error={context.runError}
        onRetry={context.refresh}
        onSelect={(id) => {
          setSelected(undefined);
          navigate({ search: { ...currentSearch(), run: id, delivery: "" } });
        }}
      />
    </>
  );
}
