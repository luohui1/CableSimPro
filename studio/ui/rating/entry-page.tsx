// /workbench: where the rating workbench is entered. With a cable in the address (/workbench?model=<library id>) or on the
// way to a new project (?new), it is the new-project screen; otherwise it opens the project used last, and with no project
// yet it offers to make the first.
import { getRouteApi, Navigate } from '@tanstack/react-router';
import { EmptyState } from '@/kit/workbench/premise';
import { useProjects } from '@/state/queries';
import { messageOf } from './messages';
import { RatingFrame } from './frame';
import { LAST_PROJECT } from './last';
import { StartScreen } from './project-start';

const route = getRouteApi('/workbench');

export function EntryPage() {
  const { model, new: starting } = route.useSearch();
  const projects = useProjects();
  if (model || starting) return <RatingFrame creating><StartScreen key={model ?? 'new'} model={model} /></RatingFrame>;
  if (projects.isPending) return <RatingFrame />;
  if (projects.error) return <RatingFrame><EmptyState icon="status/error" title="连不上本机服务" description={messageOf(projects.error)} /></RatingFrame>;
  const list = projects.data;
  if (list.length === 0) return <RatingFrame creating><StartScreen /></RatingFrame>;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT); } catch { /* private browsing */ }
  const target = list.find(item => item.id === last) ?? [...list].sort((a, b) => b.updated.localeCompare(a.updated))[0];
  return <Navigate to="/p/$projectId" params={{ projectId: target.id }} search={{}} replace />;
}
