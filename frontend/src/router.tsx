import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  notFound,
  redirect,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { ObjectListPage } from "./pages/object-list-page";
import { createTypeRoutes } from "./features/type/routes";
import { preferences } from "./lib/preferences";
import { moduleDefinitions } from "./pages/study-modules";
import type { QueryClient } from "@tanstack/react-query";
import { ShellLayout, RouteSkeleton } from "./components/shell-layout";
import { queryClient } from "./lib/query-client";
import { prefetchStudy } from "./lib/study-queries";
import { prefetchStandardsBasis } from './lib/standards-queries';
import { prefetchHomePage, prefetchPluginsPage, prefetchRunsPage } from './lib/catalog-queries';
import { EmptyState } from "./components/states";
import { Redirect } from "./components/redirect";
import { lazyWorkbenchRoute } from './lib/lazy-workbench-route';
const SelectionPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/selection-page'), 'SelectionPage') : undefined;
const GalleryPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/gallery-page'), 'GalleryPage') : undefined;
const AssetsPage = lazyWorkbenchRoute(() => import('./pages/library-page'), 'AssetsPage');
const CableVersionsPage = lazyWorkbenchRoute(() => import('./pages/cable-versions-page'), 'CableVersionsPage');
const RunsPage = lazyWorkbenchRoute(() => import('./pages/runs-page'), 'RunsPage');
const HomePage = lazyWorkbenchRoute(() => import('./pages/home-page'), 'HomePage');
const InboxPage = lazyWorkbenchRoute(() => import('./pages/inbox-page'), 'InboxPage');
const DocumentsPage = lazyWorkbenchRoute(() => import('./pages/documents-page'), 'DocumentsPage');
const DeliveriesPage = lazyWorkbenchRoute(() => import('./pages/deliveries-page'), 'DeliveriesPage');
const PluginsPage = lazyWorkbenchRoute(() => import('./pages/plugins-page'), 'PluginsPage');
const SettingsPage = lazyWorkbenchRoute(() => import('./pages/settings-page'), 'SettingsPage');
const AgentPage = lazyRouteComponent(() => import('./pages/agent-page'), 'AgentPage');
const ProjectHome = lazyWorkbenchRoute(() => import('./pages/project-home'), 'ProjectHome');
const ReproductionPage = lazyWorkbenchRoute(() => import('./pages/reproduction-page'), 'ReproductionPage');
const StudyProvider = lazyWorkbenchRoute(() => import('./components/study-provider'), 'StudyProvider');
const StudyWorkspace = lazyWorkbenchRoute(() => import('./pages/study-workspace'), 'StudyWorkspace');
const StudyEntry = lazyWorkbenchRoute(() => import('./pages/study-workspace'), 'StudyEntry');

export type PageState =
  "empty" | "loading" | "error" | "success" | "historical";
export type SelectionSearch = {
  theme: "light" | "dark";
  state: PageState;
  tab: "results" | "settings";
};
const themeSearch = (
  search: Record<string, unknown>,
): { theme: "light" | "dark" } => ({
  theme: search.theme === "dark" ? "dark" : search.theme === "light" ? "light" : preferences().theme,
});
const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // 常驻外壳：侧栏只挂载一次，换页只替换右侧内容面板。
  component: ShellLayout,
  notFoundComponent: () => (
    <section className="work-panel not-found">
      <EmptyState art="no-results" title="页面不存在" description="链接可能已失效，或对象已被删除。"
        action={<Link className="button button-secondary button-compact" to="/studies" search={{ theme: preferences().theme }}>返回研究列表</Link>} />
    </section>
  ),
});
const deliverySearch = (search: Record<string, unknown>) => ({ ...themeSearch(search), workspace: typeof search.workspace === "string" ? search.workspace : "", delivery: typeof search.delivery === "string" ? search.delivery : "" });
// 资源目录的 item：链接直接打开某一条的属性面板（ObjectLink 只在 object-link 里换算）
const itemSearch = (search: Record<string, unknown>): { theme: "light" | "dark"; item?: string } => ({ ...themeSearch(search), item: typeof search.item === "string" && search.item ? search.item : undefined });
const documentSearch = (search: Record<string, unknown>): { theme: 'light' | 'dark'; document?: string; extraction?: string; proposal?: string; batch?:string } => ({ ...themeSearch(search), document: typeof search.document === 'string' ? search.document : '', extraction: typeof search.extraction === 'string' ? search.extraction : '', proposal: typeof search.proposal === 'string' ? search.proposal : '', batch:typeof search.batch === 'string' ? search.batch : '' });
// 资源（FRONTEND_REQUIREMENTS §2.2 / §2.3）：电缆型号版本及其厂家资料导入；材料与部件、模板与计算方案、标准与规则
const cableVersionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/resources/cables", validateSearch: itemSearch, component: CableVersionsPage });
const documentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/resources/cables/imports", validateSearch: documentSearch, component: DocumentsPage });
const assetGroupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/resources/$group", validateSearch: itemSearch, beforeLoad: ({ params, context }) => {
  if (!["materials", "templates", "standards"].includes(params.group)) throw notFound();
  if (params.group === 'standards') prefetchStandardsBasis(context.queryClient);
}, component: AssetsPage });
// 记录：运行与作业、交付；都是跨对象的筛选视图，各自的家在所属研究或型号里
const runsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs", validateSearch: themeSearch,
  beforeLoad: ({ context }) => { prefetchRunsPage(context.queryClient); }, component: RunsPage });
