import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from '@tanstack/react-router';
import { statusLabel } from '@/lib/status-vocabulary';
import { displayName } from "@/lib/display-names";
import { savedEntityLabel, savedRunLabel } from './study-run-label';
import { frozenInputDifferences, comparisonCellText } from './run-records-comparison';
import { useQuery } from "@tanstack/react-query";
import { compareRuns } from "@/api/comparison";
import { inputContractQuery, capabilityInputContracts, exactContract } from "@/api/input-contracts";
import {
  record,
  array,
  optionalRecord,
  numeric,
  text,
  message,
  ApiError,
} from "@/api/client";
import {
  moduleConfiguration,
  withConfiguration,
  parameterChange,
  configurationOnly,
  rootModule,
} from "@/lib/study-config";
import { useStudy } from "./study-provider";
import { DataTable } from "./data-table";
import { QueryState } from "./query-state";
import { Toolbar } from "./toolbar";
import { EngineeringValue } from "./engineering-value";
import { EmptyState } from "./states";
import { StudyErrorState as ErrorState } from './study-error-state';
import { StudyMethodForm } from "./study-method-form";
import { MethodParameterFields } from "./method-parameter-fields";
import { contractDefaults } from "./contract-fields";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { StatusMark } from "./status-mark";
import { downloadCsv, downloadJson } from "@/lib/download";
import type { CatalogRow } from "@/api/catalogs";
import { studyRuns, type StudyDefinition } from "@/api/research";
import { methodCardsQuery } from '@/lib/study-queries';
export function StudyCompare({
  run,
  tab,
  selectedRuns,
  onComparison,
  readOnly,
}: {
  run?: Record<string, unknown>;
  tab: string;
  selectedRuns: string;
  onComparison: (ids: string) => void;
  readOnly: boolean;
}) {
  const context = useStudy(),
    definition = (
      readOnly && run
        ? optionalRecord(run.snapshot).study_definition ||
          optionalRecord(run.snapshot).definition
        : context.draft?.definition || context.study.definition
    ) as StudyDefinition,
    config = moduleConfiguration(definition, "method-compare");
  const catalog=useQuery(methodCardsQuery());
  const methodLabel=(pin:Record<string,unknown>,snapshot?:unknown)=>{
    const saved=optionalRecord(snapshot), id=text(pin.plugin_id), fixed=Object.values(optionalRecord(saved.method_manifests || saved.method_cards)).map(optionalRecord).find(item=>item.id===id);
    const name=text(fixed?.name)||text(catalog.data?.find(item=>optionalRecord(item.method).plugin_id===id)?.name);
    const fallback=displayName(id);return name||(fallback===id?'保存的计算方法':fallback);
  };
  const [chosen, setChosen] = useState<string[]>(
      selectedRuns ? selectedRuns.split(",") : [],
    ),
    [method, setMethod] = useState(""),
    [error, setError] = useState("");
  const [physics, setPhysics] = useState("thermal");
  const search = useSearch({strict:false});
  const ids = [...new Set(selectedRuns.split(",").filter(Boolean))];
  useEffect(() => setChosen([...new Set(selectedRuns.split(',').filter(Boolean))]), [selectedRuns]);
  // Load lightweight summaries only when this comparison module is open. The
  // normal workbench continues to fetch just its selected/latest saved result.
  const runList = useQuery({
    queryKey: ['study-compare-runs', context.study.workspace, context.study.id, text(optionalRecord(context.study.raw.latest_run).id)],
    queryFn: ({signal}) => studyRuns(context.study.workspace, context.study.id, signal, 'summary'),
    staleTime: 0,
    retry: false,
  });
  const availableRuns = (runList.data || []).filter(row => ['succeeded','partial'].includes(text(row.status)) && row.integrity === 'verified');
  const chosenMissing = chosen.some(id => !availableRuns.some(row => row.id === id));
  const comparison = useQuery({
    queryKey: ["run-comparison", context.study.workspace, selectedRuns],
    queryFn: ({signal}) => compareRuns(context.study.workspace, ids, signal),
    enabled: ids.length >= 2 && ids.length <= 5,
    retry: false,
  });
  const compareReason = comparison.isFetching ? '正在读取并核对保存运行'
    : runList.isPending ? '正在读取可比较运行'
    : runList.error ? '请先重新读取可比较运行'
    : chosenMissing ? '所选运行不再可用，请重新选择'
    : chosen.length < 2 ? '先选择一个基准运行，再选择至少一个对照运行'
    : chosen.length > 5 ? '每次最多比较五个运行' : undefined;
  const startResearch = <Button asChild size="compact"><Link to="/studies/$sid/$module/$tab"
    params={{sid:context.study.id,module:'ampacity',tab:'results'}}
    search={{workspace:context.study.workspace,theme:search.theme === 'dark' ? 'dark' : 'light',run:'',delivery:''}}>返回载流量研究</Link></Button>;
  const view = useMemo(() => {
    try {
      if (ids.length) return { data: comparison.data, error: undefined };
      if (!run) return { data: undefined, error: undefined };
      if (run.integrity !== "verified")
        throw new ApiError(409, "对比运行完整性未通过，拒绝显示数值");
      const output = record(run.output, "对比输出"),
        snapshot = record(run.snapshot, "对比快照");
      if (
        optionalRecord(snapshot.definition).driver &&
        optionalRecord(optionalRecord(snapshot.definition).driver).kind !==
          "crosscheck"
      )
        return { data: undefined, error: undefined };
      return {
        data: {
          sources: [{ run_id: run.id, snapshot }],
          differences: [
            { ...record(output.crosscheck, "插件对照差异"), same_input: true },
          ],
          executions: output.executions,
        } as Record<string, unknown>,
        error: undefined,
      };
    } catch (error) {
      return { data: undefined, error };
    }
  }, [run, comparison.data, selectedRuns]);
  const methods = (catalog.data || []).flatMap(entry => array(entry.capabilities).map(optionalRecord).flatMap(cap =>
    (array(cap.study_tasks).includes('rating') || cap.analysis === 'crosscheck') && text(cap.id) === (config?.method.capability || definition.method.capability)
      ? [{method:{...optionalRecord(entry.method),capability:text(cap.id)} as StudyDefinition['method']}] : []));
  const key = (value: {
    plugin_id: string;
    capability: string;
    version: string;
    release_digest: string;
  }) =>
    [
      value.plugin_id,
      value.capability,
      value.version,
      value.release_digest,
    ].join(":");
  const selectedMethod=methods.find(value=>key(value.method)===method)?.method;
  const contracts=useQuery({...inputContractQuery(selectedMethod || config?.method || definition.method),enabled:!!selectedMethod && !readOnly});
  async function configure() {
    try {
      if (readOnly) throw Error("固定运行只读，请返回当前研究。");
      const selected = methods.find((value) => key(value.method) === method);
      if (!selected) throw Error("请选择有正式输入契约的对照方法。");
      const contract=exactContract(await capabilityInputContracts(selected.method),selected.method);
      const baseline = configurationOnly(
        config || moduleConfiguration(definition, "ampacity") || definition,
      );
      if (key(selected.method) === key(baseline.method))
        throw Error("对照方法与基准方法相同，请选择另一方法版本。");
      const next = {
        ...baseline,
        title: "同输入方法对比",
        driver: {
          ...baseline.driver,
          kind: "crosscheck" as const,
          cases: [],
          samples: [],
          candidate_ids: [],
          selected_case_ids: null,
        },
        crosschecks: [{ method: selected.method, parameters: contractDefaults(contract.parameter_schema) }],
        input_sources: {...baseline.input_sources, '/crosschecks/0/parameters': {
          kind: 'derived' as const, reference: `采用 ${methodLabel(selected.method)} ${selected.method.version} 契约声明的默认参数，工程师需核对适用范围`, reviewed: false,
        }},
        candidate_completions: {},
        verification: null,
      };
      const { modules: _modules, ...root } = definition;
      void _modules;
      context.editDefinition({
        ...root,
        modules: { ...definition.modules, "method-compare": next },
      });
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }
  async function configurePhysics() {
    try {
      const entry=(catalog.data || []).find(value=>array(value.capabilities).some(cap=>optionalRecord(cap).id==='physics-comparison'));
      if (!entry) throw Error("尚未安装物理对比方法，请联系管理员。");
      const pin={...optionalRecord(entry.method),capability:'physics-comparison'} as StudyDefinition['method'];
      const contract=exactContract(await capabilityInputContracts(pin),pin);
      const saved = moduleConfiguration(definition, "ampacity") || definition;
      const iec =
        saved.method.plugin_id === "cablesim.iec60287"
          ? saved.parameters
          : optionalRecord(saved.parameters).iec;
      if (!iec || !Object.keys(optionalRecord(iec)).length)
        throw Error("请先保存IEC方法参数，再采用物理对比。");
      const domain = optionalRecord(context.workspace.domain);
      const circuit = optionalRecord(
        (Array.isArray(domain.circuits) ? domain.circuits : [])[0],
      );
      if (!text(circuit.id)) throw Error("请先保存目标回路和负荷工况。");
      const parameters = {
        iec,
        physics,
        source:
          "工程师采用研究对比默认网格及有限等温边界；远场收敛未评估，需核对输入。",
        bounds_m: [-15, -15, 15, 0],
        controls: {
          operation: "ampacity",
          rated_circuit:
            text(optionalRecord(saved.parameters).rated_circuit) ||
            text(circuit.id),
          mesh_size_m: 0.0006,
          far_mesh_size_m: 0.18,
          mesh_transition_m: 1,
          fine_mesh_band_m: 0.0015,
          max_nodes: 140000,
          tolerance_k: 1e-5,
          max_iterations: 100,
          relaxation: 0.8,
          current_upper_a: 2000,
          current_tolerance_a: 0.002,
        },
        dataset: {
          mesh_scales: [1.5, 1, 0.75],
          temperature_tolerance_k: 0.1,
          ampacity_tolerance_a: 0.5,
        },
        ...(physics === "electromagnetic_thermal"
          ? {
              electromagnetic_mesh: {
                size_m: 0.0005,
                far_size_m: 0.3,
                transition_m: 2,
                field_order: 1,
                minimum_circle_segments: 128,
                max_nodes: 120000,
              },
            }
          : {}),
      };
      context.editDefinition({
        ...definition,
        modules: {
          ...definition.modules,
          "method-compare": {
            ...configurationOnly(saved),
            title: "标准与物理场对比",
            method: contract.method,
            parameters,
            input_source: "domain",
            driver: {
              ...saved.driver,
              kind: "single",
              cases: [],
              samples: [],
              candidate_ids: [],
              selected_case_ids: null,
            },
            crosschecks: [],
          },
        },
      });
      setError("");
    } catch (problem) {
      setError(message(problem));
    }
  }
  const sources: CatalogRow[] = (
    Array.isArray(view.data?.sources) ? view.data.sources : []
  )
    .map(optionalRecord)
    .map((value, index) => ({
      ...value,
      id: text(value.run_id) || String(index),
    }));
  const diffs = (
    Array.isArray(view.data?.differences) ? view.data.differences : []
  ).map(optionalRecord);
  const sourceFor = (id: unknown) => sources.find(source => source.run_id === id);
  const inputDifferences = diffs.flatMap((difference, index) => {
    const baseline = sourceFor(difference.baseline_run_id), other = sourceFor(difference.run_id);
    if (!baseline || !other) return [];
    return frozenInputDifferences(optionalRecord(baseline.snapshot), optionalRecord(other.snapshot))
      .map(row => ({...row, id:index + row.id, comparison:savedRunLabel(other)}));
  });
  const rows: CatalogRow[] = diffs.flatMap((difference, index) =>
    (Array.isArray(difference.quantities) ? difference.quantities : [])
      .map(optionalRecord)
      .map((row, at) => ({ ...row, comparisonRun: difference.run_id, id: index + "/" + at })),
  );
  if (view.error)
    return (
      <ErrorState title="方法对比不可用" description={message(view.error)} />
    );
  return (
    <div
      className="input-module study-compare-module"
      data-module-state={
        ids.length && comparison.isPending
          ? "loading"
          : error || comparison.error
            ? "error"
            : !view.data
              ? "empty"
              : readOnly || run?.freshness === "historical"
                ? "historical"
                : "success"
      }
    >
      {!readOnly && tab === "inputs" && (
        <Toolbar>
          <h2>标准与物理场</h2>
          <Select
            label="对比物理"
            value={physics}
            onChange={setPhysics}
            options={[
              { value: "thermal", label: "热传导／分层土壤" },
              { value: "electromagnetic_thermal", label: "GetDP电磁热耦合" },
            ]}
          />
          <Button
            size="compact"
            disabled={
              catalog.isPending || !!catalog.error || context.saving
            }
            title={catalog.isPending ? '正在读取计算方法' : catalog.error ? '请先重新读取计算方法' : context.saving ? '正在保存修改' : undefined}
            onClick={configurePhysics}
          >
            采用物理对比
          </Button>
        </Toolbar>
      )}
      <section className="input-section">
        <Toolbar>
          <h2>比较已保存运行</h2>
          <div className="spacer" />
          <Button
            size="compact"
            variant={config || rootModule(definition) === 'method-compare' ? 'outline' : 'primary'}
            disabled={!!compareReason}
            title={compareReason}
            onClick={() => chosen.join(',') === selectedRuns ? void comparison.refetch() : onComparison(chosen.join(','))}
          >
            比较所选运行
          </Button>
        </Toolbar>
        <p className="muted" role="status">已选 {chosen.length} 个运行。先选基准，再选一至四个对照；历史运行保留原输入和结果。</p>
        <QueryState query={runList} empty={false} loading="正在读取可比较运行">
        {availableRuns.length ? <DataTable
          label="可比较运行"
          density="standard"
          rowLabel={(row) => text(row.created)}
          showGroups={false}
          groups={[
            {
              id: "runs",
              label: "运行",
              rows: availableRuns.map((row) => ({ ...row, id: text(row.id) }) as CatalogRow),
            },
          ]}
          columns={[
            {
              id: "selected",
              label: "选择",
              render: (row) => (
                <input
                  type="checkbox"
                  aria-label={"比较 " + savedRunLabel(row)}
                  checked={chosen.includes(row.id)}
                  disabled={!chosen.includes(row.id) && chosen.length >= 5}
                  title={!chosen.includes(row.id) && chosen.length >= 5 ? '每次最多五个运行，请先取消一个选择' : undefined}
                  onChange={(event) =>
                    setChosen((previous) =>
                      event.target.checked
                        ? [...previous, row.id]
                        : previous.filter((id) => id !== row.id),
                    )
                  }
                />
              ),
            },
            {
              id: "created",
              label: "保存运行",
              wrap: true,
              render: (row) => <>{savedRunLabel(row)}{chosen.includes(row.id) && <span className="muted"> · {chosen[0] === row.id ? '基准' : '对照'}</span>}</>,
            },
            {
              id: "method",
              label: "方法",
              wrap: true,
              render: (row) =>
                methodLabel(
                  optionalRecord(
                    row.method || optionalRecord(optionalRecord(row.snapshot).definition)
                      .method,
                  ),row.snapshot),
            },
            {
              id: "status",
              label: "状态",
              render: (row) => (
                <StatusMark
                  kind={row.freshness === "historical" ? "historical" : row.freshness === "current" ? "saved" : "partial"}
                  label={row.freshness === 'historical' || row.freshness === 'current' ? statusLabel(row.freshness, '当前性未核验') : '当前性未核验'}
                />
              ),
            },
          ]}
        /> : <EmptyState title="尚无通过完整性核验的成功运行" description="先在载流量研究中保存输入并计算，再修改条件取得第二次运行。" action={startResearch} />}
        </QueryState>
      </section>
      {ids.length > 0 && (
        <QueryState query={comparison} empty={false}>
          <span className="muted">
            差值为绝对数值对照；输入和方法差异不代表正确性或优化收益。
          </span>
        </QueryState>
      )}
      {tab === "inputs" ? (
        <>
          <section className="input-section">
            <h2>输入与方法差异</h2>
            {ids.length >= 2 && comparison.data ? <>
              {diffs.map((diff, index) => <p key={index} className="muted">
                {savedRunLabel(sourceFor(diff.run_id) || {}, '对照运行')}：
                {([['same_input','输入'],['same_parameters','方法参数'],['same_method','方法版本']] as const)
                  .map(([key,label]) => label + (diff[key] === true ? '相同' : diff[key] === false ? '不同' : '未提供')).join('；')}
              </p>)}
              {inputDifferences.length ? <DataTable label="对比输入差异" rowLabel={row => row.name} showGroups={false}
                groups={[{id:'saved-inputs',label:'固定输入（SI）',rows:inputDifferences}]}
                columns={[
                  {id:'name',label:'改动条件 / 对象',wrap:true,render:row => row.name},
                  {id:'before',label:'基准值 / SI',wrap:true,render:row => comparisonCellText(row.a)},
                  {id:'after',label:'对照值 / SI',wrap:true,render:row => comparisonCellText(row.b)},
                  ...(diffs.length > 1 ? [{id:'comparison',label:'对照运行',wrap:true,render:(row:typeof inputDifferences[number]) => row.comparison}] : []),
                ]} /> : <p role="status">数值、边界与方法参数没有变化。若上方标为不同，请在“证据”中核对保存的来源和发行记录。</p>}
            </> : diffs.length ? (
              <DataTable
                label="对比输入差异"
                rowLabel={(row) => row.label}
                showGroups={false}
                groups={[
                  {
                    id: "inputs",
                    label: "输入",
                    rows: diffs.flatMap((diff, index) =>
                      [
                        ["same_input", "输入"],
                        ["same_parameters", "方法参数"],
                        ["same_method", "方法版本"],
                      ].map(([key, label]) => ({
                        id: index + key,
                        label,
                        value:
                          diff[key] === true
                            ? "相同"
                            : diff[key] === false
                              ? "不同"
                              : "未提供",
                      })),
                    ),
                  },
                ]}
                columns={[
                  { id: "name", label: "比较维度", render: (row) => row.label },
                  {
                    id: "difference",
                    label: "结果",
                    render: (row) => row.value,
                  },
                ]}
              />
            ) : (
              <EmptyState
                title="选择运行后查看具体改动"
                description="在上表先勾选基准，再勾选对照，点击“比较所选运行”。"
                action={!availableRuns.length ? startResearch : <Button size="compact" onClick={() => document.querySelector<HTMLInputElement>('table[aria-label="可比较运行"] input[type="checkbox"]')?.focus()}>选择基准运行</Button>}
              />
            )}
          </section>
          {!readOnly && (
            <>
              <Toolbar>
                <h2>同输入方法</h2>
                <Select
                  label="对照方法版本"
                  value={method}
                  onChange={setMethod}
                  options={methods.map((value) => ({
                    value: key(value.method),
                    disabled: key(value.method) === key(config?.method || definition.method),
                    label:
                      methodLabel(value.method) +
                      " · " +
                      value.method.version + (key(value.method) === key(config?.method || definition.method) ? '（当前基准版本）' : ''),
                  }))}
                />
                <Button
                  size="compact"
                  disabled={!method || contracts.isPending || !!contracts.error}
                  title={!method ? '请选择与基准不同的方法版本' : contracts.isPending ? '正在读取方法输入契约' : contracts.error ? '方法输入契约读取失败，请重新选择或重试' : undefined}
                  onClick={configure}
                >
                  采用对照方法
                </Button>
              </Toolbar>
              {contracts.error && (
                <ErrorState
                  title="方法契约读取失败"
                  description={message(contracts.error)}
                />
              )}
            </>
          )}
          {config && (
            <>
              <section className="input-section">
                <h2>基准方法参数</h2>
                <StudyMethodForm
                  module="method-compare"
                  historical={readOnly}
                  definition={
                    readOnly
                      ? (optionalRecord(run?.snapshot)
                          .study_definition as StudyDefinition) ||
                        (optionalRecord(run?.snapshot)
                          .definition as StudyDefinition)
                      : undefined
                  }
                />
              </section>
              {(config.crosschecks || []).map((crosscheck, index) => (
                <section className="input-section" key={key(crosscheck.method)}>
                  <Toolbar>
                    <h2>
                      对照方法参数 ·{" "}
                      {methodLabel(crosscheck.method)}
                    </h2>
                    {!readOnly && (
                      <Button
                        size="compact"
                        onClick={async () => {
                          try {
                          const contract=exactContract(await capabilityInputContracts(crosscheck.method),crosscheck.method);
                          const next = structuredClone(config);
                          next.crosschecks![index].parameters =
                            contractDefaults(contract.parameter_schema);
                          context.editDefinition(
                            withConfiguration(
                              definition,
                              "method-compare",
                              next,
                            ),
                          );
                          } catch(problem) { setError(message(problem)); }
                        }}
                      >
                        采用契约默认参数
                      </Button>
                    )}
                  </Toolbar>
                  <MethodParameterFields
                    namespace={"method-compare-crosscheck-" + index}
                    method={crosscheck.method}
                    values={crosscheck.parameters || {}}
                    readOnly={readOnly}
                    draftFields={context.draft?.parameterFields}
                    onDraftChange={(field, key) =>
                      context.editParameterText(
                        field
                          ? {
                              ...field,
                              module: "method-compare",
                              crosscheck: index,
                            }
                          : undefined,
                        key,
                      )
                    }
                    onChange={(path, value) =>
                      context.editDefinition(
                        parameterChange(
                          definition,
                          "method-compare",
                          path,
                          value,
                          index,
                        ),
                      )
                    }
                  />
                </section>
              ))}
            </>
          )}
        </>
      ) : tab === "evidence" ? (
        sources.length ? (
          <DataTable
            label="对比方法证据"
            rowLabel={(row) => row.id}
            showGroups={false}
            groups={[{ id: "sources", label: "固定来源", rows: sources }]}
            columns={[
              {
                id: "method",
                label: "保存的方法与版本",
                wrap: true,
                render: (row) => {
                  const pin = optionalRecord(
                    optionalRecord(optionalRecord(row.snapshot).definition)
                      .method,
                  );
                  return (
                    methodLabel(pin,row.snapshot) +
                    " · " +
                    text(pin.version) +
                    " · " +
                    displayName(text(pin.capability))
                  );
                },
              },
              {
                id: "source",
                label: "运行来源",
                render: (row) => (
                  <Button
                    size="compact"
                    onClick={() => downloadJson(row, "comparison-source.json")}
                  >
                    下载运行快照
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState title="尚无保存的对比证据" description="" />
        )
      ) : rows.length ? (
        <>
          <section className="evidence-summary">
            <h2>{rows.length} 项同量纲结果可比较</h2>
            {sources.length>=2 && <p>{sources.map((source,index)=>`${index===0?'基准':'对照'}：${methodLabel(optionalRecord(optionalRecord(optionalRecord(source.snapshot).definition).method),source.snapshot)}`).join('；')}</p>}
            <p className="muted">
              输入、边界与方法差异见“输入差异”；未配对结果保留在证据中。
            </p>
          </section>
          <Toolbar>
            <h2>结果差异</h2>
            <div className="spacer" />
            <Button
              size="compact"
              onClick={() =>
                downloadCsv(
                  [
                    [
                      "物理量",
                      "对象",
                      "输出条件",
                      "基准 / SI",
                      "对照 / SI",
                      "差值 / SI",
                      "单位",
                      "来源",
                    ],
                    ...rows.map((row) => [
                      text(row.title) || displayName(text(row.key)),
                      savedEntityLabel(sourceFor(row.comparisonRun) || run || {}, text(row.case_id), text(row.entity)),
                      displayName(text(row.condition)),
                      row.baseline,
                      row.value,
                      row.difference,
                      row.unit,
                      JSON.stringify(sources),
                    ]),
                  ],
                  "method-comparison.csv",
                )
              }
            >
              导出对比 CSV
            </Button>
          </Toolbar>
          <DataTable
            label="方法结果差异"
            rowLabel={(row) => text(row.key)}
            groups={[{ id: "differences", label: "结果", rows }]}
            showGroups={false}
            columns={[
              {
                id: "quantity",
                label: "物理量",
                render: (row) => text(row.title) || displayName(text(row.key)),
              },
              {
                id: "entity",
                label: "对象 / 条件",
                render: (row) =>
                  savedEntityLabel(sourceFor(row.comparisonRun) || run || {}, text(row.case_id), text(row.entity)) +
                  " · " +
                  displayName(text(row.condition)),
              },
              ...(["baseline", "value", "difference"] as const).map((key) => ({
                id: key,
                label: { baseline: "基准", value: "对照", difference: "差值" }[
                  key
                ],
                numeric: true,
                render: (row: CatalogRow) => (
                  <EngineeringValue
                    quantity={
                      key === "difference" && text(row.unit) === "K"
                        ? "temperature_difference"
                        : text(row.key)
                    }
                    value={numeric(row[key])}
                    unit={text(row.unit)}
                    withUnit
                  />
                ),
              })),
            ]}
          />
          <Button
            size="compact"
            onClick={() =>
              downloadJson(
                {
                  sources,
                  differences: diffs,
                  executions: view.data?.executions,
                },
                "comparison-evidence.json",
              )
            }
          >
            下载未配对量与固定记录
          </Button>
        </>
      ) : (
        <EmptyState
          title="尚无可比较的结果"
          description="选择至少两次保存运行，或核对同输入方法参数后执行。"
        />
      )}
      {error && (
        <ErrorState title="对比设置未保存" description={error} />
      )}
    </div>
  );
}
