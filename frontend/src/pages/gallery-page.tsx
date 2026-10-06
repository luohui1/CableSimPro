import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
const AgentGallery = lazy(() => import('@/components/agent-gallery'));
import { Link } from "@tanstack/react-router";
import { galleryRoute, type PageState } from "@/router";
import { AppShell } from "@/components/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { NumberField } from "@/components/ui/number-field";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SourceBadge, sourceKinds } from "@/components/source-badge";
import {
  StatusMark,
  statusLabels,
  type StatusKind,
} from "@/components/status-mark";
import { Conclusion } from "@/components/conclusion";
import { DataTable, type Column } from "@/components/data-table";
import { Toolbar } from "@/components/toolbar";
import { PropertyPanel } from "@/components/property-panel";
import { CheckArea } from "@/components/check-area";
import {
  EmptyState,
  LoadingState,
  ErrorState,
  StaleBanner,
} from "@/components/states";
import { MotionValue, MotionReveal, MotionGlyph } from "@/components/motion";
import { formatNumber, engineeringQuantity } from "@/lib/format";
import { useShortcuts } from "@/lib/use-shortcuts";
import { galleryEntries as drawingEntries } from "@/features/drawing/gallery-entry";
import { galleryEntries as cadEntries } from "@/features/cad/gallery-entry";

