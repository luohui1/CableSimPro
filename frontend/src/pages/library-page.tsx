import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetCatalog, assetDetail, importAsset } from "@/api/catalogs";
import { message, numeric, optionalRecord, text } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { CatalogShell } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { DataTable } from "@/components/data-table";
import { CableShelf } from "@/components/cable-shelf";
import { PropertyPanel } from "@/components/property-panel";
import { StatusMark } from "@/components/status-mark";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/states";
const kinds = {
  material: "材料",
  component: "部件",
  assembly: "结构",
  installation: "敷设模板",
  study_template: "计算方案",
  rule: "规则",
};
const statuses = {
  draft: "草稿",
  reviewed: "已审核",
  published: "已发布",
  deprecated: "已停用",
};
export function LibraryPage() {
  const queries = useQueryClient();
  const [q, setQ] = useState(""),
    [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all"),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(""),
    [open, setOpen] = useState(false),
    [raw, setRaw] = useState(""),
    [fileError, setFileError] = useState("");
  const query = useQuery({
    queryKey: ["asset-catalog", q, kind, status, offset],
    queryFn: ({ signal }) =>
      assetCatalog(
        {
          q,
          kind:
            kind === "all"
              ? undefined
              : (kind as components["schemas"]["AssetRelease"]["kind"]),
          status:
            status === "all" ? undefined : (status as keyof typeof statuses),
          offset,
        },
        signal,
      ),
  });
  const detail = useQuery({
    queryKey: ["asset", selected],
    queryFn: ({ signal }) => assetDetail(selected, signal),
    enabled: !!selected,
  });
  const importing = useMutation({
    retry: false,
    mutationFn: async () => {
      if (new TextEncoder().encode(raw).length > 120 * 1024)
        throw Error("资源文件超过 120 KB，请缩小 JSON 定义。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw Error("请输入有效 JSON；尚未创建资源。");
      }
      return importAsset(
        optionalRecord(value).release
          ? (optionalRecord(value)
              .release as components["schemas"]["AssetRelease"])
          : value,
      );
    },
    onSuccess: async (value) => {
      setOpen(false);
      setRaw("");
      setSelected(text(value.id));
      await queries.invalidateQueries({ queryKey: ["asset-catalog"] });
    },
  });
  const rows = query.data?.items || [],
    release = optionalRecord(detail.data?.release);
  return (
    <CatalogShell
      title="库"
      active="库"
      status={
        <span className="muted">其他资源 {numeric(query.data?.total) ?? 0} 项</span>
      }
      actions={
        <Button
          variant="primary"
          size="compact"
          onClick={() => {
            importing.reset();
            setFileError("");
            setOpen(true);
          }}
        >
          导入资源草稿
        </Button>
      }
      property={
        selected ? (
          <PropertyPanel
            collapsed={false}
            title={text(detail.data?.name) || "所选资源"}
            groups={[
              {
                label: "保存的定义",
                items: detail.isPending
                  ? [
                      {
                        label: "状态",
                        value: <LoadingState title="正在读取资源" />,
                      },
                    ]
                  : detail.error
                    ? [{ label: "错误", value: message(detail.error) }]
                    : Object.entries(release)
                        .filter(([key]) => !["files", "sources"].includes(key))
                        .map(([label, value]) => ({
                          label,
                          value:
                            typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value),
                        })),
              },
              {
                label: "来源与审核",
                items: (Array.isArray(release.sources)
                  ? release.sources
                  : []
                ).map((value, index) => ({
                  label: "来源 " + (index + 1),
                  value: text(optionalRecord(value).reference),
                  source: "document" as const,
                  sourceDetail: JSON.stringify(value),
                })),
              },
            ]}
            onToggle={() => setSelected("")}
          />
        ) : undefined
      }
    >
      <CableShelf />
      <Toolbar label="资源筛选">
        <label className="search-field">
          检索
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setOffset(0);
            }}
            placeholder="资源名称"
          />
        </label>
        <Select
          label="类别"
          value={kind}
          onChange={(value) => {
            setKind(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: "全部" },
            ...Object.entries(kinds).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Select
          label="状态"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: "全部" },
            ...Object.entries(statuses).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
      </Toolbar>
      <div
        data-page="library"
        data-state={
          query.isPending
            ? "loading"
            : query.error
              ? query.data
                ? "historical"
                : "error"
              : !rows.length
                ? "empty"
                : rows.every((row) => row.status === "deprecated")
                  ? "historical"
                  : "success"
        }
      >
        <QueryState query={query} empty={!rows.length && "没有匹配资源"}>
          <DataTable
            label="资源库"
            selectedId={selected}
            onSelect={(row) => setSelected(row.id)}
            rowLabel={(row) => text(row.name)}
            showGroups={false}
            groups={[{ id: "assets", label: "资源", rows }]}
            columns={[
              {
                id: "name",
                label: "名称",
                wrap: true,
                render: (row) => text(row.name),
              },
              {
                id: "kind",
                label: "类别",
                render: (row) =>
                  kinds[text(row.kind) as keyof typeof kinds] || text(row.kind),
              },
              {
                id: "version",
                label: "版本",
                render: (row) => text(row.version),
              },
              {
                id: "status",
                label: "状态",
                render: (row) => (
                  <StatusMark
                    kind={
                      row.status === "published"
                        ? "saved"
                        : row.status === "deprecated"
                          ? "historical"
                          : "draft"
                    }
                    label={
                      statuses[text(row.status) as keyof typeof statuses] ||
                      text(row.status)
                    }
                  />
                ),
              },
              {
                id: "updated",
                label: "更新时间",
                render: (row) => text(row.updated),
              },
            ]}
          />
        </QueryState>
      </div>
      {(numeric(query.data?.total) || 0) > 50 && (
        <Toolbar>
          <Button
            disabled={!offset}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            上一页
          </Button>
          <span>
            {offset + 1}–{offset + rows.length}
          </span>
          <Button
            disabled={offset + rows.length >= (numeric(query.data?.total) || 0)}
            onClick={() => setOffset((value) => value + 50)}
          >
            下一页
          </Button>
        </Toolbar>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!importing.isPending) setOpen(value);
        }}
        title="导入资源草稿"
        description="JSON 定义将由宿主整体校验，保存为未发布草稿。"
        initialFocus="form"
        actions={
          <Button
            variant="primary"
            loading={importing.isPending}
            disabled={!raw.trim() || !!fileError}
            onClick={() => importing.mutate()}
          >
            校验并导入
          </Button>
        }
      >
        <label className="text-field">
          资源 JSON
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 120 * 1024) {
                setFileError("文件超过 120 KB，请缩小 JSON 定义。");
                return;
              }
              setFileError("");
              setRaw(await file.text());
              importing.reset();
            }}
          />
        </label>
        <label className="text-field">
          定义内容
          <textarea
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              importing.reset();
            }}
          />
        </label>
        {(fileError || importing.error) && (
          <p role="alert" className="field-error">
            {fileError || message(importing.error)}
          </p>
        )}
        {!raw && <EmptyState title="选择有来源的资源定义" description="" />}
      </Dialog>
    </CatalogShell>
  );
}
