// The workbench's own column: the two workspaces and the objects opened lately. It reads the same lists the screens read, so
// what it shows is what the library and the projects hold.
import { Link } from '@tanstack/react-router';
import { NavItem, NavSection, WorkbenchNav } from '@/kit/workbench/nav';
import { useProductLibrary, useProjects } from '@/state/queries';

export type SideAt = { kind: 'library' } | { kind: 'series'; id: string } | { kind: 'project'; id?: string } | { kind: 'none' };

/** How many recent objects each workspace lists under its entry. */
const RECENT = 4;

export function WorkbenchSide({ at }: { at: SideAt }) {
  const library = useProductLibrary();
  const projects = useProjects();
  const series = [...(library.data ?? [])].sort((a, b) => b.updated.localeCompare(a.updated));
  const seriesShown = series.slice(0, RECENT);
  const open = at.kind === 'series' ? series.find(item => item.id === at.id) : undefined;
  if (open && !seriesShown.includes(open)) seriesShown.push(open);
  const projectList = [...(projects.data ?? [])].sort((a, b) => b.updated.localeCompare(a.updated));
  const projectsShown = projectList.slice(0, RECENT);
  const openProject = at.kind === 'project' ? projectList.find(item => item.id === at.id) : undefined;
  if (openProject && !projectsShown.includes(openProject)) projectsShown.push(openProject);

  return <WorkbenchNav>
    <NavSection icon="nav/cable-type" label="电缆型号">
      {[
        <NavItem key="library" icon="nav/library" label="型号库" count={library.data?.length} active={at.kind === 'library'} render={<Link to="/library" />} />,
        ...seriesShown.map(item => <NavItem key={item.id} nested label={item.name} active={at.kind === 'series' && at.id === item.id}
          render={<Link to="/library/$seriesId" params={{ seriesId: item.id }} search={{}} />} />),
      ]}
    </NavSection>
    <NavSection icon="calc/ampacity" label="载流量计算">
      {[
        <NavItem key="projects" icon="object/study" label="全部工程" count={projects.data?.length} render={<Link to="/workbench" />} />,
        ...projectsShown.map(item => <NavItem key={item.id} nested label={item.name} active={at.kind === 'project' && at.id === item.id}
          render={<Link to="/p/$projectId" params={{ projectId: item.id }} search={{}} />} />),
      ]}
    </NavSection>
  </WorkbenchNav>;
}