const data = [
  { id: "300", name: "3×300", current: 452 },
  { id: "400", name: "3×400", current: 514 },
];
const columns: Column<(typeof data)[number]>[] = [
  { id: "name", label: "型号", render: (row) => row.name },
  {
    id: "current",
    label: "电流",
    unit: "A",
    numeric: true,
    render: (row) => formatNumber(row.current),
  },
];
const options = [
  { value: "one", label: "标准控件" },
  { value: "two", label: "第二选项" },
  { value: "disabled", label: "不可用选项", disabled: true },
];
const pageLabels: Record<PageState, string> = {
  empty: "空",
  loading: "加载",
  error: "错误",
  success: "成功",
  historical: "历史结果",
};
function Section({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`gallery-section ${wide ? "gallery-wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function GalleryPage() {
  const { theme } = galleryRoute.useSearch();
  const navigate = galleryRoute.useNavigate();
  const [number, setNumber] = useState<number | null>(400);
  const [select, setSelect] = useState("one");
  const [tab, setTab] = useState("normal");
  const [selected, setSelected] = useState("300");
  const [collapsed, setCollapsed] = useState(false);
  const [panelEmpty, setPanelEmpty] = useState(false);
  const [dialog, setDialog] = useState("");
  const [state, setState] = useState<PageState>("success");
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState(0);
  const unavailable = useCallback((name: string) => setDialog(name), []);
  useShortcuts(unavailable);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <>
      <AppShell
        gallery
        title="公共组件陈列"
        status={
          <StatusMark
            kind="current"
            label="静态样例"
            detail="各控件只演示交互，不保存工程数据。"
          />
        }
        actions={
          <Button size="compact" asChild>
            <Link
              to="/gallery/selection"
              search={{ theme, state, tab: "results" }}
            >
              查看选型页
            </Link>
          </Button>
        }
        theme={theme}
        onTheme={() =>
          navigate({
            search: { theme: theme === "light" ? "dark" : "light" },
            replace: true,
          })
        }
        onUnavailable={(name) => setDialog(`${name}尚未迁移`)}
      >
        <div className="gallery-intro">
          <Select
            label="页面状态"
            value={state}
            onChange={(value) => setState(value as PageState)}
            options={Object.entries(pageLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <span className="muted">浅深色共用同一组件实现</span>
          <nav aria-label="选型五态">
            {Object.entries(pageLabels).map(([value, label]) => (
              <Link
                key={value}
                to="/gallery/selection"
                search={{ theme, state: value as PageState, tab: "results" }}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {state === "empty" ? (
          <EmptyState
            title="陈列内容为空"
            description="切换为成功状态查看全部公共控件。"
          />
        ) : state === "loading" ? (
          <LoadingState title="正在加载组件陈列" />
        ) : state === "error" ? (
          <ErrorState
            description="陈列资源读取失败，可返回成功状态查看。"
            action={
              <Button onClick={() => setState("success")}>重新读取</Button>
            }
          />
        ) : (
          <>
            {state === "historical" && (
              <StaleBanner description="当前展示上次组件样例。" />
            )}
            <div className="gallery-grid">
              <Section title="开源组件" wide><Tabs defaultValue="foundation"><TabsList><TabsTrigger value="foundation">组件底座</TabsTrigger><TabsTrigger value="agent-demo">Agent · 演示</TabsTrigger></TabsList><TabsContent value="foundation"><p className="muted">Radix 控件、BuzzForm 参数表单、TanStack 结果表、gridcn 分层表和运行记录组件已接入正式界面。</p></TabsContent><TabsContent value="agent-demo"><Suspense fallback={<LoadingState title="正在读取演示组件" />}><AgentGallery /></Suspense></TabsContent></Tabs></Section>
              {[...drawingEntries, ...cadEntries].map(
                ({ id, title, Component }) => (
                  <Section key={id} title={title} wide>
                    <Component state={state} />
                  </Section>
                ),
              )}
              <Section title="Button / IconButton">
                <div className="demo-row">
                  {(
                    ["default", "primary", "run", "agent", "ghost"] as const
                  ).map((variant) => (
                    <Button
                      key={variant}
                      variant={variant}
                      size="compact"
                      onClick={() => setDialog("按钮反馈")}
                    >
                      {
                        {
                          default: "普通",
                          primary: "主要",
                          run: "运行计算",
                          agent: "Agent",
                          ghost: "取消",
                        }[variant]
                      }
                    </Button>
                  ))}
                </div>
                <div className="demo-row">
                  <Button>标准 36</Button>
                  <Button size="compact">紧凑 32</Button>
                  <Button previewState="hover">悬停</Button>
                  <Button previewState="focus">焦点</Button>
                  <Button previewState="active">按下</Button>
                  <Button disabled>禁用</Button>
                  <Button loading>加载</Button>
                  <Button previewState="error">错误</Button>
                </div>
                <div className="demo-row">
                  <IconButton
                    icon="action/save"
                    label="保存样例"
                    onClick={() => setDialog("保存尚未接入")}
                  />
                  {(["hover", "focus", "active", "error"] as const).map(
                    (previewState) => (
                      <IconButton
                        key={previewState}
                        icon="action/save"
                        label={`图标按钮 ${previewState}`}
                        previewState={previewState}
                      />
                    ),
                  )}
                  <IconButton icon="action/save" label="禁用保存" disabled />
                  <IconButton
                    icon="action/refresh"
                    label="加载图标按钮"
                    loading
                  />
                </div>
              </Section>
              <Section title="NumberField">
                <div className="field-grid">
                  <NumberField
                    label="目标电流"
                    value={number}
                    onCommit={setNumber}
                    unit="A"
                    min={1}
                    max={1000}
                    required
                    source="user"
                  />
                  <NumberField
                    label="温度精度"
                    value={25}
                    precision={1}
                    unit="°C"
                  />
                  <NumberField
                    label="未保存"
                    value={0.6}
                    precision={2}
                    unit="K·m/W"
                    dirty
                    source="user"
                  />
                  <NumberField
                    label="校验错误"
                    value={-1}
                    unit="mm"
                    error="埋深须大于 0 mm"
                  />
                  <NumberField
                    label="锁定推导"
                    value={87}
                    precision={1}
                    unit="mm"
                    source="derived"
                    locked
                  />
                  <NumberField label="不可用" value={null} unit="A" disabled />
                  <NumberField
                    label="必填空值"
                    value={null}
                    unit="A"
                    required
                  />
                </div>
                <p className="muted">Enter 确认 · Esc 取消 · 允许 1–1000 A</p>
              </Section>
              <Section title="SourceBadge / StatusMark">
                <div className="demo-row">
                  {(
                    Object.keys(sourceKinds) as (keyof typeof sourceKinds)[]
                  ).map((kind) => (
                    <SourceBadge
                      key={kind}
                      kind={kind}
                      detail={`${sourceKinds[kind].label}来源样例，未关联真实记录。`}
                    />
                  ))}
                </div>
                <div className="demo-row">
                  {(Object.keys(statusLabels) as StatusKind[]).map((kind) => (
                    <StatusMark key={kind} kind={kind} />
                  ))}
                </div>
                <StatusMark
                  kind="saved"
                  label="可展开状态"
                  detail="对象状态、输入来源与运行信息在此按需查看。"
                />
              </Section>
              <Section title="Select / Tooltip">
                <div className="field-grid">
                  <Select
                    label="标准选择"
                    value={select}
                    onChange={setSelect}
                    options={options}
                  />
                  <Select label="空选择" onChange={() => {}} options={[]} />
                  <Select
                    label="禁用选择"
                    value="one"
                    onChange={() => {}}
                    options={options}
                    disabled
                  />
                  <Select
                    label="加载选择"
                    onChange={() => {}}
                    options={options}
                    loading
                  />
                  <Select
                    label="错误选择"
                    onChange={() => {}}
                    options={options}
                    error="请选择可用方法"
                  />
                </div>
                <div className="demo-row">
                  <Tooltip content="支持鼠标悬停和键盘聚焦">
                    <Button variant="ghost">来源提示</Button>
                  </Tooltip>
                  <Tooltip content="缺少适用插件">
                    <span tabIndex={0}>
                      <Button disabled>禁用动作说明</Button>
                    </span>
                  </Tooltip>
                </div>
              </Section>
              <Section title="Tabs / Toolbar">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList aria-label="陈列页签">
                    <TabsTrigger value="normal">当前</TabsTrigger>
                    <TabsTrigger value="empty">空</TabsTrigger>
                    <TabsTrigger value="loading">加载</TabsTrigger>
                    <TabsTrigger value="error">错误</TabsTrigger>
                    <TabsTrigger value="disabled" disabled>
                      禁用
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="normal">
                    <Toolbar label="样例工具栏">
                      <strong>候选</strong>
                      <div className="spacer" />
                      <Button
                        size="compact"
                        onClick={() => setDialog("筛选样例")}
                      >
                        筛选
                      </Button>
                      <IconButton
                        icon="action/export"
                        label="导出样例"
                        disabled
                      />
                    </Toolbar>
                  </TabsContent>
                  <TabsContent value="empty">
                    <p className="muted">此页签暂无记录</p>
                  </TabsContent>
                  <TabsContent value="loading">
                    <p role="status">正在加载…</p>
                  </TabsContent>
                  <TabsContent value="error">
                    <p className="field-error" role="alert">
                      读取失败
                    </p>
                  </TabsContent>
                </Tabs>
              </Section>
              <Section title="DataTable：分组 / 折叠 / 选中 / 数值列">
                <DataTable
                  label="分组样例"
                  columns={columns}
                  groups={[
                    { id: "satisfied", label: "满足", rows: data },
                    {
                      id: "closed",
                      label: "折叠组",
                      rows: [{ id: "closed-row", name: "3×240", current: 391 }],
                      defaultCollapsed: true,
                    },
                  ]}
                  selectedId={selected}
                  onSelect={(row) => setSelected(row.id)}
                  rowLabel={(row) => `选择样例 ${row.name}`}
                />
                <details>
                  <summary>标准 44 行高及空、加载、错误</summary>
                  <DataTable
                    label="标准表"
                    density="standard"
                    columns={columns}
                    groups={[{ id: "standard", label: "标准", rows: data }]}
                    rowLabel={(row) => row.name}
                  />
                  <DataTable
                    label="空表"
                    columns={columns}
                    groups={[]}
                    rowLabel={(row) => row.name}
                  />
                  <DataTable
                    label="加载表"
                    columns={columns}
                    groups={[]}
                    rowLabel={(row) => row.name}
                    loading
                  />
                  <DataTable
                    label="错误表"
                    columns={columns}
                    groups={[]}
                    rowLabel={(row) => row.name}
                    error="记录读取失败"
                  />
                </details>
              </Section>
              <Section title="Conclusion：当前 / 历史 / 缺项" wide>
                <Conclusion
                  model="YJV22-8.7/15 kV 3×300"
                  description="满足每回 400 A 的最小示例截面"
                  metrics={[
                    { label: "允许电流", value: 452, unit: "A" },
                    { label: "目标电流", value: 400, unit: "A" },
                    { label: "余量", value: 13, precision: 1, unit: "%" },
                  ]}
                />
                <details>
                  <summary>历史和缺项</summary>
                  <Conclusion
                    model="YJV22-8.7/15 kV 3×300"
                    description="输入已变化，仅供追溯"
                    metrics={[{ label: "原允许电流", value: 452, unit: "A" }]}
                    historical
                  />
                  <Conclusion
                    title="未覆盖"
                    model="候选缺少必需输入"
                    description="缺数据时保留缺项"
                    metrics={[{ label: "允许电流", value: null, unit: "A" }]}
                  />
                </details>
              </Section>
              <Section title="PropertyPanel / CheckArea">
                <div className="demo-row">
                  <Button
                    size="compact"
                    onClick={() => setPanelEmpty(!panelEmpty)}
                  >
                    {panelEmpty ? "选择对象" : "取消选择"}
                  </Button>
                  <Button
                    size="compact"
                    onClick={() => setCollapsed(!collapsed)}
                  >
                    {collapsed ? "展开面板" : "收起面板"}
                  </Button>
                </div>
                <div className="property-demo">
                  <PropertyPanel
                    title="YJV22-8.7/15 kV 3×300"
                    collapsed={collapsed}
                    empty={panelEmpty}
                    onToggle={() => setCollapsed(!collapsed)}
                    groups={[
                      {
                        label: "尺寸",
                        items: [
                          {
                            label: "截面",
                            value: "300",
                            unit: "mm²",
                            source: "demo",
                          },
                          {
                            label: "电流",
                            value: "452",
                            unit: "A",
                            source: "demo",
                          },
                        ],
                      },
                    ]}
                  />
                </div>
                <CheckArea summary="已核对 3 项 · 未覆盖 1 项">
                  <p>仅为校核区展开样例，不执行标准判定。</p>
                </CheckArea>
              </Section>
              <Section title="Dialog / 动效 / 格式化">
                <div className="demo-row">
                  <Button onClick={() => setDialog("对话框样例")}>
                    打开对话框
                  </Button>
                  <Button size="compact" onClick={() => setReveal(!reveal)}>
                    抽屉展开
                  </Button>
                  <Button size="compact" onClick={() => setResult(result + 1)}>
                    触发结果到达
                  </Button>
                </div>
                <MotionReveal
                  open={reveal}
                  kind="drawer"
                  className="drawer-demo"
                >
                  <h3>抽屉内容</h3>
                  <p className="muted">200 ms，Esc 关闭</p>
                  <Button
                    onClick={() => setReveal(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setReveal(false);
                    }}
                  >
                    关闭抽屉
                  </Button>
                </MotionReveal>
                <div className="demo-row">
                  <span className="numeric">
                    <MotionValue key={result} value={648} from={632} /> A
                  </span>
                  <MotionGlyph kind="running" />
                  <MotionGlyph kind="selection" />
                  <span>{engineeringQuantity("current", 12345.6, "A").text} A</span>
                  <span>{formatNumber(-0.0601, 4)} Ω/km</span>
                  <span>{formatNumber(null)}</span>
                </div>
              </Section>
              <Section title="空 / 加载 / 错误 / 历史" wide>
                <div className="state-grid">
                  <EmptyState
                    title="尚无记录"
                    description="添加候选后查看结果。"
                  />
                  <LoadingState title="读取记录" />
                  <ErrorState
                    description="网络不可用，已保存输入保留。"
                    action={
                      <Button
                        size="compact"
                        onClick={() => setDialog("重试样例")}
                      >
                        重试
                      </Button>
                    }
                  />
                  <StaleBanner description="输入已变化，保留历史结果。" />
                </div>
              </Section>
            </div>
          </>
        )}
      </AppShell>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) setDialog("");
        }}
        title={dialog}
        description="静态交互样例，Enter 可确认，Esc 关闭并恢复焦点。"
        actions={
          <Button variant="primary" onClick={() => setDialog("")}>
            确认
          </Button>
        }
      />
    </>
  );
}
