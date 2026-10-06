import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Navigate,
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
import { EmptyState } from "./components/states";
const SelectionPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/selection-page'), 'SelectionPage') : undefined;
const GalleryPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/gallery-page'), 'GalleryPage') : undefined;
const LibraryPage = lazyRouteComponent(() => import('./pages/library-page'), 'LibraryPage');
const DocumentsPage = lazyRouteComponent(() => import('./pages/documents-page'), 'DocumentsPage');
const DeliveriesPage = lazyRouteComponent(() => import('./pages/deliveries-page'), 'DeliveriesPage');
const PluginsPage = lazyRouteComponent(() => import('./pages/plugins-page'), 'PluginsPage');
const SettingsPage = lazyRouteComponent(() => import('./pages/settings-page'), 'SettingsPage');
const AgentPage = lazyRouteComponent(() => import('./pages/agent-page'), 'AgentPage');
const ProjectHome = lazyRouteComponent(() => import('./pages/project-home'), 'ProjectHome');
const ReproductionPage = lazyRouteComponent(() => import('./pages/reproduction-page'), 'ReproductionPage');
const StudyProvider = lazyRouteComponent(() => import('./components/study-provider'), 'StudyProvider');
const StudyWorkspace = lazyRouteComponent(() => import('./pages/study-workspace'), 'StudyWorkspace');
const StudyEntry = lazyRouteComponent(() => import('./pages/study-workspace'), 'StudyEntry');

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
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library", validateSearch: themeSearch, component: LibraryPage });
const deliveriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/deliveries", validateSearch: (search: Record<string, unknown>) => ({ ...themeSearch(search), workspace: typeof search.workspace === "string" ? search.workspace : "", delivery: typeof search.delivery === "string" ? search.delivery : "" }), component: DeliveriesPage });
const documentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/documents", validateSearch: (search: Record<string, unknown>): { theme: 'light' | 'dark'; document?: string; extraction?: string; proposal?: string; batch?:string } => ({ ...themeSearch(search), document: typeof search.document === 'string' ? search.document : '', extraction: typeof search.extraction === 'string' ? search.extraction : '', proposal: typeof search.proposal === 'string' ? search.proposal : '', batch:typeof search.batch === 'string' ? search.batch : '' }), component: DocumentsPage });
const pluginsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins", validateSearch: themeSearch, component: PluginsPage });
const pluginDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins/$pid", validateSearch: themeSearch, component: PluginsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", validateSearch: themeSearch, component: SettingsPage });
const agentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/agent", validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; workspace?: string } => ({ ...themeSearch(search), workspace: typeof search.workspace === "string" ? search.workspace : undefined }), component: AgentPage });
const reproductionSearch = (search: Record<string, unknown>) => ({ ...themeSearch(search), snapshot: typeof search.snapshot === "string" ? search.snapshot : "" });
const reproductionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/reproductions", validateSearch: reproductionSearch, component: ReproductionPage });
const reproductionDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/reproductions/$target/$tab", validateSearch: reproductionSearch, beforeLoad: ({ params }) => { if (!["results", "overlay", "convergence", "sources", "scope"].includes(params.tab)) throw notFound(); }, component: ReproductionPage });
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: themeSearch,
  component: () => <ObjectListPage home />,
});
export const studiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies",
  validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; kind?: string; workspace?: string } => ({ ...themeSearch(search), kind: ['simulation','ampacity'].includes(String(search.kind)) ? String(search.kind) : undefined, workspace: typeof search.workspace === 'string' ? search.workspace : undefined }),
  // 带工程身份时是工程首页（与计算工作台同一骨架），否则是全部计算的列表
  component: function StudiesPage() {
    const search = studiesRoute.useSearch();
    return search.workspace ? <ProjectHome key={search.workspace} workspaceId={search.workspace} theme={search.theme} /> : <ObjectListPage />;
  },
});
const simulationListRoute = createRoute({ getParentRoute: () => rootRoute, path: "/simulation", validateSearch: themeSearch, component: () => <Navigate to="/studies" search={{ theme: preferences().theme, kind: "simulation" }} replace /> });
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
  validateSearch: themeSearch,
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
    // 工作窗口中间画布显示的模型视图；不写时由计算类型决定
    view: search.view === "cable" || search.view === "three" || search.view === "section" || search.view === "field" ? search.view : undefined,
    // 右侧属性区显示“输入”还是“方法”（方法参数、问询条件、扫描设置）
    inspector: search.inspector === "method" || search.inspector === "input" || search.inspector === "agent" ? search.inspector : undefined,
  }),
  loaderDeps: ({ search }) => ({ workspace: search.workspace, run: search.run }),
  // 悬停或进入前并行预取研究、工程和运行；失败交给页面的错误状态。
  loader: ({ context, params, deps }) => prefetchStudy(context.queryClient, deps.workspace, params.sid, deps.run),
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
    <Navigate
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
    <Navigate to="/studies" search={{ theme: "light" }} replace />
  ),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    libraryRoute, documentsRoute, deliveriesRoute, pluginsRoute, pluginDetailRoute, settingsRoute, agentRoute,
    reproductionsRoute, reproductionDetailRoute,
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
