import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetCatalog, assetDetail } from "@/api/catalogs";
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
import { Tooltip } from "@/components/ui/tooltip";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { propertyLabel, referenceCitation, referenceData, referenceNumber, rightsLabel } from "@/lib/reference-data";
import { StandardsBrowser } from '@/features/standards/browser';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { assetCoverage } from '@/lib/asset-coverage';
import { ConclusionStrip } from '@/components/conclusion-strip';
import { Checkbox } from '@/components/ui/checkbox';
import { AssetEditor, pendingAssetEdit, rememberAssetEdit, forgetAssetEdit } from '@/features/resources/asset-editor';
import { AssetActionButtons, DeriveAssetDialog, pendingAssetDerivation } from '@/features/resources/asset-actions';
import { ResourceOperationsDialog, pendingResourceOperation, type ResourceOperation } from '@/features/resources/batch-actions';
import { getAsset, saveAsset, uncertainWrite } from '@/features/resources/api';
import { assetActions, assetUnit, sourceKinds, type Asset } from '@/features/resources/definitions';
import '@/features/resources/resources.css';

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
type ResourceGroup = keyof typeof groups;
type DialogOrigin = { key: string; group: ResourceGroup };
const resourceGroup = (kind: AssetKind): ResourceGroup => (Object.entries(groups).find(([, group]) => (group.kinds as readonly string[]).includes(kind))?.[0] || 'materials') as ResourceGroup;
const statuses: Record<string, string> = {
  draft: "草稿",
  reviewed: "已审核",
  published: "已发布",
  deprecated: "已停用",
};
const PAGE = 50;
const ACTIONS: Record<string, string> = { created: "创建草稿", edited: "编辑草稿", review: "核对来源", publish: "发布", return_to_draft: "退回草稿", deprecate: "停用" };
const time = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const eventNote = (asset: { asset_id?: unknown }, note: unknown) => text(note).replace(`${text(asset.asset_id)}@`, '资源版本 ');
const unitOf = (unit: string) => unit === "1" ? undefined : assetUnit(unit);

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
      label: propertyLabel(row.property), value: referenceNumber(row.value), unit: unitOf(row.unit), source: "standard" as const, stacked: true,
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
  // A source excerpt and a saved calculation input are separate facts, even
  // when they share a property name or currently have the same numeric value.
  const parameters = (Array.isArray(release.parameters) ? release.parameters : []).map(optionalRecord);
  if (parameters.length) groups.push({
    label: "计算参数",
    items: parameters.map((row) => {
      const quantity = optionalRecord(row.quantity), value = numeric(quantity.value);
      return { label: propertyLabel(text(row.name)), value: value === null ? "未提供" : referenceNumber(value), unit: unitOf(text(quantity.unit)), stacked: true };
    }),
  });
  if (data.gaps.length) groups.push({
    label: "缺项",
    items: data.gaps.map((gap, index) => ({ label: gap.properties.map(propertyLabel).join("、") || `缺项 ${index + 1}`, value: gap.reason || "未说明原因" })),
  });
  if (data.other.length) groups.push({
    label: "其他出处",
    items: data.other.map((row, index) => ({ label: `出处 ${index + 1} · ${row.reviewed ? '已核对' : '待核对'}`, value: row.reference || "未提供", source: sourceKinds[row.kind as keyof typeof sourceKinds]?.badge })),
  });
  const events = (Array.isArray(asset.events) ? asset.events : []).map(optionalRecord);
  if (events.length) groups.push({
    label: "审核记录",
    items: events.slice(0, 4).map((event) => ({
      label: `第 ${numeric(event.revision) ?? "—"} 修订 · ${ACTIONS[text(event.action)] || text(event.action)}`, value: `${time(event.created)} · ${eventNote(asset, event.note)}`, stacked: true,
    })),
  });
  return groups;
}

