import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  notFound,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { ObjectListPage } from "./pages/object-list-page";
import { createTypeRoutes } from "./features/type/routes";
import { preferences } from "./lib/preferences";
import { moduleDefinitions } from "./pages/study-modules";
const SelectionPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/selection-page'), 'SelectionPage') : undefined;
const GalleryPage = import.meta.env.DEV ? lazyRouteComponent(() => import('./pages/gallery-page'), 'GalleryPage') : undefined;
const LibraryPage = lazyRouteComponent(() => import('./pages/library-page'), 'LibraryPage');
const DocumentsPage = lazyRouteComponent(() => import('./pages/documents-page'), 'DocumentsPage');
const DeliveriesPage = lazyRouteComponent(() => import('./pages/deliveries-page'), 'DeliveriesPage');
const PluginsPage = lazyRouteComponent(() => import('./pages/plugins-page'), 'PluginsPage');
const SettingsPage = lazyRouteComponent(() => import('./pages/settings-page'), 'SettingsPage');
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
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="not-found">
      <h1>页面不存在</h1>
      <Link to="/studies" search={{ theme: "light" }}>
        返回研究列表
      </Link>
    </main>
  ),
});
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library", validateSearch: themeSearch, component: LibraryPage });
const deliveriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/deliveries", validateSearch: (search: Record<string, unknown>) => ({ ...themeSearch(search), workspace: typeof search.workspace === "string" ? search.workspace : "", delivery: typeof search.delivery === "string" ? search.delivery : "" }), component: DeliveriesPage });
const documentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library/documents", validateSearch: (search: Record<string, unknown>): { theme: 'light' | 'dark'; document?: string; extraction?: string; proposal?: string; batch?:string } => ({ ...themeSearch(search), document: typeof search.document === 'string' ? search.document : '', extraction: typeof search.extraction === 'string' ? search.extraction : '', proposal: typeof search.proposal === 'string' ? search.proposal : '', batch:typeof search.batch === 'string' ? search.batch : '' }), component: DocumentsPage });
const pluginsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins", validateSearch: themeSearch, component: PluginsPage });
const pluginDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/plugins/$pid", validateSearch: themeSearch, component: PluginsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", validateSearch: themeSearch, component: SettingsPage });
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
  validateSearch: (search: Record<string, unknown>): { theme: "light" | "dark"; kind?: string } => ({ ...themeSearch(search), kind: search.kind === "simulation" ? "simulation" : undefined }),
  component: ObjectListPage,
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
  } => ({
    theme: search.theme === "dark" ? ("dark" as const) : ("light" as const),
    workspace: typeof search.workspace === "string" ? search.workspace : "",
    run: typeof search.run === "string" ? search.run : "",
    delivery: typeof search.delivery === "string" ? search.delivery : "",
    preflight: search.preflight === true || search.preflight === "true",
    generate: search.generate === true || search.generate === "true",
    dataset: typeof search.dataset === "string" ? search.dataset : "",
    compare: typeof search.compare === "string" ? search.compare : "",
  }),
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
  beforeLoad: ({ params }) => {
    if (
      !moduleDefinitions[params.module]?.tabs.some(
        (item) => item.id === params.tab,
      )
    )
      throw notFound();
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
    libraryRoute, documentsRoute, deliveriesRoute, pluginsRoute, pluginDetailRoute, settingsRoute,
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
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