// 待办：四类审核、过期待重算、资料缺项、进行中，来自统一索引（§2.3）
const inboxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/inbox", validateSearch: themeSearch, component: InboxPage });
const deliveriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/deliveries", validateSearch: deliverySearch, component: DeliveriesPage });
// 旧地址只做跳转，书签与其他页面里的链接不失效
const legacyLibraryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library", validateSearch: themeSearch, beforeLoad: ({ search }) => { throw redirect({ to: "/resources/cables", search, replace: true }); } });
const legacyDeliveriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/deliveries", validateSearch: deliverySearch, beforeLoad: ({ search }) => { throw redirect({ to: "/deliveries", search, replace: true }); } });
const legacyDocumentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/documents", validateSearch: documentSearch, beforeLoad: ({ search }) => { throw redirect({ to: "/resources/cables/imports", search, replace: true }); } });
const pluginsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins", validateSearch: themeSearch,
  beforeLoad: ({ context }) => { prefetchPluginsPage(context.queryClient); }, component: PluginsPage });
const pluginDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins/$pid", validateSearch: themeSearch,
  beforeLoad: ({ context }) => { prefetchPluginsPage(context.queryClient); }, component: PluginsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; section?: string } => ({ ...themeSearch(search), section: typeof search.section === "string" ? search.section : undefined }), component: SettingsPage });
const computeSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings/compute", validateSearch: themeSearch, component: SettingsPage });
const agentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/agent", validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; workspace?: string; task?: string; ask?: "inbox" } => ({ ...themeSearch(search), workspace: typeof search.workspace === "string" ? search.workspace : undefined, task: typeof search.task === "string" ? search.task : undefined, ask: search.ask === "inbox" ? "inbox" as const : undefined }), component: AgentPage });
const reproductionSearch = (search: Record<string, unknown>) => ({ ...themeSearch(search), snapshot: typeof search.snapshot === "string" ? search.snapshot : "" });
// 方法：验证算例是插件的验证证据（§2.3）
const reproductionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/validation", validateSearch: reproductionSearch, component: ReproductionPage });
const reproductionDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/validation/$target/$tab", validateSearch: reproductionSearch, beforeLoad: ({ params }) => { if (!["results", "overlay", "convergence", "sources", "scope"].includes(params.tab)) throw notFound(); }, component: ReproductionPage });
const legacyReproductionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/reproductions", validateSearch: reproductionSearch, beforeLoad: ({ search }) => { throw redirect({ to: "/validation", search, replace: true }); } });
const legacyReproductionDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/reproductions/$target/$tab", validateSearch: reproductionSearch, beforeLoad: ({ params, search }) => { throw redirect({ to: "/validation/$target/$tab", params, search, replace: true }); } });
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: themeSearch,
  beforeLoad: ({ context }) => { prefetchHomePage(context.queryClient); },
  component: HomePage,
});
export const studiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies",
  validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; kind?: string; workspace?: string } => ({ ...themeSearch(search), kind: ['simulation','ampacity'].includes(String(search.kind)) ? String(search.kind) : undefined, workspace: typeof search.workspace === 'string' ? search.workspace : undefined }),
  beforeLoad: async ({ search }) => {
    // The project page is nested inside the route component, so preload it before rendering.
    if (search.workspace) await ProjectHome.preload?.();
  },
  // 带工程身份时是工程首页（与研究工作台同一骨架），否则是全部研究的列表
  component: function StudiesPage() {
    const search = studiesRoute.useSearch();
    return search.workspace ? <ProjectHome key={search.workspace} workspaceId={search.workspace} theme={search.theme} /> : <ObjectListPage />;
  },
});
const simulationListRoute = createRoute({ getParentRoute: () => rootRoute, path: "/simulation", validateSearch: themeSearch, component: () => <Redirect to="/studies" search={{ theme: preferences().theme, kind: "simulation" }} replace /> });
export const selectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery/selection",
  validateSearch: (search: Record<string, unknown>): SelectionSearch => ({
    theme: search.theme === "dark" ? "dark" : "light",
    state: ["empty", "loading", "error", "historical"].includes(
      String(search.state),
    )
      ? (search.state as PageState)
      : "success",
    tab: search.tab === "settings" ? "settings" : "results",
  }),
  component: SelectionPage,
});
export const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery",
  validateSearch: (search: Record<string, unknown>): { theme: 'light' | 'dark'; example?: 'command-bar' } => ({ ...themeSearch(search), example: search.example === 'command-bar' ? 'command-bar' : undefined }),
  component: GalleryPage,
});
export const studyRootRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies/$sid",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    theme: "light" | "dark";
    workspace: string;
    run: string;
    delivery: string;
    preflight?: boolean;
    generate?: boolean;
    dataset?: string;
    compare?: string;
    case?: string;
    view?: "section" | "cable" | "three" | "field";
    inspector?: "input" | "method" | "agent";
  } => ({
    theme: search.theme === "dark" ? ("dark" as const) : ("light" as const),
    workspace: typeof search.workspace === "string" ? search.workspace : "",
    run: typeof search.run === "string" ? search.run : "",
    delivery: typeof search.delivery === "string" ? search.delivery : "",
    preflight: search.preflight === true || search.preflight === "true",
    generate: search.generate === true || search.generate === "true",
    dataset: typeof search.dataset === "string" ? search.dataset : "",
    compare: typeof search.compare === "string" ? search.compare : "",
    case: typeof search.case === "string" && search.case ? search.case : undefined,
    // 工作窗口中间画布显示的模型视图；不写时由计算类型决定
    view: search.view === "cable" || search.view === "three" || search.view === "section" || search.view === "field" ? search.view : undefined,
    // 右侧属性区显示“输入”还是“方法”（方法参数、问询条件、扫描设置）
    inspector: search.inspector === "method" || search.inspector === "input" || search.inspector === "agent" ? search.inspector : undefined,
  }),
  loaderDeps: ({ search }) => ({ workspace: search.workspace, run: search.run, inspector: search.inspector }),
  // 悬停或进入前并行预取研究、工程和运行；失败交给页面的错误状态。
  loader: ({ context, params, deps, location }) => {
    const module = location.pathname.split('/')[3] || '';
    const tab = location.pathname.split('/')[4] || '';
    // Prefetch and provider resolve the same existing input/method aliases.
    prefetchStudy(context.queryClient, deps.workspace, params.sid, deps.run, module, tab, deps.inspector);
  },
  component: StudyProvider,
});
const studyEntryRoute = createRoute({
  getParentRoute: () => studyRootRoute,
  path: "/",
  component: StudyEntry,
});
export const studyModuleRoute = createRoute({
  getParentRoute: () => studyRootRoute,
  path: "$module/$tab",
  beforeLoad: ({ params, search }) => {
    const definition = moduleDefinitions[params.module];
    if (!definition?.tabs.some((item) => item.id === params.tab)) throw notFound();
    // 方法类页签（方法参数、问询条件、扫描设置）已移到右侧属性区：旧链接转到第一个结果页签并打开“方法”页
    const methodTab = definition.tabs.find((item) => item.id === "parameters" || item.id === "settings");
    const firstResult = definition.tabs.find((item) => item.id !== methodTab?.id);
    if (methodTab && params.tab === methodTab.id && firstResult)
      throw redirect({ to: "/studies/$sid/$module/$tab", params: { ...params, tab: firstResult.id }, search: { ...search, inspector: "method" }, replace: true });
  },
  component: StudyWorkspace,
});
const moduleEntryRoute = createRoute({
  getParentRoute: () => studyRootRoute,
  path: "$module",
  beforeLoad: ({ params }) => {
    if (!moduleDefinitions[params.module]) throw notFound();
  },
  component: ModuleEntry,
});
function ModuleEntry() {
  const { sid, module } = moduleEntryRoute.useParams();
  const search = studyRootRoute.useSearch();
  return (
    <Redirect
      to="/studies/$sid/$module/$tab"
      params={{ sid, module, tab: moduleDefinitions[module].tabs[0].id }}
      search={search}
      replace
    />
  );
}
const sampleEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/study/selection",
  component: () => (
    <Redirect to="/studies" search={{ theme: "light" }} replace />
  ),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    (() => { const route = createRoute({ getParentRoute: () => rootRoute, path: '/resources/cables/structure-import', validateSearch: itemSearch, component: lazyRouteComponent(() => import('./features/library-import/page'), 'LibraryImportPage') }); return route; })(),
    homeRoute,
    cableVersionsRoute, documentsRoute, assetGroupRoute, runsRoute, deliveriesRoute, inboxRoute,
    pluginsRoute, pluginDetailRoute, settingsRoute, computeSettingsRoute, agentRoute,
    reproductionsRoute, reproductionDetailRoute,
    legacyLibraryRoute, legacyDeliveriesRoute, legacyDocumentsRoute, legacyReproductionsRoute, legacyReproductionDetailRoute,
    simulationListRoute,
    ...createTypeRoutes(rootRoute),
    studiesRoute,
    ...(import.meta.env.DEV ? [selectionRoute, galleryRoute] : []),
    sampleEntryRoute,
    studyRootRoute.addChildren([
      studyEntryRoute,
      studyModuleRoute,
      moduleEntryRoute,
    ]),
  ]),
  context: { queryClient },
  // 参考 TanStack Router basic-react-query 示例与 LobeChat 的延迟骨架：悬停即预取；
  // 200 ms 内完成就不显示等待界面，显示后至少保留 400 ms，避免一闪。
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 200,
  defaultPendingMinMs: 400,
  defaultPendingComponent: RouteSkeleton,
  scrollRestoration: true,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
