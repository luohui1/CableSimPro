import { useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetCatalog, assetDetail, importAsset } from "@/api/catalogs";
import { message, numeric, optionalRecord, text } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { CatalogShell } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { PropertyPanel, type PropertyGroup } from "@/components/property-panel";
import { RelationPanel } from "@/components/relation-panel";
import { StatusMark } from "@/components/status-mark";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { displayUnit } from "@/lib/display-names";
import { propertyLabel, referenceCitation, referenceData, referenceNumber, rightsLabel } from "@/lib/reference-data";

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
const ACTIONS: Record<string, string> = { created: "创建草稿", review: "核对来源", publish: "发布", deprecate: "停用" };
const time = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const unitOf = (unit: string) => unit === "1" ? undefined : displayUnit(unit);

/**
 * 资源详情的属性分组：名片 → 参考物性 / 标准版本 → 适用条件 → 缺项 → 审核记录。
 * 标准摘录按 lib/reference-data 解析，不显示原始 JSON；不是摘录格式的出处原样列出。
 */
function assetGroups(asset: Record<string, unknown>): PropertyGroup[] {
  const release = optionalRecord(asset.release);
  const data = referenceData(release.sources);
  const edition = data.editions[0];
  const groups: PropertyGroup[] = [{
    label: "名片",
    items: [
      ...(edition ? [{ label: "标准号", value: edition.standard }] : [{ label: "类别", value: kinds[text(asset.kind)] || text(asset.kind) }]),
      { label: "版本", value: edition?.edition || text(asset.version) },
      { label: "状态", value: statuses[text(asset.status)] || text(asset.status) },
      { label: "更新", value: time(asset.updated) },
    ],
  }];
  if (edition) groups.push({
    label: "标准版本",
    items: [
      { label: "适用范围", value: edition.scope || "未提供" },
      { label: "来源文件", value: edition.file || "未提供", source: "standard", sourceDetail: [referenceCitation({ standard: edition.standard, pdfPage: edition.pdfPage }), edition.sourceDigest && `文件摘要 ${edition.sourceDigest}`].filter(Boolean).join("\n") },
      { label: "授权", value: rightsLabel(edition.rights) || "未提供" },
    ],
  });
  if (data.values.length) groups.push({
    label: "参考物性",
    items: data.values.map((row) => ({
      label: propertyLabel(row.property), value: referenceNumber(row.value), unit: unitOf(row.unit), source: "standard" as const,
      sourceDetail: [referenceCitation(row), row.condition && `条件：${row.condition}`, row.sourceDigest && `文件摘要 ${row.sourceDigest}`].filter(Boolean).join("\n"),
    })),
  });
  const conditions = [...new Set(data.values.map((row) => row.condition).filter(Boolean))];
  if (conditions.length) groups.push({
    label: "适用条件",
    items: conditions.map((condition, index) => {
      const applies = data.values.filter((row) => row.condition === condition);
      return { label: conditions.length === 1 ? "全部物性" : applies.map((row) => propertyLabel(row.property)).join("、") || `条件 ${index + 1}`, value: condition };
    }),
  });
  // 摘录以外的计算参数（同名物性已在上面列出，不重复）
  const covered = new Set(data.values.map((row) => row.property));
  const parameters = (Array.isArray(release.parameters) ? release.parameters : []).map(optionalRecord).filter((row) => !covered.has(text(row.name)));
  if (parameters.length) groups.push({
    label: "计算参数",
    items: parameters.map((row) => {
      const quantity = optionalRecord(row.quantity), value = numeric(quantity.value);
      return { label: propertyLabel(text(row.name)), value: value === null ? "未提供" : referenceNumber(value), unit: unitOf(text(quantity.unit)) };
    }),
  });
  if (data.gaps.length) groups.push({
    label: "缺项",
    items: data.gaps.map((gap, index) => ({ label: gap.properties.map(propertyLabel).join("、") || `缺项 ${index + 1}`, value: gap.reason || "未说明原因" })),
  });
  if (data.other.length) groups.push({
    label: "其他出处",
    items: data.other.map((row, index) => ({ label: `出处 ${index + 1}`, value: row.reference || "未提供", source: "document" as const })),
  });
  const events = (Array.isArray(asset.events) ? asset.events : []).map(optionalRecord);
  if (events.length) groups.push({
    label: "审核记录",
    items: events.slice(0, 4).map((event) => ({
      label: `第 ${numeric(event.revision) ?? "—"} 修订 · ${ACTIONS[text(event.action)] || text(event.action)}`, value: time(event.created), stacked: false,
    })),
  });
  return groups;
}

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
    [fileError, setFileError] = useState(""),
    [fileName, setFileName] = useState("");
  const filePicker = useRef<HTMLInputElement>(null);
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
  const openImport = () => {
    importing.reset();
    setFileError("");
    setFileName("");
    setOpen(true);
  };
  const filtered = !!q || kind !== "all" || status !== "all";
  // 筛选后选中的那条不在结果里：面板不再显示它（地址里的 item 保留，清空筛选后恢复）
  const showing = selected && (!filtered || pending || rows.some((row) => row.id === selected)) ? selected : "";
  return (
    <CatalogShell
      title={group.title}
      status={<span className="muted">{rows.length} 项 · 研究按版本引用</span>}
      actions={<Button variant="primary" size="compact" onClick={openImport}>导入资源草稿</Button>}
      property={
        showing ? (
          <PropertyPanel
            collapsed={false}
            title={text(detail.data?.name) || "所选资源"}
            groups={detail.isPending
              ? [{ label: "名片", items: [{ label: "状态", value: <LoadingState title="正在读取资源" /> }] }]
              : detail.error
                ? [{ label: "名片", items: [{ label: "错误", value: message(detail.error) }] }]
                : assetGroups(optionalRecord(detail.data))}
            extra={<section aria-label="关联"><h3>关联</h3><RelationPanel kind="asset" id={selected} /></section>}
            onToggle={() => setSelected("")}
          />
        ) : undefined
      }
    >
      {!filtered && !pending && !failure && !rows.length ? (
        <InlineEmpty title={`${group.empty}。用右上角“导入资源草稿”导入，审核发布后研究才能引用。`} />
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
                  ...(group.kinds.length > 1 ? [{ id: "kind", label: "类别", render: (row: (typeof rows)[number]) => kinds[text(row.kind)] || text(row.kind) }] : []),
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
                  { id: "updated", label: "更新时间", render: (row) => time(row.updated) },
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
        description="导入后系统整体校验定义，保存为未发布草稿；审核发布后研究才能引用。"
        initialFocus="form"
        actions={
          <Button variant="primary" loading={importing.isPending} disabled={!raw.trim() || !!fileError} onClick={() => importing.mutate()}>
            校验并导入
          </Button>
        }
      >
        <div className="text-field">
          资源 JSON
          {/* 原生文件控件显示英文且样式不统一：隐藏它，用统一按钮触发，并写出已选文件名 */}
          <span className="file-pick">
            <Button size="compact" onClick={() => filePicker.current?.click()}>选择 JSON 文件</Button>
            <span className="muted">{fileName || "未选择文件；也可以直接粘贴到下方"}</span>
          </span>
          <input
            ref={filePicker}
            type="file"
            hidden
            accept=".json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              if (file.size > 120 * 1024) {
                setFileError("文件超过 120 KB，请缩小 JSON 定义。");
                return;
              }
              setFileError("");
              setRaw(await file.text());
              importing.reset();
            }}
          />
        </div>
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
      </Dialog>
    </CatalogShell>
  );
}
