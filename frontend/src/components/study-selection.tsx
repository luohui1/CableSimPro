import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type SelectionRow,
  selectionView,
  sourceKind,
} from "@/lib/selection-view";
import { optionalRecord, text, numeric, message } from "@/api/client";
import { formatNumber } from "@/lib/format";
import { displayName } from '@/lib/display-names';
import { DataTable, type Column } from "./data-table";
import { ConclusionStrip } from "./conclusion-strip";
import { Toolbar } from "./toolbar";
import { Select } from "./ui/select";
import { StatusMark } from "./status-mark";
import { SourceBadge } from "./source-badge";
import { EmptyState, StaleBanner, LoadingState } from "./states";
import { StudyErrorState } from "./study-error-state";
import { Button } from "./ui/button";
import type { PropertyGroup } from "./property-panel";
import { Tooltip } from "./ui/tooltip";
import type { DomainDocument } from "@/lib/domain-fields";
import { caseRun, hydrateCaseInputs } from "@/features/cad/saved-field-controls";
import { Link } from "@tanstack/react-router";
import { readableCableVersion } from './study-workbench-config';

export function selectedProperties(row?: SelectionRow): PropertyGroup[] {
  if (!row) return [];
  const payload = optionalRecord(row.candidate.payload);
  const cable = optionalRecord(payload.cable_type);
  const conductor = optionalRecord(
    optionalRecord(Array.isArray(cable.cores) ? cable.cores[0] : null)
      .conductor,
  );
  const factory = optionalRecord(row.sources.factory),
    resistance = optionalRecord(row.sources.r20);
  const diameter = numeric(conductor.diameter),
    r20 = numeric(conductor.r20);
  return [
    {
      label: "选型结果",
      items: [
        {
          label: "截面",
          value: formatNumber(row.section),
          unit: "mm²",
          source: sourceKind(factory),
          sourceDetail: text(factory.reference),
        },
        {
          label: "允许电流",
          value: formatNumber(row.current, 1),
          unit: row.current === null ? undefined : "A",
          source: "calculation",
        },
        {
          label: "余量",
          value: formatNumber(row.margin, 1),
          unit: row.margin === null ? undefined : "A",
          source: "calculation",
        },
      ],
    },
    {
      label: "电缆参数",
      items: [
        ...(diameter === null
          ? []
          : [
              {
                label: "导体外径",
                value: formatNumber(diameter * 1000, 1),
                unit: "mm",
                source: sourceKind(factory),
                sourceDetail: text(factory.reference),
              },
            ]),
        ...(r20 === null
          ? []
          : [
              {
                label: text(resistance.reference).includes("上限")
                  ? "R₂₀标准上限"
                  : "R₂₀",
                value: formatNumber(r20 * 1000, 4),
                unit: "Ω/km",
                source: sourceKind(resistance),
                sourceDetail: text(resistance.reference),
              },
            ]),
      ],
    },
    {
      label: "依据",
      items: [
        {
          label: "型号版本",
          value: (
            <Tooltip content={readableCableVersion(row.version)}>
              <span tabIndex={0}>
                {readableCableVersion(row.version)}
              </span>
            </Tooltip>
          ),
        },
        { label: "判定", value: <StatusMark kind={row.verdict} /> },
      ],
    },
  ];
}
export function StudySelection({
  run,
  selectedId,
  onSelect,
  dirty,
  theme,
  part = "all",
}: {
  run: Record<string, unknown>;
  selectedId?: string;
  onSelect: (row: SelectionRow) => void;
  dirty: boolean;
  theme: "light" | "dark";
  /** conclusion：只渲染结论（工作窗口答案条）；details：只渲染明细（结果停靠栏）。 */
  part?: "all" | "conclusion" | "details";
}) {
  const view = useMemo(() => selectionView(run), [run]);
  const [filter, setFilter] = useState("all");
  const labels = {
    satisfied: "满足",
    unsatisfied: "不满足",
    inapplicable: "不适用",
    error: "计算失败",
  } as const;
  const columns: Column<SelectionRow>[] = [
    { id: "name", label: "候选型号", wrap:true, render: (row) => <span title={row.name}>{row.name}</span> },
    {
      id: "area",
      label: "截面",
      unit: "mm²",
      numeric: true,
      render: (row) => formatNumber(row.section),
    },
    {
      id: "current",
      label: "允许电流",
      unit: "A",
      numeric: true,
      render: (row) => formatNumber(row.current, 1),
    },
    {
      id: "margin",
      label: "余量",
      unit: "A（%）",
      numeric: true,
      render: (row) =>
        row.margin === null ? (
          "—"
        ) : (
          <>
            {formatNumber(row.margin, 1)}
            <span className="unit">
              （{formatNumber((row.margin / view.target) * 100, 1)}%）
            </span>
          </>
        ),
    },
    {
      id: "verdict",
      label: "判定",
      render: (row) => <StatusMark kind={row.verdict} />,
    },
    { id: "reason", label: "限制原因", wrap:true, render: (row) => <span title={row.reason}>{row.reason}</span> },
  ];
  const groups = (Object.keys(labels) as SelectionRow["verdict"][])
    .map((verdict) => ({
      id: verdict,
      label: labels[verdict],
      rows: view.rows
        .filter((row) => row.verdict === verdict)
        .sort((a, b) => (a.section ?? Infinity) - (b.section ?? Infinity)),
      defaultCollapsed: verdict === "inapplicable",
    }))
    .filter(
      (group) => group.rows.length && (filter === "all" || filter === group.id),
    );
  const recommended = view.recommendation;
  const recommendationBasis = recommended?.dependencies.length
    ? "结论依赖工程师给定参数；按已保存判定排序。"
    : "按已保存判定选择的最小满足截面。";
  const conclusion = recommended ? (
        <ConclusionStrip
          label={view.historical ? "历史最小满足候选" : "推荐型号"}
          conclusion={(view.historical ? '历史推荐：' : '推荐：') + recommended.name + (part === 'conclusion' ? '' : ' · '+recommendationBasis)}
          metrics={[
            {
              label: "保存温限下允许电流",
              value: recommended.current,
              unit: "A",
              precision: 1,
            },
            { label: "目标电流", value: view.target, unit: "A", precision: 0 },
            {
              label: recommended.margin === null ? '余量' : `余量（${formatNumber((recommended.margin / view.target) * 100, 1)}%）`,
              value: recommended.margin,
              unit: "A",
              precision: 1,
            },
          ]}
          historical={view.historical}
        />
      ) : (
        <EmptyState
          title={view.demo ? "候选尚未完成核对" : "当前条件下没有合格型号"}
          description={view.rows.length > 0 && view.rows.every(row=>row.verdict==='unsatisfied' && row.current!==null)
            ? `目标 ${formatNumber(view.target,1)} A；候选允许电流最高 ${formatNumber(Math.max(...view.rows.map(row=>row.current!)),1)} A。请调整型号范围、敷设或负荷后重算。`
            : '请在候选表查看各型号的限制原因；补齐缺项或调整工况后重算。'}
        />
      );
  if (part === "conclusion") return conclusion;
  return (
    <>
      {part === "all" && view.historical && (
        <StaleBanner description="以下为历史运行，仅供追溯，不能用于当前计算书。" />
      )}
      {part === "all" && dirty && (
        <StaleBanner description="有未保存修改；以下结果对应已保存研究。" />
      )}
      {part === "all" && conclusion}
      {part === 'all' && <SelectionConditions run={run} theme={theme} caseId={selectedId || recommended?.id} />}
      <Toolbar>
        <h2>候选结果</h2>
        <SourceBadge
          kind="calculation"
          detail={`${displayName(text(view.method.plugin_id))} ${text(view.method.version)} · 固定运行输出`}
        />
        <span className="muted">{view.rows.length} 项</span>
        <div className="spacer" />
        <Select
          label="显示"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部候选" },
            ...Object.entries(labels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
      </Toolbar>
      <div className="study-selection-table"><DataTable
        label="真实选型候选"
        historical={view.historical}
        columns={columns}
        groups={groups}
        selectedId={selectedId}
        onSelect={onSelect}
        rowLabel={(row) => `选择 ${row.name}`}
      /></div>
      {part === "details" && <div className="selection-conditions">
        <p className="muted">{recommendationBasis}</p>
        <SelectionConditions run={run} theme={theme} caseId={selectedId || recommended?.id} />
      </div>}
    </>
  );
}

function SelectionConditions({ run, theme, caseId }: {
  run: Record<string, unknown>;
  theme: "light" | "dark";
  caseId?: string;
}) {
  const input = useQuery({
    queryKey: ['drawing-saved-input', run.id, caseId],
    enabled: !!caseId,
    retry: false,
    queryFn: ({ signal }) => {
      if (run.integrity !== 'verified' || !text(run.id) || !text(run.workspace) || !text(run.study))
        throw Error('所选保存运行身份或完整性未通过，无法读取候选工况。');
      return hydrateCaseInputs(caseRun(run, caseId), signal);
    },
  });
  if (!caseId) return <p className="muted" role="status">请在候选表选择要查看的型号工况。</p>;
  const failed = (error: unknown) => <StudyErrorState title="候选工况读取失败" description={message(error)}
    action={<Button size="compact" onClick={() => void input.refetch()}>重新读取</Button>} />;
  if (input.isPending) return <LoadingState title="正在读取所选候选的保存工况" />;
  if (input.error) return failed(input.error);
  let domain: DomainDocument;
  try {
    const saved: Record<string, unknown> | undefined = input.data;
    if (run.integrity !== 'verified' || !saved || saved.integrity !== 'verified'
      || saved.id !== run.id || saved.workspace !== run.workspace || saved.study !== run.study
      || saved.input_digest !== run.input_digest)
      throw Error('保存工况输入身份或运行摘要不匹配，拒绝显示。');
    const outputCases = optionalRecord(saved.output).cases;
    if (!Array.isArray(outputCases) || outputCases.filter(value => optionalRecord(value).case_id === caseId).length !== 1)
      throw Error('所选工况不存在于此保存运行的输出中。');
    const cases = optionalRecord(saved.snapshot).cases;
    const matching = (Array.isArray(cases) ? cases : []).map(optionalRecord).filter(value => value.case_id === caseId);
    if (matching.length !== 1)
      throw Error('所选工况不存在于此保存运行的固定输入中。');
    const document = optionalRecord(matching[0].input);
    if (document.schema_version !== 'cablesim.domain/1' || !Array.isArray(document.sections) || !Array.isArray(document.materials))
      throw Error('所选候选的保存输入未提供有效敷设条件。');
    domain = document as unknown as DomainDocument;
  } catch (error) {
    return failed(error);
  }
  if (!domain.sections.length) return <p className="muted">该候选的保存输入未提供敷设条件</p>;
  function link(module: string, tab: string, label: string) {
    return <Link to="/studies/$sid/$module/$tab" params={{ sid: text(run.study), module, tab }}
      search={{ workspace: text(run.workspace), run: text(run.id), case: caseId, theme, delivery: "" }}>{label}</Link>;
  }
  return <div className="selection-conditions" aria-label="本次计算工况">
    {domain.sections.map(section => {
      const depths = [...new Set(section.placements.map(item => Number((-item.z).toFixed(3))))];
      const soil = domain.materials.find(item => item.id === section.medium.material);
      const temperature = numeric(section.kind === "ground" ? section.medium.surface_temperature : section.medium.air_temperature);
      const depth = section.kind === "ground" && depths.length ? ` · 埋深 ${depths.join(" / ")} m` : "";
      return <p key={section.id}>
        <span className="muted">本次工况：</span>
        {link("section", "coordinates", (section.label || "敷设截面") + depth)}
        {section.kind === "ground" && <> · {link("section", "media", `土壤 ${formatNumber(numeric(soil?.thermal_resistivity), 1)} K·m/W`)}</>}
        {" · "}{link("conditions", "inputs", temperature === null ? "环境温度未提供" : `${formatNumber(temperature - 273.15, 1)} °C`)}
      </p>;
    })}
  </div>;
}
