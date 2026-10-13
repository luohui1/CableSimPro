import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { hpcJson } from '@/features/field/run-label';
import { message, optionalRecord, text, numeric } from "@/api/client";
import { temperatureView, type FieldSample } from "@/lib/temperature-view";
import { entityLabel, savedDomain } from "@/lib/domain-fields";
import { formatNumber, parameterUnit, engineeringQuantity } from "@/lib/format";
import { deferredView } from './deferred-view';
const TemperaturePlot = deferredView(() => import('./temperature-plot').then(m => ({ default: m.TemperaturePlot })));
import { DataTable } from "./data-table";
import { Toolbar } from "./toolbar";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { SourceBadge } from "./source-badge";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";
import { Conclusion } from "./conclusion";
import { ConclusionStrip } from './conclusion-strip';
import { EngineeringValue } from "./engineering-value";
import type { InputSelection } from "./study-inputs";
import { StatusMark } from './status-mark';
import { FieldView } from '@/features/field/field-view';
import { ConvergenceChart } from '@/features/field/convergence-chart';
import { SavedRunProgress } from './study-run-control';
import { SavedFieldComparison } from '@/features/field/saved-comparison';
import { AdaptiveConvergence } from '@/features/field/adaptive-convergence';
import { FieldHistoryNotice } from '@/features/field/history-notice';
import { savedConductorLimit } from '@/features/field/saved-temperature-limit';
import { studyRuns } from '@/api/research';
import { StepResponse } from '@/features/field/step-response';
import { focusField } from './study-field-focus';
import { savedFieldInputs } from '@/features/field/saved-input-summary';
export function StudyTemperature({
  run,
  tab,
  onSelect,
}: {
  run?: Record<string, unknown>;
  tab: string;
  onSelect: (selection: InputSelection) => void;
}) {
  const savedCases = Array.isArray(optionalRecord(run?.snapshot).cases) ? optionalRecord(run?.snapshot).cases as Record<string, unknown>[] : [];
  const needsSavedView = !!run?.id && !!run?.workspace && !['accepted','queued','running','validating'].includes(text(run?.status)) &&
    (!run?.output || savedCases.some(item => item.input_ref && !item.input));
  const view = useQuery({ queryKey: ['saved-field-view', run?.workspace, run?.id], enabled: needsSavedView,
    queryFn: ({ signal }) => hpcJson(`/workspaces/${text(run?.workspace)}/fields/${text(run?.id)}/view`, { signal, cache:'default' }), retry: false });
  run = view.data ?? run;
  const pendingRun = run && ['accepted','queued','running','validating'].includes(text(run.status)) ? run : undefined;
  const previous = useQuery({ queryKey: ['field-previous-result', pendingRun?.workspace, pendingRun?.study, pendingRun?.id], enabled: !!pendingRun?.study, retry: false,
    queryFn: async ({ signal }) => {
      const values = await studyRuns(text(pendingRun?.workspace), text(pendingRun?.study), signal, 'summary');
      const saved = values.filter(item => item.id !== pendingRun?.id && ['succeeded','partial'].includes(text(item.status)) &&
        optionalRecord(item.snapshot).module === optionalRecord(pendingRun?.snapshot).module).sort((a,b) => Number(b.sequence)-Number(a.sequence))[0];
      return saved ? hpcJson(`/workspaces/${text(pendingRun?.workspace)}/fields/${text(saved.id)}/view`, { signal }) : null;
    } });
  if (pendingRun && previous.data) run = {...previous.data, freshness:'historical'};
  const [selected, setSelected] = useState("");
  const [zoom, setZoom] = useState("2");
  const [responseTab,setResponseTab]=useState(false);
  const [fullDomain, setFullDomain] = useState(false);
  const selectedInputRun = useRef('');
  useEffect(() => {
    setZoom("2");
    setSelected("");
    setFullDomain(false);
  }, [run?.id]);
  const parsed = useMemo(() => {
    try {
      return { view: run ? temperatureView(run) : undefined, error: undefined };
    } catch (error) {
      return { view: undefined, error };
    }
  }, [run]);
  // Camera controls and selection must reuse the verified display arrays;
  // changing a label should not rebuild contours or upload the mesh again.
  const circles = useMemo(() => (parsed.view?.geometry?.cables || []).map(cable => ({ x: cable.x, z: cable.z, r: cable.shape.radiusM, label: cable.label })), [parsed.view]);
  const values = useMemo(() => parsed.view?.temperatures.map(value => value - 273.15) || [], [parsed.view]);
  const focused = useMemo(() => {
    const data = parsed.view;
    if (!data) return { points: [], triangles: [], values };
    return data.kind === 'fem' && !fullDomain ? focusField(data.points, data.triangles, values, circles)
      : { points: data.points, triangles: data.triangles, values };
  }, [parsed.view, fullDomain, values, circles]);
  const workflows = useQuery({ queryKey: ['adaptive-convergence', text(run?.workspace), text(run?.study)], enabled: parsed.view?.kind === 'fem' && !!run?.workspace,
    queryFn: ({ signal }) => hpcJson(`/convergence?workspace=${encodeURIComponent(text(run?.workspace))}${run?.study ? `&study=${encodeURIComponent(text(run.study))}` : ''}`, { signal }), staleTime: 3000, retry: false });
  useEffect(() => {
    if (!run || !parsed.view || parsed.view.kind !== 'fem' || pendingRun || needsSavedView && !view.data || workflows.isPending) return;
    if (selectedInputRun.current === text(run.id)) return;
    const values = Array.isArray(workflows.data?.items) ? workflows.data.items.map(optionalRecord) : [];
    const workflow = values.find(value => value.rating_run_id === run.id);
    const selection = savedFieldInputs(run, text(parsed.view.case.case_id), workflow);
    if (selection) { selectedInputRun.current = text(run.id); onSelect(selection); }
  }, [run, parsed.view, pendingRun, needsSavedView, view.data, workflows.data, workflows.isPending, onSelect]);
  if (needsSavedView && !view.data && view.isPending) return <LoadingState title="读取保存场图与输入" />;
  if (needsSavedView && view.error) return <ErrorState title="保存场图与输入读取失败" description={message(view.error)} action={<Button onClick={() => void view.refetch()}>重新读取</Button>} />;
  if (pendingRun && !previous.data) return <div className="input-module"><SavedRunProgress run={pendingRun} />
    {previous.isPending ? <LoadingState title="读取上次保存结果" /> : previous.error ? <ErrorState description={message(previous.error)} /> : <p>运行中，尚无已封存温度场。</p>}</div>;
  if (!run) return <EmptyState description="" title="尚未运行；请提交超算生成温度场。" />;
  const stepOnly=Object.values(optionalRecord(optionalRecord(optionalRecord(run.snapshot).definition).method)).includes('fem-step-response') &&
    optionalRecord(optionalRecord(optionalRecord(run.snapshot).definition).parameters).operation==='step_response';
  if(tab==='step-response' || responseTab || stepOnly) return <div className="input-module">
    {!stepOnly && <Toolbar><Button size="compact" onClick={() => setResponseTab(false)}>场图</Button><Button size="compact" role="tab" aria-selected>阶跃热响应</Button></Toolbar>}
    <StepResponse run={run} />
  </div>;
  if (parsed.error)
    return (
      <ErrorState title="温度场不可用" description={message(parsed.error)} />
    );
  const data = parsed.view;
  if (!data) return <EmptyState description="" title="该运行没有温度场工件" />;
  const domain = savedDomain(run);
  const savedAssumptions = optionalRecord(optionalRecord(optionalRecord(data.case.artifacts)['x-cablesim.simulation-bundle']).result).assumptions;
  const modellingNotes = [['接触', '相切外护套'], ['波纹', '波纹护套'], ['范围', '二维均匀环']].flatMap(([label, prefix]) => {
    const statement = Array.isArray(savedAssumptions) ? savedAssumptions.find(value => typeof value === 'string' && value.startsWith(prefix)) : undefined;
    return statement ? [{ label, statement: text(statement) }] : [];
  });
  const summaryEntry = Object.entries(optionalRecord(data.case.artifacts)).find(([, value]) => optionalRecord(value).schema_version === 'cablesim.electrothermal-reference/1');
  const thermalSummary = optionalRecord(summaryEntry?.[1]);
  const checked = summaryEntry && optionalRecord(optionalRecord(optionalRecord(run.artifact_status)[text(data.case.case_id)])[summaryEntry[0]]).status === 'verified';
  const suppliedLimit = numeric(thermalSummary.temperature_limit_c), suppliedMaximum = numeric(thermalSummary.maximum_temperature_c);
  const pluginVerdict = checked && suppliedLimit !== null && suppliedMaximum !== null && typeof thermalSummary.within_temperature_limit === 'boolean' ? thermalSummary.within_temperature_limit : undefined;
  const savedLimit = data.kind === 'fem' && pluginVerdict === undefined ? savedConductorLimit(run, text(data.case.case_id)) : undefined;
  const limit = pluginVerdict === undefined ? savedLimit?.shared_limit_c ?? null : suppliedLimit;
  const savedMaximum = pluginVerdict === undefined ? savedLimit?.maximum_c ?? null : suppliedMaximum;
  const verdict = pluginVerdict ?? savedLimit?.within;
  function select(sample: FieldSample) {
    setSelected(sample.id);
    onSelect({
      id: sample.id,
      title:
        sample.id === "hotspot"
          ? "最高温度位置"
          : entityLabel(domain, sample.entity),
      groups: [
        {
          label: "取样",
          items: [
            {
              label: "x 坐标",
              value: <EngineeringValue quantity="coordinate" value={sample.point[0]} unit="m" withUnit />,
            },
            {
              label: "z 坐标",
              value: <EngineeringValue quantity="coordinate" value={sample.point[1]} unit="m" withUnit />,
            },
            {
              label: "温度",
              value: (
                <EngineeringValue
                  quantity="temperature"
                  value={sample.temperature}
                  unit="K"
                />
              ),
              unit: "°C",
              source: "calculation",
            },
            { label: "时刻", value: formatNumber(sample.time, 3), unit: "s" },
            {
              label: "取样方法",
              value: (
                <Tooltip content={sample.method}>
                  <span tabIndex={0}>
                    {sample.method ===
                    "maximum-of-exported-nodes; not a continuous extremum proof"
                      ? "导出节点最大值"
                      : "已保存方法"}
                  </span>
                </Tooltip>
              ),
            },
          ],
        },
      ],
    });
  }
  const conclusion = data.kind === 'fem' ? <>
    <ConclusionStrip label="保存温度场结论"
      conclusion={verdict === undefined ? '无法判断温限 · 保存工件尚无温限判定' : verdict ? '保存负荷满足温限' : '保存负荷超温'}
      historical={run.freshness === 'historical'}
      metrics={[
        { label: savedMaximum === null ? '场内最高温度' : '最高导体温度', value: savedMaximum === null ? data.maximum : savedMaximum + 273.15, unit: 'K', quantity: 'temperature' },
        { label: '保存温限', value: limit === null ? null : limit + 273.15, unit: 'K', quantity: 'temperature' },
        { label: '最大超出', value: savedLimit?.excess_k, unit: 'K', precision: 1 },
      ]} />
    {verdict === undefined && <p className="field-state-note">最高温度不代表满足温限；请核对来源运行的保存输入与温限判定。</p>}
    {savedLimit && limit === null && <p className="field-state-note">按各电缆保存的正常温限逐项判定。</p>}
  </> : (
    <Conclusion
      title={<StatusMark kind={verdict === undefined ? 'unknown' : verdict ? 'satisfied' : 'unsatisfied'} label={verdict === undefined ? '无法判断' : verdict ? '满足温限' : '超温'} />}
      model={`${savedLimit ? '最高导体温度' : '最高温度'} ${verdict === undefined ? engineeringQuantity("temperature", data.maximum, "K").text : formatNumber(savedMaximum, 1)} °C`}
      description={savedLimit ? `${limit === null ? '按各电缆保存正常温限' : `保存正常温限 ${formatNumber(limit, 1)} °C`} · ${savedLimit.within ? '导体结果满足温限' : `最大超出 ${formatNumber(savedLimit.excess_k, 1)} K`}` : verdict === undefined ? '保存工件未提供温限判定与超出量；最高温度不代表满足温限。' : `保存温限 ${formatNumber(limit, 1)} °C。${verdict ? '判定来自已校验的插件工件。' : '插件已判定超温，但工件未提供超出量。'}`}
      historical={run.freshness === "historical"}
      metrics={[
        {
          label: "场内最高温度",
          value: data.maximum,
          unit: "K",
          quantity: "temperature",
        },
        {
          label: "场内最低温度",
          value: data.minimum,
          unit: "K",
          quantity: "temperature",
        },
      ]}
    />
  );
  if (tab === "field")
    return (
      <div className="input-module">
        {data.kind === "fem" && <SavedRunProgress run={pendingRun || run} />}
        {data.kind === "fem" && <FieldHistoryNotice run={run} />}
        {conclusion}
        {modellingNotes.length > 0 && <details className="field-state-note">
          <summary>建模假设：理想点接触 · 波纹等效热环</summary>
          <dl className="field-scope">{modellingNotes.map(note => <div key={note.label}><dt>{note.label}</dt><dd>{note.statement}</dd></div>)}</dl>
        </details>}
        <Toolbar>
          <h2>保存温度场</h2>
          {data.kind === 'fem' && <Button size="compact" onClick={() => setFullDomain(value => !value)}>{fullDomain ? '电缆区域' : '全域'}</Button>}
          {data.kind === 'fem' && <Button size="compact" role="tab" aria-selected={false} onClick={() => setResponseTab(true)}>阶跃热响应</Button>}
          {optionalRecord(data.field.convergence).display_decimated === true && <span className="muted">显示已降采样，计算用全网格</span>}
          <div className="spacer" />
          {data.geometryError && (
            <Tooltip content={data.geometryError}>
              <span tabIndex={0} className="muted">
                轮廓未覆盖
              </span>
            </Tooltip>
          )}
          {data.kind !== "fem" && <Select
            label="场图范围"
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "2", label: "电缆周围 · 外扩 1 m" },
              { value: "1", label: "敷设全景" },
              { value: "0", label: "原始计算域" },
              { value: "4", label: "热点 · 4×" },
              { value: "16", label: "热点 · 16×" },
              { value: "64", label: "热点 · 64×" },
              { value: "256", label: "热点 · 256×" },
            ]}
          />}
          <Button size="compact" onClick={() => select(data.hotspot)}>
            选择热点
          </Button>
          {optionalRecord(data.field.convergence).display_decimated === true && <a className="button button-compact button-outline" href={`/api/hpc/workspaces/${text(run.workspace)}/fields/${text(run.id)}/full?case_id=${text(data.case.case_id)}`} download>导出全网格</a>}
        </Toolbar>
        {data.kind === "fem" ? <div className="saved-fem-field"><FieldView
          key={fullDomain ? 'full' : 'cables'} label="有限元温度场" points={focused.points} triangles={focused.triangles}
          values={focused.values} circles={circles} maskObjects={false} groundZ={data.geometry ? 0 : undefined}
          limit={limit === null ? undefined : { value: limit, label: '导体正常温限' }}
          samplePoint={optionalRecord(data.field.convergence).display_decimated === true ? async point => {
            const response = await hpcJson(`/workspaces/${text(run.workspace)}/fields/${text(run.id)}/sample?case_id=${text(data.case.case_id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([point]) });
            const values = response.temperature_k; const value = Array.isArray(values) ? numeric(values[0]) : null;
            return value === null ? undefined : value - 273.15;
          } : undefined}
          hotspot={{ point: data.hotspot.point, value: data.hotspot.temperature - 273.15, label: "最高温度" }}
        /></div> : <TemperaturePlot
          data={data}
          selected={selected}
          onSelect={select}
          zoom={Number(zoom)}
        />}
      </div>
    );
  if (tab === "samples")
    return (
      <div className="input-module saved-field-samples">
        {conclusion}
        <DataTable
          label="保存温度取样"
          columns={[
            {
              id: "entity",
              label: "对象",
              render: (row) => row.id === data.hotspot.id ? "最高温度点" : entityLabel(domain, row.entity),
            },
            {
              id: "x",
              label: "x",
              numeric: true,
              render: (row) => <EngineeringValue quantity="coordinate" value={row.point[0]} unit="m" withUnit />,
            },
            {
              id: "z",
              label: "z",
              numeric: true,
              render: (row) => <EngineeringValue quantity="coordinate" value={row.point[1]} unit="m" withUnit />,
            },
            {
              id: "temperature",
              label: "温度",
              unit: "°C",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature"
                  value={row.temperature}
                  unit="K"
                />
              ),
            },
            {
              id: "time",
              label: "时刻",
              unit: "s",
              numeric: true,
              render: (row) => formatNumber(row.time, 3),
            },
            {
              id: "source",
              label: "来源",
              render: (row) => (
                <SourceBadge kind="calculation" detail={row.method} />
              ),
            },
          ]}
          groups={[
            {
              id: "samples",
              label: "取样",
              rows: [...data.samples, data.hotspot],
            },
          ]}
          selectedId={selected}
          onSelect={select}
          rowLabel={(row) => row.id === data.hotspot.id ? "最高温度点" : entityLabel(domain, row.entity)}
          showGroups={false}
        />
        {data.kind === "fem" && <SavedFieldComparison run={run} />}
      </div>
    );
  if (tab === "convergence") {
    const proof = optionalRecord(run.convergence);
    const solver = optionalRecord(data.field.convergence);
    if (data.kind === 'fem' && optionalRecord(optionalRecord(optionalRecord(run.snapshot).definition).method).capability === 'iec-thermal-field')
      return <div className="input-module">{conclusion}<AdaptiveConvergence run={run} />
        {Array.isArray(solver.iterations) && <ConvergenceChart label="耦合迭代温度更新" unit="K" values={solver.iterations.map(value => numeric(optionalRecord(value).temperature_update_inf_k))} />}
      </div>;
    if (
      (!Array.isArray(proof.rows) || !proof.rows.length) &&
      Array.isArray(solver.iterations) &&
      solver.iterations.length
    ) {
      const rows: (Record<string, unknown> & { id: string })[] =
        solver.iterations.map((value, index) => ({
          ...optionalRecord(value),
          id: String(index),
        }));
      return (
        <div className="input-module">
          {conclusion}
          <Toolbar>
            <h2>保存耦合迭代</h2>
            <span className="muted">
              {solver.solver_status === "converged"
                ? "求解器已收敛"
                : "求解器未确认收敛"}{" "}
              · 网格核验未覆盖
            </span>
          </Toolbar>
          <ConvergenceChart label="耦合迭代温度更新" unit="K" values={rows.map(row => numeric(row.temperature_update_inf_k))} />
          <DataTable
            label="保存耦合迭代记录"
            columns={[
              {
                id: "iteration",
                label: "迭代",
                numeric: true,
                render: (row) => formatNumber(numeric(row.iteration), 0),
              },
              {
                id: "temperature",
                label: "温度更新",
                unit: "K",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="temperature_update"
                    value={numeric(row.temperature_update_inf_k)}
                    unit="K"
                  />
                ),
              },
              {
                id: "power",
                label: "功率",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="power"
                    value={numeric(row.power_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "energy",
                label: "能量相对残差",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="energy_residual"
                    value={numeric(row.energy_relative_residual)}
                    unit="1"
                  />
                ),
              },
              {
                id: "residual",
                label: "热残差",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="thermal_residual"
                    value={numeric(row.thermal_residual_inf_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "transfer",
                label: "传递相对误差",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="transfer_relative_error"
                    value={numeric(row.transfer_relative_error)}
                    unit="1"
                  />
                ),
              },
            ]}
            groups={[{ id: "iterations", label: "迭代", rows }]}
            rowLabel={(row) => `迭代 ${row.iteration}`}
            showGroups={false}
          />
        </div>
      );
    }
    if (!Array.isArray(proof.rows) || !proof.rows.length)
      return (
        <EmptyState
          title="尚无收敛核验记录"
          description={
            text(proof.reason) || "仅显示后端已保存的核验，不补造网格扫描。"
          }
        />
      );
    const rows: (Record<string, unknown> & { id: string })[] = proof.rows.map(
      (value, index) => ({
        id: String(index),
        ...optionalRecord(value),
      }),
    );
    const caseName = (row: Record<string, unknown>) => {
      const saved = savedCases.find(value => value.case_id === row.case_id);
      const name = text(row.case_name) || text(row.label) || text(saved?.name) || text(saved?.label);
      if (name) return name;
      const index = rows.indexOf(row as typeof rows[number]);
      return `工况 ${index + 1}`;
    };
    return (
      <div className="input-module">
        {conclusion}
        <Toolbar>
          <h2>收敛核验</h2>
          <span className="muted">
            {proof.status === "converged"
              ? "已收敛"
              : proof.status === "not_converged"
                ? "未收敛"
                : text(proof.status)}
          </span>
        </Toolbar>
        <ConvergenceChart label="网格与计算域核验热点" unit="K" values={rows.map(row => numeric(row.hotspot_k))} />
        {Array.isArray(solver.iterations) && <ConvergenceChart label="耦合迭代温度更新" unit="K" values={solver.iterations.map(value => numeric(optionalRecord(value).temperature_update_inf_k))} />}
        <DataTable
          label="保存收敛记录"
          columns={[
            { id: "case", label: "工况", render: caseName },
            {
              id: "mesh",
              label: "网格长度",
              unit: "m",
              numeric: true,
              render: (row) => formatNumber(numeric(row.mesh_size_m), 5),
            },
            {
              id: "nodes",
              label: "节点数",
              numeric: true,
              render: (row) => formatNumber(numeric(row.nodes), 0),
            },
            {
              id: "hotspot",
              label: "热点",
              unit: "°C",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature"
                  value={numeric(row.hotspot_k)}
                  unit="K"
                />
              ),
            },
            {
              id: "change",
              label: "变化",
              unit: "K",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature_change"
                  value={numeric(row.change_k)}
                  unit="K"
                />
              ),
            },
          ]}
          groups={[{ id: "convergence", label: "核验", rows }]}
          rowLabel={caseName}
          showGroups={false}
        />
      </div>
    );
  }
  const summary = optionalRecord(data.bundle.summary || data.bundle.result),
    evidence = optionalRecord(data.case.evidence);
  const entries: Record<string, unknown> = {
    ...summary,
    ...evidence,
    ...optionalRecord(data.field.convergence),
    ...(data.kind === "fem" ? { nodes: numeric(optionalRecord(data.field.convergence).full_mesh_nodes) ?? data.points.length,
      elements: numeric(optionalRecord(data.field.convergence).full_mesh_elements) ?? data.triangles.length } : {}),
  };
  const diagnostics = Object.entries(entries)
    .filter(
      ([, value]) =>
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "boolean",
    )
    .map(([key, value]) => ({
      id: key,
      label:
        (
          {
            nodes: "节点数",
            elements: "单元数",
            full_mesh_nodes: "计算网格节点数",
            full_mesh_elements: "计算网格单元数",
            display_decimated: "显示已降采样",
            display_notice: "显示口径",
            energy_relative_residual: "能量相对残差",
            physical_residual_inf_w_m: "物理残差",
            source_heat_w_m: "总热源",
            boundary_heat_w_m: "边界流出",
            iterations: "迭代次数",
            residual_k: "温度残差",
            engineering_approval: "工程批准",
            solver: "求解方法",
            mesh_status: "本工件网格核验",
            solver_status: "求解器状态",
          } as Record<string, string>
        )[key] || key,
      value: typeof value === "boolean" ? (value ? "是" : "否") : ({ converged: "已收敛", not_assessed_single_mesh: "单网格工件；多网格结论见收敛页" } as Record<string, string>)[String(value)] || value,
      unit:
        typeof value === "number"
          ? parameterUnit(key, { type: "number" })
          : "—",
    }));
  return (
    <div className="input-module">
      {conclusion}
      <DataTable
        label="保存温度场诊断"
        columns={[
          { id: "name", label: "诊断项", render: (row) => row.label },
          {
            id: "value",
            label: "保存值",
            numeric: true,
            render: (row) =>
              typeof row.value === "number" ? (
                <EngineeringValue
                  quantity={row.id}
                  value={row.value}
                  unit={row.unit}
                />
              ) : (
                String(row.value)
              ),
          },
          {
            id: "unit",
            label: "单位",
            render: (row) =>
              engineeringQuantity(row.id, numeric(row.value), row.unit).unit,
          },
        ]}
        groups={[{ id: "diagnostics", label: "诊断", rows: diagnostics }]}
        rowLabel={(row) => row.label}
        showGroups={false}
      />
    </div>
  );
}
