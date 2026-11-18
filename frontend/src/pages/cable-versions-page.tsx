import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cableModels } from "@/api/documents";
import { message, numeric, optionalRecord, text } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { PropertyPanel } from "@/components/property-panel";
import { RelationPanel } from "@/components/relation-panel";
import { indexObjects, type ObjectCard } from "@/api/object-index";
import { versionLabel } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SourceKind } from "@/components/source-badge";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { VersionStart } from '@/features/resources/version-start';

/** 来源类别：电缆型号版本的每个值都带出处（§2.3 关联），这里按出处归类显示。 */
const SOURCE: Record<string, { label: string; badge: SourceKind }> = {
  manufacturer: { label: "厂家资料", badge: "document" },
  standard: { label: "标准", badge: "standard" },
  derived: { label: "推导", badge: "derived" },
  user: { label: "工程师给定", badge: "user" },
  asset: { label: "资源库", badge: "library" },
  demo: { label: "演示", badge: "demo" },
};
const STATE: Record<string, "saved" | "draft"> = { reviewed: "saved", draft: "draft", incomplete: "draft" };

type Version = {
  id: string; name: string; version: string; state: string; status: string; series: string;
  spec: string; content: string; maker: string; sources: { path: string; kind: string; reference: string; reviewed: boolean }[];
};

