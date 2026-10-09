import { useEffect } from 'react';
import { createRoute, Outlet, useNavigate, useParams, useSearch, lazyRouteComponent, type AnyRootRoute } from '@tanstack/react-router';
import { TypeNavigationContext, type TypeLocation } from './navigation';
import { typeModules } from './module-definitions';
const TypeListPage = lazyRouteComponent(() => import('./list-page'), 'TypeListPage');
const TypeProvider = lazyRouteComponent(() => import('./provider'), 'TypeProvider');
const TypeWorkspace = lazyRouteComponent(() => import('./workspace'), 'TypeWorkspace');

export function typeSearch(value: Record<string, unknown>) { return { theme: value.theme === 'dark' ? 'dark' as const : 'light' as const,
  create: value.create === '1' || value.create === 1 || value.create === true ? true : undefined,
  revision: Number.isInteger(Number(value.revision)) && Number(value.revision) >= 1 ? Number(value.revision) : undefined,
  run: typeof value.run === 'string' && value.run ? value.run : undefined, layer: typeof value.layer === 'string' && value.layer.length <= 200 ? value.layer : undefined,
  field: typeof value.field === 'string' && value.field.startsWith('/') && value.field.length <= 800 ? value.field : undefined }; }
function Navigation({ children, location }: { children: React.ReactNode; location: TypeLocation }) {
  const navigate = useNavigate();
  useEffect(() => { document.documentElement.dataset.theme = location.theme; }, [location.theme]);
  const go = (path: string) => { const target = new URL(path, window.location.origin); void navigate({ to: target.pathname, search: typeSearch(Object.fromEntries(target.searchParams)) }); };
  return <TypeNavigationContext.Provider value={{ location, navigate: go, onTheme: () => {
    const next = location.theme === 'light' ? 'dark' : 'light'; const url = new URL(window.location.href); url.searchParams.set('theme', next); go(url.pathname + url.search);
  } }}>{children}</TypeNavigationContext.Provider>;
}
/** The public router owner adds these children to the existing root. No second production shell. */
export function createTypeRoutes(root: AnyRootRoute) {
  const list = createRoute({ getParentRoute: () => root, path: '/types', validateSearch: typeSearch, component: function TypeIndexRoute() {
    const search = useSearch({ strict: false });
    const location = { module: 'list', tab: '', ...typeSearch(search as Record<string, unknown>) };
    return <Navigation location={location}><TypeListPage /></Navigation>;
  } });
  const parent = createRoute({ getParentRoute: () => root, path: '/types/$wid', validateSearch: typeSearch, component: function TypeWorkspaceRoute() {
    const params = useParams({ strict: false }) as Record<string, string | undefined>;
    const search = typeSearch(useSearch({ strict: false }) as Record<string, unknown>);
    const module = params.module || 'structure';
    const location = { wid: params.wid, module, tab: params.tab || typeModules.find(item => item.id === module)?.tabs[0][0] || 'section', ...search };
    document.documentElement.dataset.theme = location.theme;
    return <Navigation location={location}><TypeProvider key={params.wid + '/' + String(search.revision) + '/' + String(search.run)} wid={params.wid!}><Outlet /></TypeProvider></Navigation>;
  } });
  const content = createRoute({ getParentRoute: () => parent, path: '$module/$tab', component: () => <TypeWorkspace /> });
  const moduleEntry = createRoute({ getParentRoute: () => parent, path: '$module', component: () => <TypeWorkspace /> });
  const entry = createRoute({ getParentRoute: () => parent, path: '/', component: () => <TypeWorkspace /> });
  return [list, parent.addChildren([content, moduleEntry, entry])] as const;
}
