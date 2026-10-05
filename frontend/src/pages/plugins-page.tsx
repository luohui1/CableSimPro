import { useQuery } from "@tanstack/react-query";
import { displayName } from "@/lib/display-names";
import { downloadJson } from "@/lib/download";
import { useParams } from "@tanstack/react-router";
import { methodCatalog } from "@/api/research";
import type { CatalogRow } from "@/api/catalogs";
import { optionalRecord, text } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
const levels: Record<string, string> = {
  unverified: "未验证",
  interface_tested: "接口测试",
  analytic_benchmark: "解析基准",
  reference_benchmark: "参考基准",
  cross_validated: "交叉验证",
};
export function PluginsPage() {
  const query = useQuery({
      queryKey: ["method-catalog"],
      queryFn: ({ signal }) => methodCatalog(signal),
    }),
    { theme, navigate } = usePageTheme();
  const { pid } = useParams({ strict: false }) as { pid?: string };
  const rows: CatalogRow[] = (query.data || []).map((value) => ({
    ...value,
    id: text(optionalRecord(value.method).plugin_id),
  }));
  const selected = rows.find((value) => value.id === pid),
    caps: CatalogRow[] = (
      Array.isArray(selected?.capabilities) ? selected.capabilities : []
    )
      .map(optionalRecord)
      .map((value) => ({ ...value, id: text(value.id) }));
  return (
    <CatalogShell
      title={selected ? text(selected.name) : "插件"}
      active="插件"
      status={<span className="muted">{rows.length} 个已安装插件</span>}
      actions={
        pid ? (
          <Button
            size="compact"
            onClick={() => void navigate({ to: "/plugins", search: { theme } })}
          >
            返回插件列表
          </Button>
        ) : (
          <Tooltip content="正式宿主尚未提供插件安装接口">
            <span>
              <Button size="compact" disabled>
                安装插件
              </Button>
            </span>
          </Tooltip>
        )
      }
    >
      <div
        data-page={pid ? "plugin-detail" : "plugins"}
        data-state={
          query.isPending
            ? "loading"
            : query.error
              ? query.data
                ? "historical"
                : "error"
              : !rows.length
                ? "empty"
                : "success"
        }
      >
        <QueryState query={query} empty={!rows.length && "尚无已安装插件"}>
          {!pid ? (
            <DataTable
              label="已安装插件"
              rowLabel={(row) => text(row.name)}
              onActivate={(row) =>
                void navigate({
                  to: "/plugins/$pid",
                  params: { pid: row.id },
                  search: { theme },
                })
              }
              showGroups={false}
              groups={[{ id: "plugins", label: "插件", rows }]}
              columns={[
                { id: "name", label: "插件", render: (row) => text(row.name) },
                {
                  id: "version",
                  label: "版本",
                  render: (row) => text(optionalRecord(row.method).version),
                },
                {
                  id: "capabilities",
                  label: "能力",
                  wrap: true,
                  render: (row) =>
                    (Array.isArray(row.capabilities) ? row.capabilities : [])
                      .map((value) => text(optionalRecord(value).title))
                      .join("、"),
                },
                {
                  id: "platform",
                  label: "平台",
                  render: (row) => (
                    <StatusMark
                      kind={
                        row.platform_supported === true
                          ? "saved"
                          : "inapplicable"
                      }
                      label={
                        row.platform_supported === true
                          ? "支持当前平台"
                          : "当前平台未覆盖"
                      }
                    />
                  ),
                },
              ]}
            />
          ) : !selected ? (
            <EmptyState
              title="该插件未安装"
              description="返回列表查看已安装能力。"
            />
          ) : (
            <div className="input-module">
              <p className="muted">{text(selected.description)}</p>
              <DataTable
                label="插件能力与验证"
                rowLabel={(row) => text(row.title)}
                groups={[{ id: "capabilities", label: "能力", rows: caps }]}
                showGroups={false}
                columns={[
                  {
                    id: "title",
                    label: "能力",
                    render: (row) => text(row.title),
                  },
                  {
                    id: "validation",
                    label: "验证等级",
                    render: (row) =>
                      displayName(
                        text(optionalRecord(row.validation).level),
                        levels[text(optionalRecord(row.validation).level)] ||
                          undefined,
                      ),
                  },
                  {
                    id: "input",
                    label: "输入与版本",
                    render: (row) => (
                      <Tooltip
                        content={
                          text(row.input_schema) +
                          " · " +
                          text(row.method_version)
                        }
                      >
                        <span tabIndex={0}>
                          {displayName(text(row.analysis) || text(row.kind))}
                        </span>
                      </Tooltip>
                    ),
                  },
                  {
                    id: "scope",
                    label: "声明范围",
                    wrap: true,
                    render: (row) =>
                      (Array.isArray(row.limitations) ? row.limitations : [])
                        .map(String)
                        .join("；"),
                  },
                ]}
              />
              <Button
                size="compact"
                onClick={() =>
                  downloadJson(
                    {
                      method: selected.method,
                      execution_policy: selected.execution_policy,
                      validation: caps.map((cap) => ({
                        capability: cap.id,
                        ...optionalRecord(cap.validation),
                      })),
                    },
                    "plugin-evidence.json",
                  )
                }
              >
                下载验证证据与发行摘要
              </Button>
            </div>
          )}
        </QueryState>
      </div>
    </CatalogShell>
  );
}