export function AssetsPage() {
  const { group: groupId } = useParams({ strict: false }) as { group: keyof typeof groups };
  const group = groups[groupId] || groups.materials;
  const queries = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
  const [standardsTab, setStandardsTab] = useState('basis');
  const activeStandardsTab = groupId === 'standards' && selected ? 'resources' : standardsTab;
  useEffect(() => {
    // A fixed-version link opens its resource immediately and keeps the list
    // visible when that selection is subsequently closed.
    if (groupId === 'standards' && selected) setStandardsTab('resources');
  }, [groupId, selected]);
  const changeStandardsTab = (value: string) => {
    setStandardsTab(value);
    if (value === 'basis' && selected) setSelected('');
  };
  const [offset, setOffset] = useState(0), [chosen, setChosen] = useState<Record<string, string>>({}), [batchAction, setBatchAction] = useState<ResourceOperation>('export');
  const [editor, setEditor] = useState<(DialogOrigin & { open: boolean; asset?: Asset; resume?: ReturnType<typeof pendingAssetEdit> }) | null>(null);
  const [operation, setOperation] = useState<(DialogOrigin & { open: boolean; action: ResourceOperation; ids: { id: string; name: string }[]; resume?: ReturnType<typeof pendingResourceOperation> }) | null>(null);
  const [derivation, setDerivation] = useState<(DialogOrigin & { open: boolean; asset: Asset; resume?: ReturnType<typeof pendingAssetDerivation> }) | null>(null);
  const [savedElsewhere, setSavedElsewhere] = useState<Asset | null>(null);
  const dialogKeys = useRef({ editor: editor?.key, operation: operation?.key, derivation: derivation?.key });
  dialogKeys.current = { editor: editor?.key, operation: operation?.key, derivation: derivation?.key };
  const browsingBasis = groupId === 'standards' && activeStandardsTab === 'basis';
  const filePicker = useRef<HTMLInputElement>(null);
  const importVisible = useRef(open); importVisible.current = open;
  const importGeneration = useRef(0), currentGroup = useRef(groupId); currentGroup.current = groupId;
  const changeImportOpen = (value: boolean) => {
    importGeneration.current += 1;
    importVisible.current = value;
    setOpen(value);
  };
  useEffect(() => {
    setQ(''); setKind('all'); setStatus('all'); setOffset(0); setChosen({});
    changeImportOpen(false);
    setEditor(null); setOperation(null); setDerivation(null); setSavedElsewhere(null);
  }, [groupId]);
  // 接口一次只按一个类别筛选：本组每个类别各取一页再合并，避免在前端截断分页
  const shown = kind === "all" || !(group.kinds as readonly string[]).includes(kind) ? group.kinds : [kind as AssetKind];
  const pages = useQueries({
    queries: shown.map((value) => ({
      queryKey: ["asset-catalog", q, value, status, offset],
      enabled: !browsingBasis,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        assetCatalog({ q, kind: value as AssetKind, status: status === "all" ? undefined : (status as "draft"), offset }, signal),
    })),
  });
  const pending = pages.some((page) => page.isPending);
  const failure = pages.find((page) => page.error)?.error;
  const rows = pages
    .flatMap((page) => page.data?.items || [])
    .sort((a, b) => text(b.updated).localeCompare(text(a.updated)));
  const total = pages.reduce((sum, page) => sum + (numeric(page.data?.total) || 0), 0);
  const hasNext = pages.some((page) => (numeric(page.data?.total) || 0) > offset + PAGE);
  const detail = useQuery({
    queryKey: ["asset-detail", selected],
    queryFn: ({ signal }) => getAsset(selected, signal),
    enabled: !!selected && !browsingBasis,
  });
  const inspectedRows = rows.filter(row => groupId === 'materials' ? row.kind === 'material' : groupId === 'standards' && row.kind === 'rule');
  const inspectionQueries = useQueries({ queries: inspectedRows.map(row => ({ queryKey: ['asset-detail', row.id], enabled: !browsingBasis,
    queryFn: ({ signal }: { signal: AbortSignal }) => row.kind === 'rule' ? getAsset(row.id, signal) : assetDetail(row.id, signal), retry: false })) });
  const inspections = new Map(inspectedRows.map((row, index) => [row.id, inspectionQueries[index]]));
  const importing = useMutation({
    retry: false,
    mutationFn: async () => {
      const origin = { group: groupId, generation: importGeneration.current };
      if (new TextEncoder().encode(raw).length > 120 * 1024)
        throw Error("资源文件超过 120 KB，请缩小 JSON 定义。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw Error("请输入有效 JSON；尚未创建资源。");
      }
      if (optionalRecord(value).schema_version === 'cablesim.resource-export/1') {
        const items = optionalRecord(value).items;
        if (!Array.isArray(items) || items.length !== 1) throw Error('此处每次导入一个资源草稿。请使用单项导出文件；批量包需逐项选择定义后导入。');
        value = optionalRecord(items[0]).definition;
        if (optionalRecord(value).schema_version !== 'csp-asset/0.1' || !optionalRecord(value).release) throw Error('导出文件缺少完整资源定义，尚未创建资源。');
      }
      const release = (optionalRecord(value).release || value) as components['schemas']['AssetRelease'];
      if (!(group.kinds as readonly string[]).includes(release.kind)) throw Error('文件类别不属于当前资源页，请切换到对应类别后导入。');
      const receipt = rememberAssetEdit(release);
      try { return { asset: await saveAsset(release), token: receipt.token, origin }; }
      catch (problem) {
        if (!uncertainWrite(problem)) forgetAssetEdit(receipt.token);
        else if (mounted.current && importVisible.current && currentGroup.current === origin.group
          && importGeneration.current === origin.generation && pendingAssetEdit()?.token === receipt.token) {
          changeImportOpen(false); setEditor({ key: crypto.randomUUID(), group: origin.group, open: true, resume: receipt });
        }
        throw problem;
      }
    },
    onSuccess: async ({ asset: value, token, origin }) => {
      // Mutation callbacks outlive the page. A late response may not navigate
      // a closed import, another group, or overwrite another import's receipt.
      if (!mounted.current || pendingAssetEdit()?.token !== token) return;
      forgetAssetEdit(token);
      if (importVisible.current && currentGroup.current === origin.group && importGeneration.current === origin.generation) {
        changeImportOpen(false);
        setRaw("");
        setSavedElsewhere(null);
        setQ(text(value.name)); setKind('all'); setStatus('all'); setOffset(0); setSelected(text(value.id));
      } else {
        // A closed import still owes a visible receipt. Keep the user's current
        // category and filters until they explicitly open the saved resource.
        setSavedElsewhere(value);
      }
      await queries.invalidateQueries({ queryKey: ["asset-catalog"] });
    },
  });
  const openImport = () => {
    importing.reset();
    setFileError("");
    setFileName("");
    changeImportOpen(true);
  };
  const changeFilter = (update: () => void) => { update(); setOffset(0); };
  const clearFilters = () => { setQ(''); setKind('all'); setStatus('all'); setOffset(0); };
  const refresh = () => {
    // Publication/deprecation changes eligibility immediately, including a
    // type or study page revisited within the shared cache's fresh period.
    for (const key of ['asset-catalog', 'asset-detail', 'type-resource-bindings', 'type-material-comparison',
      'type-creation-options', 'model-versions', 'resource-type-origin', 'type-list', 'object-relations']) {
      void queries.invalidateQueries({ queryKey: [key] });
    }
  };
  const currentDialog = (type: keyof typeof dialogKeys.current, origin: DialogOrigin) => mounted.current
    && currentGroup.current === origin.group && dialogKeys.current[type] === origin.key;
  const closeDialog = (type: keyof typeof dialogKeys.current, origin: DialogOrigin) => {
    if (!currentDialog(type, origin)) return;
    if (type === 'editor') setEditor(null);
    else if (type === 'derivation') setDerivation(null);
    else setOperation(null);
  };
  const openResource = (id: string, targetGroup: ResourceGroup) => {
    setSavedElsewhere(null);
    if (targetGroup === currentGroup.current) { clearFilters(); setSelected(id); }
    else void navigate({ to: '/resources/$group', params: { group: targetGroup }, search: (previous: Record<string, unknown>): { theme: 'light' | 'dark'; item: string } => ({ theme: previous.theme === 'dark' ? 'dark' : 'light', item: id }) });
  };
  const saved = (type: 'editor' | 'derivation', origin: DialogOrigin, asset: Asset) => {
    if (!currentDialog(type, origin)) return;
    closeDialog(type, origin); refresh();
    if (resourceGroup(asset.kind) !== currentGroup.current) {
      // A global pending receipt can be recovered from another category. Keep
      // that category and selection until the user explicitly opens the result.
      setSavedElsewhere(asset); return;
    }
    setSavedElsewhere(null); setQ(asset.name); setKind('all'); setStatus('all'); setOffset(0); setSelected(asset.id);
  };
  const editReceipt = pendingAssetEdit(), deriveReceipt = pendingAssetDerivation(), operationReceipt = pendingResourceOperation();
  const unresolved = !!editReceipt || !!deriveReceipt || !!operationReceipt?.items.some(item => ['uncertain', 'running'].includes(item.state));
  const openEditor = (asset?: Asset) => {
    const resume = pendingAssetEdit();
    setEditor({ key: crypto.randomUUID(), group: groupId, open: true, asset: resume?.previous || asset, resume });
  };
  const openOperation = (action: ResourceOperation, ids: { id: string; name: string }[]) => {
    const resume = pendingResourceOperation();
    setOperation({ key: crypto.randomUUID(), group: groupId, open: true, action: resume?.action || action, ids: resume?.items.map(item => ({ id: item.id, name: item.name })) || ids, resume });
  };
  const openDerivation = (asset: Asset) => {
    const resume = pendingAssetDerivation(); setDerivation({ key: crypto.randomUUID(), group: groupId, open: true, asset: resume?.asset || asset, resume });
  };
  const modalOpen = open || !!editor?.open || !!operation?.open || !!derivation?.open;
  const selectedCount = Object.keys(chosen).length;
  const choose = (id: string, name: string, checked: boolean) => setChosen(previous => { const next = { ...previous }; if (checked) next[id] = name; else delete next[id]; return next; });
  const filtered = !!q || kind !== "all" || status !== "all";
  // 筛选后选中的那条不在结果里：面板不再显示它（地址里的 item 保留，清空筛选后恢复）
  const showing = selected && (!filtered || pending || rows.some((row) => row.id === selected)) ? selected : "";
  const selectedCoverage = groupId === 'materials' && detail.data?.kind === 'material' ? assetCoverage(optionalRecord(detail.data.release)) : undefined;
  return (
    <CatalogShell
      title={group.title}
      status={<span className="muted">{browsingBasis ? '只读依据 · 按版本引用' : `${total} 项 · 固定资源版本`}</span>}
      actions={browsingBasis ? undefined : <><Button variant={modalOpen || selectedCount || unresolved ? 'outline' : 'primary'} size="compact" disabled={unresolved} onClick={() => openEditor()}>新建资源</Button><Button size="compact" disabled={unresolved} onClick={openImport}>导入资源草稿</Button></>}
      tabs={groupId === 'standards' ? <Tabs value={activeStandardsTab} onValueChange={changeStandardsTab}><TabsList aria-label="标准与规则视图"><TabsTrigger value="basis">依据浏览</TabsTrigger><TabsTrigger value="resources">资源版本</TabsTrigger></TabsList></Tabs> : undefined}
      property={
        showing && !browsingBasis ? (
          <PropertyPanel
            collapsed={false}
            title={text(detail.data?.name) || "所选资源"}
            groups={detail.isPending
              ? [{ label: "名片", items: [{ label: "状态", value: <LoadingState title="正在读取资源" /> }] }]
              : detail.error
                ? [{ label: "名片", items: [{ label: "错误", value: message(detail.error) }] }]
                : assetGroups(optionalRecord(detail.data))}
            summary={selectedCoverage && <ConclusionStrip label="已登记物性覆盖" historical={detail.data?.status === 'deprecated'}
                conclusion={selectedCoverage.total ? selectedCoverage.missing.length ? '已登记物性存在缺项' : '已登记物性未列缺项' : '物性尚未登记'}
                metrics={selectedCoverage.total ? [
                  { label: '已登记数值', value: selectedCoverage.covered, unit: '项' },
                  { label: '明确缺项', value: selectedCoverage.missing.length, unit: '项' },
                ] : []} />}
            extra={<>{detail.data && <AssetActionButtons asset={detail.data} disabled={modalOpen || unresolved} onEdit={() => openEditor(detail.data)}
              onAction={action => openOperation(action, [{ id: detail.data.id, name: detail.data.name }])} onDerive={() => openDerivation(detail.data)} />}
              {detail.data && <details className="resource-scope"><summary>完整版本记录 · {detail.data.events.length} 项</summary><ol>{detail.data.events.map(event => <li key={event.revision}>第 {event.revision} 次修订 · {ACTIONS[event.action] || event.action} · {time(event.created)}<p>{eventNote(detail.data, event.note)}</p></li>)}</ol></details>}
              <section aria-label="关联"><h3>关联</h3><RelationPanel kind="asset" id={selected} /></section></>}
            onToggle={() => setSelected("")}
          />
        ) : undefined
      }
    >
      {groupId === 'templates' && <details className="resource-scope"><summary>模板作用域 · 适用对象与修改影响</summary><p>本页可建立、编辑、核对和发布组织资源版本。当前版本暂不能将组织模板应用到工程布置或研究参数。</p><p>研究内的内置布置模板是独立的局部入口。资源发布不会自动替换既有引用；已有运行与历史交付保留原版本。</p></details>}
      {groupId === 'materials' && <details className="resource-scope"><summary>物性覆盖口径 · 已登记项</summary><p>比例统计本资源登记的数值物性与明确缺项，按物性名称去重；参考摘录不等于计算参数。未登记项不纳入分母，不代表满足所有计算方法。适用条件和来源在详情中核对。</p></details>}
      {browsingBasis ? <StandardsBrowser /> : (
        <>
          {(editReceipt || deriveReceipt || operationReceipt) && <div className="resource-batch-toolbar" role="status"><span>保留了尚待确认的资源操作，请先恢复原记录。</span>
            {editReceipt && <Button variant={modalOpen ? 'outline' : 'primary'} onClick={() => openEditor()}>恢复未确认保存</Button>}
            {deriveReceipt && <Button variant={modalOpen || !!editReceipt ? 'outline' : 'primary'} onClick={() => openDerivation(deriveReceipt.asset)}>恢复未确认派生</Button>}
            {operationReceipt && <Button variant={modalOpen || !!editReceipt || !!deriveReceipt ? 'outline' : 'primary'} onClick={() => openOperation(operationReceipt.action, operationReceipt.items)}>恢复资源操作</Button>}
          </div>}
          {savedElsewhere && <div className="resource-batch-toolbar" role="status"><span>{kinds[savedElsewhere.kind]}“{savedElsewhere.name}” · {savedElsewhere.version} 已保存，当前资源类别与选择保持不变。</span>
            <Button onClick={() => openResource(savedElsewhere.id, resourceGroup(savedElsewhere.kind))}>打开该资源</Button>
            <Button variant="ghost" onClick={() => setSavedElsewhere(null)}>关闭保存提示</Button>
          </div>}
          <Toolbar label="资源筛选">
            <label className="search-field">
              检索
              <input id="resource-search" value={q} onChange={(event) => changeFilter(() => setQ(event.target.value))} placeholder="资源名称或标识" maxLength={128} />
            </label>
            {group.kinds.length > 1 && (
              <Select
                label="类别"
                value={kind}
                onChange={value => changeFilter(() => setKind(value))}
                options={[{ value: "all", label: "全部" }, ...group.kinds.map((value) => ({ value, label: kinds[value] }))]}
              />
            )}
            <Select
              label="状态"
              value={status}
              onChange={value => changeFilter(() => setStatus(value))}
              options={[{ value: "all", label: "全部" }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]}
            />
            {filtered && <Button size="compact" onClick={clearFilters}>清除筛选</Button>}
          </Toolbar>
          {(!!rows.length || selectedCount > 0) && <div className="resource-batch-toolbar"><label><Checkbox aria-label="选择本页资源" disabled={!rows.length} title={!rows.length ? '当前筛选没有资源，可清除筛选后选择' : undefined} checked={rows.length && rows.every(row => !!chosen[row.id]) ? true : rows.some(row => !!chosen[row.id]) ? 'indeterminate' : false}
            onCheckedChange={value => setChosen(previous => { const next = { ...previous }; for (const row of rows) { if (value === true && Object.keys(next).length < 50) next[row.id] = text(row.name); else if (value !== true) delete next[row.id]; } return next; })} /> 选择本页</label>
            <span>已选 {selectedCount} 项{selectedCount > rows.filter(row => chosen[row.id]).length ? `（含本页以外 ${selectedCount - rows.filter(row => chosen[row.id]).length} 项）` : ''}</span>
            {selectedCount > 0 && <><Select label="批量操作" value={batchAction} onChange={value => setBatchAction(value as ResourceOperation)} options={[{ value: 'export', label: '导出固定版本定义' }, ...Object.entries(assetActions).map(([value, label]) => ({ value, label }))]} />
              <Button variant={modalOpen || unresolved ? 'outline' : 'primary'} disabled={unresolved} onClick={() => openOperation(batchAction, Object.entries(chosen).map(([id, name]) => ({ id, name })))}>预检批量操作</Button>
              <Button onClick={() => setChosen({})}>清除所选</Button></>}
            {selectedCount >= 50 && <span>每批最多 50 项；完成后可继续选择下一批。</span>}
          </div>}
          <div
            data-page="library"
            data-state={pending ? "loading" : failure ? "error" : !rows.length ? "empty" : rows.every((row) => row.status === "deprecated") ? "historical" : "success"}
          >
            {pending ? (
              <LoadingState title="正在读取资源" />
            ) : failure ? (
              <ErrorState description={message(failure)} action={<Button onClick={() => pages.forEach((page) => void page.refetch())}>重新读取</Button>} />
            ) : !rows.length ? (
              <InlineEmpty title={filtered ? '没有匹配的资源' : group.empty} action={filtered ? <Button onClick={clearFilters}>清除筛选</Button> : <Button disabled={unresolved} onClick={() => openEditor()}>新建资源</Button>} />
            ) : (
              <DataTable
                label={group.title}
                selectedId={selected}
                onSelect={(row) => setSelected(row.id)}
                rowLabel={(row) => text(row.name)}
                showGroups={false}
                groups={[{ id: "assets", label: "资源", rows }]}
                columns={[
                  { id: 'selected', label: '选择', render: row => <span className="resource-selection" onClick={event => event.stopPropagation()}><Checkbox aria-label={`选择资源 ${text(row.name)} ${text(row.version)}`} checked={!!chosen[row.id]} disabled={!chosen[row.id] && selectedCount >= 50} title={!chosen[row.id] && selectedCount >= 50 ? '每批最多 50 项，请先完成当前批次' : undefined} onCheckedChange={value => choose(row.id, text(row.name), value === true)} /></span> },
                  { id: "name", label: "名称", wrap: true, render: (row) => text(row.name) },
                  ...(group.kinds.length > 1 ? [{ id: "kind", label: "类别", render: (row: (typeof rows)[number]) => kinds[text(row.kind)] || text(row.kind) }] : []),
                  { id: "version", label: "版本", wrap: true, render: (row) => {
                    if (row.kind !== 'rule') return text(row.version);
                    const query = inspections.get(row.id);
                    if (query?.isPending) return <span aria-busy="true">正在读取版本</span>;
                    const changed = query?.data && (query.data.revision !== row.revision || query.data.content_sha256 !== row.content_sha256);
                    if (!query?.data || query.isError || changed) return <button className="settings-link" onClick={event => {
                      event.stopPropagation(); void Promise.all([query?.refetch(), ...pages.map(page => page.refetch())]);
                    }}>{changed ? '版本已变化 · 重读目录' : '版本读取失败 · 重试'}</button>;
                    // The source supplies the standard edition. The resource's
                    // immutable version stays available for exact identification;
                    // a local derived version does not become a new standard edition.
                    const edition = referenceData(optionalRecord(query.data.release).sources).editions[0]?.edition;
                    return <Tooltip content={`资源版本 ${text(row.version)} · 第 ${numeric(row.revision) ?? '—'} 修订`}><span tabIndex={0} data-resource-version={text(row.version)}>{edition || text(row.version)}</span></Tooltip>;
                  } },
                  {
                    id: "status",
                    label: "状态",
                    wrap: true,
                    render: (row) => {
                      if (groupId !== 'materials' || row.kind !== 'material') return <StatusMark kind={row.status === "published" ? "saved" : row.status === "deprecated" ? "historical" : "draft"} label={statuses[text(row.status)] || text(row.status)} />;
                      const query = inspections.get(row.id);
                      const values = query?.data ? assetCoverage(optionalRecord(query.data.release)) : undefined;
                      return <div className="asset-state"><StatusMark
                        kind={row.status === "published" ? "saved" : row.status === "deprecated" ? "historical" : "draft"}
                        label={statuses[text(row.status)] || text(row.status)}
                      />{groupId === 'materials' && row.kind === 'material' && <><span aria-hidden="true"> · </span>{values ? <details className="asset-coverage" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><summary aria-label={`${text(row.name)}物性覆盖`}>{values.total ? `物性 ${values.covered}/${values.total}` : '物性未登记'}{values.missing.length ? ` · 缺 ${values.missing.length} 项` : ''}</summary>{values.missing.length ? <ul>{values.missing.map(gap => <li key={gap.property}><b>{propertyLabel(gap.property)}</b><span>{gap.reason}</span></li>)}</ul> : <p>{values.total ? '已登记项未列出缺项；适用条件与未登记项仍须核对。' : '没有物性数值或缺项登记，请核对资源定义。'}</p>}</details> : query?.isError ? <button className="settings-link" onClick={event => { event.stopPropagation(); void query.refetch(); }}>物性读取失败 · 重试</button> : <span className="muted">物性读取中</span>}</>}</div>;
                    },
                  },
                  { id: "updated", label: "更新日期", render: (row) => <time dateTime={text(row.updated)} title={time(row.updated)}>{text(row.updated) ? new Date(text(row.updated)).toLocaleDateString('zh-CN') : '—'}</time> },
                ]}
              />
            )}
            {(offset > 0 || hasNext) && <nav className="resource-pagination" aria-label="资源分页"><Button disabled={pending || offset === 0} title={offset === 0 ? '已在第一页' : undefined} onClick={() => setOffset(value => Math.max(0, value - PAGE))}>上一页资源</Button>
              <span>第 {Math.floor(offset / PAGE) + 1} 页 · 每个类别最多 {PAGE} 项 · 共 {total} 项</span><Button disabled={pending || !hasNext} title={!hasNext ? '已到最后一页' : undefined} onClick={() => setOffset(value => value + PAGE)}>下一页资源</Button></nav>}
          </div>
        </>
      )}
      {editor && editor.group === groupId && <AssetEditor key={editor.key} open={editor.open} kinds={[...group.kinds]} asset={editor.asset} resume={editor.resume} onClose={() => closeDialog('editor', editor)} onSaved={asset => saved('editor', editor, asset)} />}
      {operation && operation.group === groupId && <ResourceOperationsDialog key={operation.key} open={operation.open} operation={operation.action} ids={operation.ids} resume={operation.resume} onClose={() => closeDialog('operation', operation)} onChanged={() => { if (currentDialog('operation', operation)) refresh(); }} onInspect={id => {
        if (!currentDialog('operation', operation)) return;
        const target = operation.resume?.items.find(item => item.id === id)?.asset || operation.resume?.items.find(item => item.asset)?.asset;
        openResource(id, target ? resourceGroup(target.kind) : operation.group);
      }} />}
      {derivation && derivation.group === groupId && <DeriveAssetDialog key={derivation.key} open={derivation.open} asset={derivation.asset} resume={derivation.resume} onClose={() => closeDialog('derivation', derivation)} onSaved={asset => saved('derivation', derivation, asset)} />}
      <Dialog
        open={open}
        onOpenChange={changeImportOpen}
        title="导入资源草稿"
        description="校验资源定义后保存为未发布草稿。材料与规则发布后，可在型号设计中选择固定版本；其他类别的适用范围见页面说明。"
        initialFocus="form"
        actions={
          <Button variant="primary" loading={importing.isPending} disabled={!raw.trim() || !!fileError} onClick={() => importing.mutate()}>
            校验并导入
          </Button>
        }
      >
        {importing.isPending && <p className="muted">导入请求已发送。关闭后仍可从资源库核实结果，原定义已保留。</p>}
        <div className="text-field">
          资源 JSON
          {/* 原生文件控件显示英文且样式不统一：隐藏它，用统一按钮触发，并写出已选文件名 */}
          <span className="file-pick">
            <Button size="compact" disabled={importing.isPending} onClick={() => filePicker.current?.click()}>选择 JSON 文件</Button>
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
            disabled={importing.isPending}
            onChange={(event) => {
              setRaw(event.target.value);
              setFileError(''); setFileName('');
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
