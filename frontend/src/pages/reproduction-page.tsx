import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  reproductions,
  reproductionDetail,
  type CatalogRow,
} from "@/api/catalogs";
import { optionalRecord, text, numeric } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { DataTable } from "@/components/data-table";
import { Toolbar } from "@/components/toolbar";
import { EngineeringValue } from "@/components/engineering-value";
import { deferredView } from '@/components/deferred-view';
const SeriesChart = deferredView(() => import('@/components/series-chart').then(m => ({ default: m.SeriesChart })));
import { EmptyState, StaleBanner } from "@/components/states";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { downloadJson } from "@/lib/download";
const kinds: Record<string, string> = {
  paper: "论文",
  standard: "标准算例",
  comsol: "COMSOL 教程",
  benchmark: "教学基准",
};
const statuses: Record<string, string> = {
  reproduced: "声明范围内已复现",
  partial: "部分覆盖",
  missing_data: "缺资料",
  capability_gap: "能力未覆盖",
};
const tabs = {
  results: "结果对照",
  overlay: "曲线叠加",
  convergence: "网格收敛",
  sources: "输入来源",
  scope: "覆盖与限制",
};
const quantities: Record<string, string> = {
  conductor_max_temperature_k: "导体最高温度",
  interface_nodal_mean_k: "界面节点平均温度",
  maximum_temperature_k: "最高温度",
  ampacity_a: "允许电流",
  ac_resistance_ohm_m: "交流电阻",
  series_resistance_ohm_m: "线对交流电阻",
  lambda1: "护套损耗系数",
  conductor_loss_w_m: "导体损耗",
  sheath_loss_w_m: "护套损耗",
  total_loss_w_m: "总损耗",
};
export function ReproductionPage() {
  const { theme, search, navigate } = usePageTheme(),
    { target, tab } = useParams({ strict: false }) as {
      target?: string;
      tab?: string;
    };
  const snapshot = text(search.snapshot),
    activeTab = tab && tab in tabs ? (tab as keyof typeof tabs) : "results";
  const [filter, setFilter] = useState(""),
    [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all"),
    [metric, setMetric] = useState("");
  const catalog = useQuery({
    queryKey: ["reproductions", snapshot],
    queryFn: ({ signal }) => reproductions(snapshot, signal),
  });
  const detail = useQuery({
    queryKey: ["reproduction", target, snapshot],
    queryFn: ({ signal }) => reproductionDetail(target!, snapshot, signal),
    enabled: !!target,
  });
  const query = target ? detail : catalog,
    data = target ? detail.data : catalog.data;
  const rows: CatalogRow[] = (
    Array.isArray(detail.data?.rows) ? detail.data.rows : []
  )
    .map(optionalRecord)
    .map((row, index) => ({ ...row, id: text(row.id) || String(index) }));
  const items = (catalog.data?.items || []).filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (status === "all" || item.status === status) &&
      [item.id, item.title, item.short_title, item.citation]
        .join(" ")
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const historical = data?.historical === true;
  const history = (Array.isArray(data?.history) ? data.history : []).map(
    optionalRecord,
  );
  const options = [
    { value: "", label: "当前记录" },
    ...history.slice(1).map((row) => ({
      value: text(row.id),
      label: "历史 · " + text(row.created_at),
    })),
  ];
  function changeSnapshot(snapshot: string) {
    void navigate({
      to: window.location.pathname,
      search: { theme, snapshot },
    });
  }
  const groups = new Map<string, CatalogRow[]>();
  if (activeTab === "convergence")
    for (const value of Array.isArray(detail.data?.convergence)
      ? detail.data.convergence
      : []) {
      const row = optionalRecord(value),
        key = text(row.variant) + " · " + text(row.quantity);
      groups.set(key, [
        ...(groups.get(key) || []),
        { ...row, id: String(groups.get(key)?.length || 0) },
      ]);
    }
  else
    for (const row of rows) {
      const key = text(row.quantity) + " · " + text(row.unit);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
  const chosen = groups.get(metric) || groups.values().next().value || [];
  const representative =
    activeTab === "convergence"
      ? rows.find(
          (row) =>
            row.id.endsWith("/" + text(chosen[0]?.quantity)) ||
            row.quantity === chosen[0]?.quantity,
        )
      : chosen[0];
  const unit = text(representative?.unit),
    quantity = text(representative?.quantity);
  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) =>
        void navigate({
          to: "/library/reproductions/$target/$tab",
          params: { target: target!, tab },
          search: { theme, snapshot },
        })
      }
    >
      <CatalogShell
        title={target ? text(detail.data?.short_title) || "复现详情" : "复现库"}
        active="库"
        status={
          <StatusMark
            kind={historical ? "historical" : "saved"}
            label={historical ? "历史证据" : "保存证据"}
          />
        }
        actions={
          target ? (
            <Button
              variant="primary"
              size="compact"
              disabled={!detail.data || !!detail.error}
              onClick={() =>
                downloadJson(detail.data, "reproduction-" + target + ".json")
              }
            >
              导出对照
            </Button>
          ) : (
            <Button size="compact" onClick={() => void catalog.refetch()}>
              刷新
            </Button>
          )
        }
        tabs={
          target ? (
            <TabsList aria-label="复现详情页签">
              {Object.entries(tabs).map(([id, label]) => (
                <TabsTrigger key={id} value={id}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : undefined
        }
      >
        <div
          data-page={target ? "reproduction-detail" : "reproductions"}
          data-state={
            query.isPending
              ? "loading"
              : query.error
                ? data
                  ? "historical"
                  : "error"
                : !data ||
                    (target
                      ? !rows.length && activeTab === "results"
                      : !items.length)
                  ? "empty"
                  : historical
                    ? "historical"
                    : "success"
          }
          onKeyDown={(event) => {
            if (
              target &&
              detail.data &&
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              downloadJson(detail.data, "reproduction-" + target + ".json");
            }
          }}
        >
          <Toolbar>
            <Link
              className="object-link"
              to="/library/reproductions"
              search={{ theme, snapshot }}
            >
              全部复现目标
            </Link>
            <div className="spacer" />
            <Select
              label="记录版本"
              value={snapshot}
              onChange={changeSnapshot}
              options={options}
            />
          </Toolbar>
          <QueryState
            query={query}
            empty={
              !data
                ? "尚无复现记录"
                : !target && !items.length
                  ? (catalog.data?.items || []).length ? "没有匹配的复现目标" : "尚无复现记录：在研究里运行「仿真复现」后，结果与证据保存在这里"
                  : false
            }
          >
            {historical && (
              <StaleBanner description="历史证据快照，原始结果与来源保持不变。" />
            )}
            {!target ? (
              <>
                <Toolbar label="复现检索">
                  <label className="search-field">
                    检索
                    <input
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="目标、来源或编号"
                    />
                  </label>
                  <Select
                    label="来源类型"
                    value={kind}
                    onChange={setKind}
                    options={[
                      { value: "all", label: "全部" },
                      ...Object.entries(kinds).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                  <Select
                    label="覆盖状态"
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: "all", label: "全部" },
                      ...Object.entries(statuses).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                </Toolbar>
                <DataTable
                  label="复现目标"
                  rowLabel={(row) => text(row.short_title) || text(row.title)}
                  onActivate={(row) =>
                    void navigate({
                      to: "/library/reproductions/$target/$tab",
                      params: { target: row.id, tab: "results" },
                      search: { theme, snapshot },
                    })
                  }
                  showGroups={false}
                  groups={[{ id: "targets", label: "目标", rows: items }]}
                  columns={[
                    {
                      id: "name",
                      label: "复现目标",
                      wrap: true,
                      render: (row) => (
                        <Tooltip content={text(row.title)}>
                          <span tabIndex={0}>
                            {text(row.short_title) || text(row.title)}
                          </span>
                        </Tooltip>
                      ),
                    },
                    {
                      id: "kind",
                      label: "来源",
                      render: (row) => kinds[text(row.kind)] || text(row.kind),
                    },
                    {
                      id: "status",
                      label: "覆盖状态",
                      render: (row) =>
                        statuses[text(row.status)] || text(row.status),
                    },
                    {
                      id: "original",
                      label: "对原文最大相对偏差",
                      numeric: true,
                      render: (row) => (
                        <EngineeringValue
                          quantity="relative_difference"
                          value={
                            numeric(row.max_relative_deviation) === null
                              ? null
                              : numeric(row.max_relative_deviation)! * 100
                          }
                          unit="%"
                          withUnit
                        />
                      ),
                    },
                    {
                      id: "scope",
                      label: "范围",
                      wrap: true,
                      render: (row) => text(row.scope),
                    },
                  ]}
                />
              </>
            ) : (
              <TabsContent value={activeTab}>
                <div className="input-module">
                  <section className="evidence-summary">
                    <h2>
                      {statuses[text(detail.data?.status)] || "复现状态未提供"}
                    </h2>
                    <p className="muted">{text(detail.data?.scope)}</p>
                  </section>
                  {activeTab === "results" ? (
                    rows.length ? (
                      <DataTable
                        label="原文、开源与 COMSOL 对照"
                        rowLabel={(row) => text(row.quantity)}
                        showGroups={false}
                        groups={[{ id: "results", label: "结果", rows }]}
                        columns={[
                          {
                            id: "quantity",
                            label: "物理量 / 工况",
                            wrap: true,
                            render: (row) => (
                              <Tooltip
                                content={text(row.reason) || text(row.variant)}
                              >
                                <span tabIndex={0}>
                                  {quantities[text(row.quantity)] ||
                                    text(row.quantity)}{" "}
                                  · {text(row.variant)}
                                </span>
                              </Tooltip>
                            ),
                          },
                          ...(
                            [
                              "reference",
                              "open_source",
                              "comsol",
                              "difference",
                            ] as const
                          ).map((key) => ({
                            id: key,
                            label: {
                              reference: "原文",
                              open_source: "开源",
                              comsol: "COMSOL",
                              difference: "开源 − 原文",
                            }[key],
                            numeric: true,
                            render: (row: CatalogRow) => (
                              <EngineeringValue
                                quantity={
                                  key === "difference"
                                    ? "difference"
                                    : text(row.quantity)
                                }
                                value={numeric(row[key])}
                                unit={text(row.unit)}
                                withUnit
                              />
                            ),
                          })),
                          {
                            id: "status",
                            label: "比较状态",
                            render: (row) =>
                              ({
                                matched: "在声明容差内",
                                outside_tolerance: "超出声明容差",
                                not_comparable: "口径不可比",
                                missing_reference: "原文缺项",
                              })[text(row.status)] || text(row.status),
                          },
                        ]}
                      />
                    ) : (
                      <EmptyState
                        title="尚无可比较的保存结果"
                        description={text(detail.data?.coverage)}
                      />
                    )
                  ) : activeTab === "overlay" || activeTab === "convergence" ? (
                    groups.size ? (
                      <>
                        <Select
                          label="比较量"
                          value={
                            groups.has(metric)
                              ? metric
                              : groups.keys().next().value
                          }
                          onChange={setMetric}
                          options={[...groups.keys()].map((value) => ({
                            value,
                            label: value,
                          }))}
                        />
                        <SeriesChart
                          key={target + '/' + activeTab + '/' + metric}
                          controls
                          quantity={quantity}
                          unit={unit}
                          xLabel={
                            activeTab === "convergence"
                              ? "网格节点数"
                              : "样本序号"
                          }
                          yLabel={quantities[quantity] || quantity}
                          series={
                            activeTab === "convergence"
                              ? ["open_source", "comsol"].map((solver) => ({
                                  id: solver,
                                  label:
                                    solver === "open_source"
                                      ? "开源"
                                      : "COMSOL",
                                  points: chosen
                                    .filter((row) => row.solver === solver)
                                    .sort(
                                      (a, b) =>
                                        (numeric(a.nodes) || 0) -
                                        (numeric(b.nodes) || 0),
                                    )
                                    .map((row) => ({
                                      x: numeric(row.nodes)!,
                                      y: numeric(row.value),
                                    })),
                                }))
                              : ["reference", "open_source", "comsol"].map(
                                  (key) => ({
                                    id: key,
                                    label: {
                                      reference: "原文",
                                      open_source: "开源",
                                      comsol: "COMSOL",
                                    }[key]!,
                                    points: chosen.map((row, index) => ({
                                      x: index + 1,
                                      y: numeric(row[key]),
                                      label: text(row.variant),
                                    })),
                                  }),
                                )
                          }
                        />
                        <p className="muted">
                          {activeTab === "convergence"
                            ? text(detail.data?.mesh_note)
                            : "连线仅连接保存样本；缺失值留空。"}
                        </p>
                      </>
                    ) : (
                      <EmptyState
                        title={
                          activeTab === "convergence"
                            ? "没有网格序列"
                            : "没有曲线数据"
                        }
                        description={text(detail.data?.mesh_note)}
                      />
                    )
                  ) : activeTab === "sources" ? (
                    <>
                      <section className="input-section">
                        <h2>原始文献与定位</h2>
                        <p>{text(detail.data?.citation)}</p>
                        <p className="muted">
                          {text(detail.data?.reference_location)}
                        </p>
                        {text(detail.data?.url) && (
                          <a
                            className="object-link"
                            href={text(detail.data?.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            打开原文来源
                          </a>
                        )}
                      </section>
                      <DataTable
                        label="输入来源"
                        rowLabel={(row) => text(row.source)}
                        showGroups={false}
                        groups={[
                          {
                            id: "sources",
                            label: "来源",
                            rows: (Array.isArray(detail.data?.inputs)
                              ? detail.data.inputs
                              : []
                            )
                              .map(optionalRecord)
                              .map(
                                (row, index) =>
                                  ({ ...row, id: String(index) }) as CatalogRow,
                              ),
                          },
                        ]}
                        columns={[
                          {
                            id: "source",
                            label: "来源",
                            render: (row) => text(row.source),
                          },
                          {
                            id: "location",
                            label: "页码",
                            render: (row) =>
                              "PDF " +
                              (numeric(row.pdf_page) ?? "—") +
                              " · 印刷 " +
                              (numeric(row.printed_page) ?? "—"),
                          },
                          {
                            id: "input",
                            label: "输入与说明",
                            wrap: true,
                            render: (row) => text(row.note),
                          },
                        ]}
                      />
                      <Button
                        size="compact"
                        onClick={() =>
                          downloadJson(
                            {
                              runs: detail.data?.runs,
                              evidence: detail.data?.evidence,
                            },
                            "reproduction-evidence.json",
                          )
                        }
                      >
                        下载固定运行、工件与摘要
                      </Button>
                    </>
                  ) : (
                    <>
                      <section className="input-section">
                        <h2>已覆盖范围</h2>
                        <p>{text(detail.data?.coverage)}</p>
                      </section>
                      <section className="input-section">
                        <h2>限制与假设</h2>
                        {[
                          ...(Array.isArray(detail.data?.limitations)
                            ? detail.data.limitations
                            : []),
                          ...(Array.isArray(detail.data?.assumptions)
                            ? detail.data.assumptions
                            : []),
                        ].map((value, index) => (
                          <p key={index}>{String(value)}</p>
                        ))}
                      </section>
                    </>
                  )}
                </div>
              </TabsContent>
            )}
          </QueryState>
        </div>
      </CatalogShell>
    </Tabs>
  );
}
