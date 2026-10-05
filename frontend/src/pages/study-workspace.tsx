import { useEffect, useState } from "react";
import { displayName } from '@/lib/display-names';
import { Link, Navigate } from "@tanstack/react-router";
import { studyModuleRoute, studyRootRoute } from "@/router";
import { useStudy } from "@/components/study-provider";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunRecordsDrawer } from "@/components/run-records-drawer";
import { VersionNotice } from '@/components/version-notice';
import { isVersionStale } from '@/lib/version-status';
import { missingInputDestination, focusPreflightField } from "@/lib/missing-input";
import { StatusMark } from "@/components/status-mark";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { PropertyPanel } from "@/components/property-panel";
import { CheckArea } from "@/components/check-area";
import {
  StudySelection,
  selectedProperties,
} from "@/components/study-selection";
import { StudyReport } from "@/components/study-report";
import { StudyHybrid } from "@/components/study-hybrid";
import { Icon } from "@/components/icon";
import { message, optionalRecord, text } from "@/api/client";
import { selectionView, type SelectionRow } from "@/lib/selection-view";
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
import { StudyRunControl } from "@/components/study-run-control";
import { StudyNativeArtifact } from "@/components/study-native-artifact";
import { StudySweep } from "@/components/study-sweep";
import { StudyBatch } from "@/components/study-batch";
import { StudyCompare } from "@/components/study-compare";
import { StudyPhysicsComparison } from "@/components/study-physics-comparison";
import { StudySimulation } from "@/components/study-simulation";
import {
  displayed,
  fieldSource,
  savedDomain,
  type DomainDocument,
} from "@/lib/domain-fields";
import { sourceKind } from "@/lib/selection-view";
import { formatNumber } from "@/lib/format";
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
  const [selected, setSelected] = useState<SelectionRow | undefined>();
  const [collapsed, setCollapsed] = useState(true);
  const [edit, setEdit] = useState(false);
  const [records, setRecords] = useState(false);
  const [inputSelection, setInputSelection] = useState<
    InputSelection | undefined
  >();
  useEffect(() => {
    setInputSelection(undefined);
    setSelected(undefined);
    setCollapsed(true);
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
      setCollapsed(false);
    },
  };
  const inputGroups =
    inputSelection?.fields && inputDocument
      ? [
          {
            label: "参数",
            items: inputSelection.fields.map((spec) => {
              const source = fieldSource(inputDocument, spec.path),
                pending = snapshotInput
                  ? undefined
                  : context.domainDraft?.fields[spec.path];
              return {
                label: spec.label,
                value: pending
                  ? pending.value
                  : formatNumber(
                      displayed(inputDocument, spec),
                      spec.precision ?? 1,
                    ),
                unit: spec.unit,
                source: pending ? ("user" as const) : sourceKind(source),
                sourceDetail: text(source.reference),
              };
            }),
          },
        ]
      : inputSelection?.groups || [];
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
  const sidebar = enabled.map((key) => (
    <Link
      key={key}
      className="module-item"
      to="/studies/$sid/$module/$tab"
      params={{ sid, module: key, tab: moduleDefinitions[key].tabs[0].id }}
      search={{ ...search, workspace: study.workspace }}
      aria-current={key === module ? "page" : undefined}
    >
      <Icon name={moduleDefinitions[key].icon} />
      {moduleDefinitions[key].label}
    </Link>
  ));
  function currentSearch() {
    return { ...search, workspace: study.workspace };
  }
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
          title={title}
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
          actions={
            <>
              {!inputModule && <>
                <Button variant="ghost" size="compact" disabled={!context.canUndo || context.saving} onClick={() => void context.undo()} title="Ctrl+Z">撤销研究</Button>
                <Button variant="ghost" size="compact" disabled={!context.canRedo || context.saving} onClick={() => void context.redo()} title="Ctrl+Y">重做研究</Button>
              </>}
              <Button size="compact" onClick={() => setRecords(true)}>
                运行记录
              </Button>
              {context.dirty ? (
                <Button
                  variant="primary"
                  size="compact"
                  loading={context.saving}
                  onClick={() => context.save()}
                >
                  {context.domainDraft && !draft
                    ? "保存" +
                      (
                        {
                          cable: "电缆",
                          conditions: "工况",
                          section: "敷设",
                        } as Record<string, string>
                      )[context.domainDraft.scope]
                    : "保存修改"}
                </Button>
              ) : snapshotInput ? (
                <Button
                  variant="primary"
                  size="compact"
                  onClick={() =>
                    navigate({
                      search: { ...currentSearch(), run: "", delivery: "" },
                    })
                  }
                >
                  编辑当前输入
                </Button>
              ) : [
                  "ampacity",
                  "thermal-field",
                  "transient",
                  "sheath-losses",
                  "electrothermal",
                  "sweep",
                  "simulation",
                ].includes(module) ||
                inputModule ||
                (module === "selection" && (!run || historical)) ||
                (module === "method-compare" && (!!study.definition.modules?.["method-compare"] || calculatedModule === "method-compare") && !search.compare) ? (
                <StudyRunControl
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
                />
              ) : module === "selection" ? (
                <Button
                  variant="primary"
                  size="compact"
                  disabled={!run}
                  onClick={() =>
                    navigate({
                      params: { sid, module: "report", tab: "preview" },
                      search: { ...currentSearch(), generate: true },
                    })
                  }
                >
                  生成客户计算书
                </Button>
              ) : (
                <Button size="compact" onClick={context.refresh}>
                  刷新
                </Button>
              )}
            </>
          }
          sidebar={<>{sidebar}</>}
          tabs={
            <TabsList aria-label={`${definition.label}页签`}>
              {definition.tabs.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          }
          property={
            module === "selection" ||
            inputModule ||
            [
              "ampacity",
              "thermal-field",
              "transient",
              "sheath-losses",
              "electrothermal",
              "sweep",
              "batch",
            ].includes(module) ? (
              <PropertyPanel
                title={
                  module === "selection"
                    ? selectedRow?.name || "候选属性"
                    : inputSelection?.title || "对象属性"
                }
                groups={
                  module === "selection"
                    ? selectedProperties(selectedRow)
                    : inputGroups
                }
                collapsed={collapsed}
                empty={module === "selection" ? !selectedRow : !inputSelection}
                onToggle={() => setCollapsed(!collapsed)}
              />
            ) : undefined
          }
          propertyCollapsed={collapsed}
          checks={
            <CheckArea
              summary={
                view
                  ? `候选 ${view.rows.length} 项 · ${view.rows.filter((row) => row.verdict === "inapplicable").length} 项不适用${historical ? " · 历史" : ""}`
                  : draft
                    ? "研究有未保存修改"
                    : "已保存研究"
              }
            >
              <div className="check-list">
                <span>
                  {demo
                    ? "敷设与部分工况采用模板，应按实际条件核对。"
                    : "输入来自所选研究及固定型号版本。"}
                </span>
                {selectedRow && selectedRow.dependencies.length > 0 && (
                  <span>
                    依赖工程师给定参数：{selectedRow.dependencies.join("、")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => setEdit(true)}
                >
                  研究名称
                </Button>
              </div>
            </CheckArea>
          }
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
          <TabsContent value={tab}>
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
          ) : module === "transient" && tab === "history" ? (
            <StudyNativeArtifact run={run} kind="history" />
          ) : module === "sheath-losses" && tab === "losses" ? (
            <StudyNativeArtifact run={run} kind="losses" />
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
            <StudyResults run={run} onSelect={inputProps.onSelect} />
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
                  setCollapsed(false);
                }}
                dirty={context.dirty}
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
