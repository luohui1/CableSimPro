// /p/<project>?run=<record>: the calculation of one project, in the rating frame.
import { getRouteApi } from '@tanstack/react-router';
import { RatingFrame } from './frame';
import { LAST_PROJECT } from './last';
import { ProjectScreen } from './project-screen';

const route = getRouteApi('/p/$projectId');

export function ProjectPage() {
  const { projectId } = route.useParams();
  const { run } = route.useSearch();
  try { localStorage.setItem(LAST_PROJECT, projectId); } catch { /* private browsing: the workbench opens the newest project instead */ }
  return <RatingFrame active={projectId}><ProjectScreen key={projectId} projectId={projectId} runId={run} /></RatingFrame>;
}