/** 型号系列：取型号代号（如 YJLW03、YJV22），用于分组。 */
function seriesOf(name: string, designation: string) {
  return designation || name.match(/\b(?:ZC-|ZR-|ZA-)?([A-Z]{2,}[0-9]*)/)?.[1] || "其他";
}
/** 主要来源：值最多的那类出处；全部出处在右侧名片里逐条列出。 */
function mainSource(row: Version) {
  const counts = new Map<string, number>();
  for (const source of row.sources) counts.set(source.kind, (counts.get(source.kind) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
function kv(value?: number) {
  return value ? `${Number((value / 1000).toPrecision(4))}` : "";
}

function rows(data: Record<string, unknown>[]): Version[] {
  return data.map((row) => {
    const payload = optionalRecord(row.payload), spec = optionalRecord(payload.specification), cable = optionalRecord(payload.cable_type);
    const rating = optionalRecord(cable.rating), cores = Array.isArray(cable.cores) ? cable.cores : [];
    const area = numeric(spec.area_m2) ?? numeric(optionalRecord(optionalRecord(cores[0]).conductor).nominal_area);
    const count = numeric(spec.cores) ?? (cores.length || undefined);
    const u0 = numeric(spec.u0_v) ?? numeric(rating.u0), u = numeric(spec.voltage_v) ?? numeric(rating.u);
    const missing = Array.isArray(spec.missing) ? spec.missing.length : 0;
    const sources = Object.entries(optionalRecord(payload.sources)).map(([path, value]) => {
      const source = optionalRecord(value);
      return { path, kind: text(source.kind), reference: text(source.reference), reviewed: source.reviewed === true };
    });
    const name = text(payload.name);
    return {
      id: text(row.id), name, version: text(payload.version).replace(/\+engineering$/, "（工程版）"), state: text(row.state), status: text(row.display_status),
      series: seriesOf(name, text(spec.designation)),
      spec: [count ? `${count} 芯` : "", area ? `${Math.round(area * 1e6)} mm²` : "", u0 && u ? `${kv(u0)}/${kv(u)} kV` : ""].filter(Boolean).join(" · "),
      content: payload.cable_type ? "完整结构" : missing ? `公开规格 · 缺 ${missing} 项` : "公开规格",
      maker: text(spec.manufacturer), sources,
    };
  });
}

/** 资源 › 电缆型号版本（FRONTEND_REQUIREMENTS §2.2）：研究可引用的型号版本，每条写明来源。 */
export function CableVersionsPage() {
  const { theme } = usePageTheme();
  const navigate = useNavigate();
  const { item } = useSearch({ strict: false }) as { item?: string };
  const selected = item || "";
  const setSelected = (id: string) => void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, item: id || undefined }), replace: true });
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState(''), [starting, setStarting] = useState(false);
  const models = useQuery({ queryKey: ["domain-cable-models"], queryFn: ({ signal }) => cableModels(signal) });
  const all = rows(models.data || []);
  // 系统自带的教学型号：不在厂家 / 设计版本表里，但研究会引用、搜索能找到，在这里单列，链接才有落脚处
  const system = useQuery({ queryKey: ["index-objects", "cable_version", "system"], queryFn: ({ signal }) => indexObjects({ kind: "cable_version", q: "system.", limit: 50 }, signal) });
  const teaching = ((system.data?.items || []) as (ObjectCard & { id: string })[]).filter((card) => card.id.startsWith("system."));
  const teachingCard = teaching.find((card) => card.id === selected);
  const kindsOf = (row: Version) => new Set(row.sources.map((source) => source.kind));
  const term = query.trim().toLocaleLowerCase();
  const visible = all.filter((row) => (origin === "all" || kindsOf(row).has(origin)) && `${row.name} ${row.maker} ${row.spec} ${row.version}`.toLocaleLowerCase().includes(term));
  const visibleTeaching = teaching.filter(row => (origin === 'all' || origin === 'demo') && `${row.name} ${row.version}`.toLocaleLowerCase().includes(term));
  const series = [...new Set(visible.map((row) => row.series))].sort();
  const current = all.find((row) => row.id === selected);
  const openImport = () => void navigate({ to: "/resources/cables/structure-import", search: { theme } });
  const openPdfImport = () => void navigate({ to: "/resources/cables/imports", search: { theme } });
  const origins = [...new Set([...all.flatMap((row) => [...kindsOf(row)]), ...(teaching.length ? ['demo'] : [])])].filter((kind) => SOURCE[kind]);
  const filtered = !!query || origin !== 'all';
  const clearFilters = () => { setQuery(''); setOrigin('all'); };
  return (
    <CatalogShell
      title="电缆型号版本"
      status={<span className="muted">{all.length} 项 · 研究按版本引用</span>}
      actions={<><Button variant="outline" size="compact" onClick={openPdfImport}>提取厂家 PDF</Button><Button variant={starting ? 'outline' : 'primary'} size="compact" onClick={openImport}>导入厂家结构表</Button></>}
      property={teachingCard ? (
        <PropertyPanel
          collapsed={false}
          title={teachingCard.name}
          onToggle={() => setSelected("")}
          extra={<><VersionStart key={teachingCard.id} id={teachingCard.id} theme={theme} onDialogChange={setStarting} /><section aria-label="关联"><h3>关联</h3><RelationPanel kind="cable_version" id={teachingCard.id} /></section></>}
          groups={[{ label: "名片", items: [
            { label: "版本", value: versionLabel(teachingCard.version || "—") },
            { label: "状态", value: teachingCard.status.label },
            { label: "来源", value: teachingCard.source?.label || "系统教学型号", stacked: true },
          ] }]}
        />
      ) : current ? (
        <PropertyPanel
          collapsed={false}
          title={current.name}
          onToggle={() => setSelected("")}
          extra={<><VersionStart key={current.id} id={current.id} theme={theme} onDialogChange={setStarting} /><section aria-label="关联"><h3>关联</h3><RelationPanel kind="cable_version" id={current.id} /></section></>}
          groups={[
            {
              label: "名片",
              items: [
                { label: "版本", value: current.version },
                { label: "状态", value: current.status },
                { label: "内容", value: current.content },
                ...(current.spec ? [{ label: "规格", value: current.spec }] : []),
                ...(current.maker ? [{ label: "制造商", value: current.maker }] : []),
              ],
            },
            {
              label: "来源",
              // 按出处类别合并成一行：几项、已核对几项；逐条出处在悬停里看
              items: [...new Set(current.sources.map((source) => source.kind))].map((kind) => {
                const rows = current.sources.filter((source) => source.kind === kind);
                return {
                  label: SOURCE[kind]?.label || kind,
                  value: `${rows.length} 项 · 已核对 ${rows.filter((source) => source.reviewed).length}`,
                  source: SOURCE[kind]?.badge || "document",
                  sourceDetail: rows.map((source) => `${source.path}\n${source.reference}`).join("\n\n"),
                };
              }),
            },
          ]}
        />
      ) : undefined}
    >
      {models.isPending ? <LoadingState title="正在读取电缆型号版本" />
        : models.error ? <ErrorState description={message(models.error)} action={<Button onClick={() => models.refetch()}>重新读取</Button>} />
        : <>
          <Toolbar label="型号版本筛选"><label className="search-field">检索型号版本<input aria-label="检索型号版本" value={query} onChange={event => setQuery(event.target.value)} placeholder="型号、厂家或规格" /></label>
            {!!origins.length && <Select label="来源" value={origin} onChange={setOrigin} options={[{ value: "all", label: "全部" }, ...origins.map((kind) => ({ value: kind, label: SOURCE[kind].label }))]} />}
            {filtered && <Button size="compact" onClick={clearFilters}>清除型号筛选</Button>}
          </Toolbar>
          <div data-page="cable-versions" data-state={visible.length ? "success" : "empty"}>
            {!visible.length ? <InlineEmpty title={filtered ? '没有匹配的型号版本' : '还没有厂家或设计型号版本，可导入 Excel / CSV 厂家结构表或提取 PDF 资料。'} action={filtered ? <Button size="compact" onClick={clearFilters}>清除型号筛选</Button> : <Button size="compact" onClick={openImport}>导入厂家结构表</Button>} /> : (
              <DataTable<Version>
                label="电缆型号版本"
                selectedId={selected}
                onSelect={(row) => setSelected(row.id)}
                rowLabel={(row) => row.name}
                groups={series.map((name) => ({ id: name, label: name, rows: visible.filter((row) => row.series === name) }))}
                columns={[
                  { id: "name", label: "型号", wrap: true, render: (row) => row.name },
                  { id: "spec", label: "规格", render: (row) => row.spec || "—" },
                  { id: "content", label: "内容", wrap: true, render: (row) => row.content },
                  { id: "source", label: "主要来源", wrap: true, render: (row) => (SOURCE[mainSource(row)]?.label || mainSource(row)) + (row.maker ? ` · ${row.maker}` : "") },
                  { id: "version", label: "版本", render: (row) => row.version },
                  { id: "status", label: "状态", render: (row) => <StatusMark kind={STATE[row.state] || "draft"} label={row.status} /> },
                ]}
              />
            )}
          </div>
          {!!visibleTeaching.length && <section className="object-section" aria-label="系统教学示例">
            <header><h2>系统教学示例</h2><span className="muted">{visibleTeaching.length} 项 · 演示结构与规格书用，不是厂家实测，不能作为工程型号引用</span></header>
            <DataTable<ObjectCard & { id: string }>
              label="系统教学示例"
              showGroups={false}
              selectedId={selected}
              onSelect={(row) => setSelected(row.id)}
              rowLabel={(row) => row.name}
              groups={[{ id: "teaching", label: "教学示例", rows: visibleTeaching }]}
              columns={[
                { id: "name", label: "型号", wrap: true, render: (row) => row.name },
                { id: "version", label: "版本", render: (row) => versionLabel(row.version || "—") },
                { id: "status", label: "状态", render: (row) => <StatusMark kind="draft" label={row.status.label} /> },
              ]}
            />
          </section>}
        </>}
    </CatalogShell>
  );
}
