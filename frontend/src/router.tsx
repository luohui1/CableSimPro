import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  notFound,
} from "@tanstack/react-router";
import { SelectionPage } from "./pages/selection-page";
import { GalleryPage } from "./pages/gallery-page";
import { ObjectListPage } from "./pages/object-list-page";
import { StudyProvider } from "./components/study-provider";
import { createTypeRoutes } from "./features/type";
import { LibraryPage } from "./pages/library-page";
import { PluginsPage } from "./pages/plugins-page";
import { SettingsPage } from "./pages/settings-page";
import { ReproductionPage } from "./pages/reproduction-page";
import { preferences } from "./lib/preferences";
import {
  StudyWorkspace,
  StudyEntry,
  moduleDefinitions,
} from "./pages/study-workspace";

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
    libraryRoute, pluginsRoute, pluginDetailRoute, settingsRoute,
    reproductionsRoute, reproductionDetailRoute,
    simulationListRoute,
    ...createTypeRoutes(rootRoute),
    studiesRoute,
    selectionRoute,
    galleryRoute,
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
