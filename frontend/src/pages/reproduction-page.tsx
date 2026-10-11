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
import { DuctSensitivity } from "@/features/field/duct-sensitivity";
import { METRIC_STATES, VALIDATION_STATES, quantityLabel } from "@/lib/validation-labels";
import { ComparisonDots } from "@/components/comparison-dots";
import { displayUnit } from "@/lib/display-names";
import '@/features/field/reproduction-scope.css';
const kinds: Record<string, string> = {
  paper: "论文",
  standard: "标准与报告",
  comsol: "商业软件参考",
  benchmark: "解析与教学基准",
};
// Source type describes the document, not whether the complete model was verified.
function evidencePurpose(row: CatalogRow) {
  if (row.kind === 'standard') return row.has_results === true ? '公开算例 · 保存对拍' : '标准与报告参考';
  if (row.kind === 'benchmark') return '解析交叉核对';
  if (row.kind === 'comsol') return '软件方法参考';
  return '文献方法参考';
}
const variantName = (row: CatalogRow) => text(row.variant_name) || text(row.variant) || '情形未命名';
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
async function readEvidence<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof TypeError) throw new Error(navigator.onLine
      ? '证据服务暂不可达；已保存数据保留，请检查连接后重新读取。'
      : '网络连接已断开；已保存数据保留，请恢复网络后重新读取。');
    throw error;
  }
}
function sourceLocation(row: CatalogRow) {
  const pages = [numeric(row.pdf_page) !== null ? `PDF 第 ${numeric(row.pdf_page)} 页` : '',
    numeric(row.printed_page) !== null ? `印刷第 ${numeric(row.printed_page)} 页` : ''].filter(Boolean);
  return pages.join(' · ') || text(row.locator) || text(row.section) || text(row.revision) || '见来源文件或网页定位';
}
const STATE_ORDER: Record<string, number> = { reproduced: 0, partial: 1, capability_gap: 2, missing_data: 3 };
const tabs = {
  results: "结果对照",
  overlay: "曲线叠加",
  convergence: "网格收敛",
  sources: "输入来源",
  scope: "覆盖与限制",
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
    queryFn: ({ signal }) => readEvidence(() => reproductions(snapshot, signal)),
    networkMode: 'always', retry: false,
  });
  const detail = useQuery({
    queryKey: ["reproduction", target, snapshot],
    queryFn: ({ signal }) => readEvidence(() => reproductionDetail(target!, snapshot, signal)),
    networkMode: 'always', retry: false,
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
  )
    // 有结果的先看：已复现 → 部分复现 → 能力未覆盖 → 缺资料；同一状态保持原顺序
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (STATE_ORDER[text(a.item.status)] ?? 9) - (STATE_ORDER[text(b.item.status)] ?? 9) || a.index - b.index)
    .map(({ item }) => item);
  const historical = data?.historical === true;
  const history = (Array.isArray(data?.history) ? data.history : []).map(
    optionalRecord,
  );
  const options = [
    { value: "", label: "当前记录" },
    ...history.slice(1).map((row) => ({
      value: text(row.id),
      label: "历史 · " + (text(row.created_at) ? new Date(text(row.created_at)).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "时间未记录"),
    })),
  ];
  function changeSnapshot(snapshot: string) {
    void navigate({
      to: window.location.pathname,
      search: { theme, snapshot },
    });
  }
  const groups = new Map<string, CatalogRow[]>();
  // 比较量下拉的显示名：网格收敛按“情形 · 量”，结果对照按“量（单位）”
  const groupNames = new Map<string, string>();
  if (activeTab === "convergence")
    for (const value of Array.isArray(detail.data?.convergence)
      ? detail.data.convergence
      : []) {
      const row = optionalRecord(value),
        key = text(row.variant) + " · " + text(row.quantity);
      groupNames.set(key, `${variantName(row as CatalogRow)} · ${quantityLabel(text(row.quantity))}`);
      groups.set(key, [
        ...(groups.get(key) || []),
        { ...row, id: String(groups.get(key)?.length || 0) },
      ]);
    }
  else
    for (const row of rows) {
      const key = text(row.quantity) + " · " + text(row.unit);
      groupNames.set(key, `${quantityLabel(text(row.quantity))}${text(row.unit) && text(row.unit) !== "1" ? `（${displayUnit(text(row.unit))}）` : ""}`);
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
  const limitations = strings(detail.data?.limitations);
  const keyLimits = [...limitations.filter(value => value.includes('口径差异')),
    ...limitations.filter(value => !value.includes('口径差异'))].slice(0, 3);
  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) =>
        void navigate({
          to: "/validation/$target/$tab",
          params: { target: target!, tab },
          search: { theme, snapshot },
        })
      }
    >
      <CatalogShell
        title={target ? text(detail.data?.short_title) || "验证算例" : "验证算例"}
        path={target ? "验证算例" : undefined}
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
              to="/validation"
              search={{ theme, snapshot }}
            >
              全部验证目标
            </Link>
            <div className="spacer" />
            <Select
              label="记录版本"
              // 链接固定的是当前快照时，显示为“当前记录”
              value={snapshot && snapshot === text(history[0]?.id) ? "" : snapshot}
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
                  ? (catalog.data?.items || []).length ? "没有匹配的验证目标" : "尚无保存验证证据；请由管理员导入经校验的证据快照。"
                  : false
            }
          >
            {historical && (
              <StaleBanner description="历史证据快照，原始结果与来源保持不变。" />
            )}
            {!target ? (
              <>
                <p className="validation-purpose-note">验证目标包含公开算例、方法参考和解析基准。复现状态仅说明列明范围内的保存对拍，不代表未覆盖工况已验证。</p>
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
                      ...Object.entries(VALIDATION_STATES).map(([value, label]) => ({
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
                      to: "/validation/$target/$tab",
                      params: { target: row.id, tab: "results" },
                      search: { theme, snapshot },
                    })
                  }
                  showGroups={false}
                  groups={[{ id: "targets", label: "目标", rows: items }]}
                  columns={[
                    {
                      id: "name",
                      label: "验证目标",
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
                      id: "purpose",
                      label: "证据用途",
                      wrap: true,
                      render: evidencePurpose,
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
                        VALIDATION_STATES[text(row.status)] || text(row.status),
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
                      label: "保存对拍范围",
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
                      {VALIDATION_STATES[text(detail.data?.status)] || "复现状态未提供"}
                    </h2>
                    <p>{evidencePurpose((detail.data || {}) as CatalogRow)} · 来源：{kinds[text(detail.data?.kind)] || '来源类型未登记'}</p>
                  </section>
                  <section className="validation-scope" aria-label="适用范围与关键限制">
                    <h2>保存对拍范围</h2>
                    <p>{text(detail.data?.scope) || '范围未登记，不能据此判断工程适用性。'}</p>
                    {keyLimits.length ? <><h3>关键限制</h3><ul>{keyLimits.map(value => <li key={value}>{value}</li>)}</ul></>
                      : <p>限制未登记；不表示所有工况均已覆盖。</p>}
                    {activeTab !== 'scope' && limitations.length > keyLimits.length && <Link to="/validation/$target/$tab"
                      params={{ target: target!, tab: 'scope' }} search={{ theme, snapshot }}>查看全部 {limitations.length} 项限制与假设</Link>}
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
                                  {quantityLabel(text(row.quantity))}{" "}
                                  · {variantName(row)}
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
                              METRIC_STATES[text(row.status)] || text(row.status),
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
                          options={[...groups.keys()].map((value) => ({ value, label: groupNames.get(value) || value }))}
                        />
                        {activeTab === "overlay" ? (
                          <ComparisonDots
                            unit={unit}
                            rows={chosen.map((row) => ({
                              id: row.id,
                              label: variantName(row),
                              values: { reference: numeric(row.reference), open_source: numeric(row.open_source), comsol: numeric(row.comsol) },
                            }))}
                          />
                        ) : <SeriesChart
                          key={target + '/' + activeTab + '/' + metric}
                          controls
                          quantity={quantity}
                          unit={unit}
                          xLabel={
                            activeTab === "convergence"
                              ? "网格节点数"
                              : "样本序号"
                          }
                          yLabel={quantityLabel(quantity)}
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
                                      label: variantName(row),
                                    })),
                                  }),
                                )
                          }
                        />}
                        {activeTab === "convergence" && <p className="muted">{text(detail.data?.mesh_note)}</p>}
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
                            label: "来源定位",
                            wrap: true,
                            render: sourceLocation,
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
                      {limitations.length > keyLimits.length && <section className="input-section">
                        <h2>其余限制</h2>
                        <ul className="validation-limit-list">{limitations.filter(value => !keyLimits.includes(value)).map(value => <li key={value}>{value}</li>)}</ul>
                      </section>}
                      {!!strings(detail.data?.assumptions).length && <section className="input-section">
                        <h2>计算假设</h2>
                        <ul className="validation-limit-list">{strings(detail.data?.assumptions).map(value => <li key={value}>{value}</li>)}</ul>
                      </section>}
                      {/* 有保存的敏感性诊断（如 TB 880 排管）才显示；其他算例不放空表 */}
                      {detail.data?.sensitivity ? <DuctSensitivity data={detail.data} historical={historical} /> : null}
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
