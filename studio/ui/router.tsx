// Routes are written in code; nothing is generated. The address holds what a link should reopen:
// the project and the run record being looked at.
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/button';
import { Mark } from '@/components/icon';
import { Notice, reportFailure } from '@/components/notice';
import { api } from '@/state/api';
import { queryClient, useHostEvents, useProjects } from '@/state/queries';
const ProductLibrary = lazyRouteComponent(() => import('@/pages/library'), 'ProductLibrary');
const ImportLibrary = lazyRouteComponent(() => import('@/pages/import'), 'ImportLibrary');
const SeriesWorkspace = lazyRouteComponent(() => import('@/pages/series'), 'SeriesWorkspace');
const Workbench = lazyRouteComponent(() => import('@/workbench/workbench'), 'Workbench');
const Gallery = lazyRouteComponent(() => import('@/pages/gallery'), 'Gallery');

const LAST_PROJECT = 'cable-studio.project';

function Root() {
  useHostEvents();
  return <>
    <Outlet />
    <Notice />
  </>;
}

/** Opens the project used last; with no project yet, offers to make the first one. */
function Landing() {
  const projects = useProjects();
  const create = useMutation({
    mutationFn: () => api.op('project.create', { name: '未命名工程' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: reportFailure,
  });
  if (projects.isPending) return null;
  if (projects.error) return <Centre title="连不上本机服务" body={projects.error.message} />;
  const list = projects.data;
  if (list.length === 0) {
    return <Centre title="还没有工程" body="新建一个工程，从选电缆开始。">
      <Button variant="primary" icon="action/add" busy={create.isPending} onClick={() => create.mutate()}>新建工程</Button>
    </Centre>;
  }
  const last = localStorage.getItem(LAST_PROJECT);
  const target = list.find(item => item.id === last) ?? [...list].sort((a, b) => b.updated.localeCompare(a.updated))[0];
  return <Navigate to="/p/$projectId" params={{ projectId: target.id }} search={{}} replace />;
}

function Centre({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3">
    <Mark className="size-10" />
    <h1 className="m-0 mt-2 text-20 font-strong text-ink">{title}</h1>
    <p className="m-0 mb-2 text-14 text-ink-2">{body}</p>
    {children}
  </div>;
}

function ProjectPage() {
  const { projectId } = projectRoute.useParams();
  const { run } = projectRoute.useSearch();
  const navigate = useNavigate();
  localStorage.setItem(LAST_PROJECT, projectId);
  return <Workbench key={projectId} projectId={projectId} runId={run}
    onOpenProject={id => void navigate({ to: '/p/$projectId', params: { projectId: id }, search: {} })}
    onOpenRun={id => void navigate({ to: '/p/$projectId', params: { projectId }, search: id ? { run: id } : {} })} />;
}

const rootRoute = createRootRoute({ component: Root });
const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Navigate to="/library" replace /> });
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library', component: ProductLibrary });
const importRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library/import', component: ImportLibrary });
const seriesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library/$seriesId',
  validateSearch: (search: Record<string, unknown>): { spec?: string; version?: number } => ({ ...(typeof search.spec === 'string' ? { spec: search.spec } : {}),
    ...(typeof search.version === 'number' && Number.isInteger(search.version) && search.version > 0 ? { version: search.version } : {}) }),
  component: SeriesPage });
function SeriesPage() {
  const { seriesId } = seriesRoute.useParams();
  const { spec, version } = seriesRoute.useSearch();
  const navigate = useNavigate();
  return <SeriesWorkspace key={seriesId} id={seriesId} spec={spec} version={version} onInspect={(spec, version) => void navigate({ to: '/library/$seriesId', params: { seriesId }, search: { spec, version } })} />;
}
const workbenchRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workbench', component: Landing });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$projectId',
  validateSearch: (search: Record<string, unknown>): { run?: string } => (typeof search.run === 'string' ? { run: search.run } : {}),
  component: ProjectPage,
});

const galleryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/gallery', component: Gallery });

export const router = createRouter({ routeTree: rootRoute.addChildren([landingRoute, libraryRoute, importRoute, seriesRoute, workbenchRoute, projectRoute, galleryRoute]) });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
