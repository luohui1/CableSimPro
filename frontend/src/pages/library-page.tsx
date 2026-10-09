import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetCatalog, assetDetail, importAsset } from "@/api/catalogs";
import { message, numeric, optionalRecord, text } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { CatalogShell } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { PropertyPanel } from "@/components/property-panel";
import { RelationPanel } from "@/components/relation-panel";
import { StatusMark } from "@/components/status-mark";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineEmpty, LoadingState } from "@/components/states";

type AssetKind = components["schemas"]["AssetRelease"]["kind"];
const kinds: Record<string, string> = {
  material: "材料",
  component: "部件",
  assembly: "结构",
  installation: "敷设模板",
  study_template: "计算方案",
  rule: "规则",
};
/** 资源按类别拆成三张表（FRONTEND_REQUIREMENTS §2.2 / §2.3）；电缆型号版本另有自己的页面。 */
const groups = {
  materials: { title: "材料与部件", kinds: ["material", "component", "assembly"], empty: "还没有材料或部件" },
  templates: { title: "模板与计算方案", kinds: ["installation", "study_template"], empty: "还没有敷设模板或计算方案" },
  standards: { title: "标准与规则", kinds: ["rule"], empty: "还没有规则" },
} as const;
const statuses: Record<string, string> = {
  draft: "草稿",
  reviewed: "已审核",
  published: "已发布",
  deprecated: "已停用",
};
const PAGE = 50;

export function AssetsPage() {
  const { group: groupId } = useParams({ strict: false }) as { group: keyof typeof groups };
  const group = groups[groupId] || groups.materials;
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { item } = useSearch({ strict: false }) as { item?: string };
  const selected = item || "";
  const setSelected = (id: string) => void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, item: id || undefined }), replace: true });
  const [q, setQ] = useState(""),
    [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all"),
    [open, setOpen] = useState(false),
    [raw, setRaw] = useState(""),
    [fileError, setFileError] = useState("");
  // 接口一次只按一个类别筛选：本组每个类别各取一页再合并，避免在前端截断分页
  const shown = kind === "all" ? group.kinds : [kind as AssetKind];
  const pages = useQueries({
    queries: shown.map((value) => ({
      queryKey: ["asset-catalog", q, value, status],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        assetCatalog({ q, kind: value as AssetKind, status: status === "all" ? undefined : (status as "draft"), offset: 0 }, signal),
    })),
  });
  const pending = pages.some((page) => page.isPending);
  const failure = pages.find((page) => page.error)?.error;
  const rows = pages
    .flatMap((page) => page.data?.items || [])
    .sort((a, b) => text(b.updated).localeCompare(text(a.updated)));
  const truncated = pages.some((page) => (numeric(page.data?.total) || 0) > PAGE);
  const detail = useQuery({
    queryKey: ["asset-detail", selected],
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
          ? (optionalRecord(value).release as components["schemas"]["AssetRelease"])
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
  const release = optionalRecord(detail.data?.release);
  const openImport = () => {
    importing.reset();
    setFileError("");
    setOpen(true);
  };
  const filtered = !!q || kind !== "all" || status !== "all";
  return (
    <CatalogShell
      title={group.title}
      status={<span className="muted">{rows.length} 项 · 研究按版本引用</span>}
      actions={<Button variant="primary" size="compact" onClick={openImport}>导入资源草稿</Button>}
      property={
        selected ? (
          <PropertyPanel
            collapsed={false}
            title={text(detail.data?.name) || "所选资源"}
            groups={[
              {
                label: "保存的定义",
                items: detail.isPending
                  ? [{ label: "状态", value: <LoadingState title="正在读取资源" /> }]
                  : detail.error
                    ? [{ label: "错误", value: message(detail.error) }]
                    : Object.entries(release)
                        .filter(([key]) => !["files", "sources"].includes(key))
                        .map(([label, value]) => ({
                          label,
                          value: typeof value === "object" ? JSON.stringify(value) : String(value),
                        })),
              },
              {
                label: "来源与审核",
                items: (Array.isArray(release.sources) ? release.sources : []).map((value, index) => ({
                  label: "来源 " + (index + 1),
                  value: text(optionalRecord(value).reference),
                  source: "document" as const,
                  sourceDetail: JSON.stringify(value),
                })),
              },
            ]}
            extra={<section aria-label="关联"><h3>关联</h3><RelationPanel kind="asset" id={selected} /></section>}
            onToggle={() => setSelected("")}
          />
        ) : undefined
      }
    >
      {!filtered && !pending && !failure && !rows.length ? (
        <InlineEmpty title={`${group.empty}。导入资源草稿，审核发布后研究才能引用。`} action={<Button size="compact" onClick={openImport}>导入资源草稿</Button>} />
      ) : (
        <>
          <Toolbar label="资源筛选">
            <label className="search-field">
              检索
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="资源名称" />
            </label>
            {group.kinds.length > 1 && (
              <Select
                label="类别"
                value={kind}
                onChange={setKind}
                options={[{ value: "all", label: "全部" }, ...group.kinds.map((value) => ({ value, label: kinds[value] }))]}
              />
            )}
            <Select
              label="状态"
              value={status}
              onChange={setStatus}
              options={[{ value: "all", label: "全部" }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]}
            />
          </Toolbar>
          <div
            data-page="library"
            data-state={pending ? "loading" : failure ? "error" : !rows.length ? "empty" : rows.every((row) => row.status === "deprecated") ? "historical" : "success"}
          >
            {pending ? (
              <LoadingState title="正在读取资源" />
            ) : failure ? (
              <ErrorState description={message(failure)} action={<Button onClick={() => pages.forEach((page) => void page.refetch())}>重新读取</Button>} />
            ) : !rows.length ? (
              <InlineEmpty title="没有匹配的资源" />
            ) : (
              <DataTable
                label={group.title}
                selectedId={selected}
                onSelect={(row) => setSelected(row.id)}
                rowLabel={(row) => text(row.name)}
                showGroups={false}
                groups={[{ id: "assets", label: "资源", rows }]}
                columns={[
                  { id: "name", label: "名称", wrap: true, render: (row) => text(row.name) },
                  { id: "kind", label: "类别", render: (row) => kinds[text(row.kind)] || text(row.kind) },
                  { id: "version", label: "版本", render: (row) => text(row.version) },
                  {
                    id: "status",
                    label: "状态",
                    render: (row) => (
                      <StatusMark
                        kind={row.status === "published" ? "saved" : row.status === "deprecated" ? "historical" : "draft"}
                        label={statuses[text(row.status)] || text(row.status)}
                      />
                    ),
                  },
                  { id: "updated", label: "更新时间", render: (row) => text(row.updated) },
                ]}
              />
            )}
            {truncated && <InlineEmpty title={`每个类别只显示最近 ${PAGE} 项，请用检索缩小范围。`} />}
          </div>
        </>
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
          <Button variant="primary" loading={importing.isPending} disabled={!raw.trim() || !!fileError} onClick={() => importing.mutate()}>
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
