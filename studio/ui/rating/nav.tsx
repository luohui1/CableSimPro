// The workbench's column as the rating screens need it. `RatingNavSection` is the 载流量计算 workspace alone: its entry and
// the projects, so the application's shell can put it in the column it builds. `RatingSide` is the whole column for the
// screens of this folder until the shell does that: the type workspace is only an entry to the library here.
import { Link } from '@tanstack/react-router';
import { NavItem, NavSection, WorkbenchNav } from '@/kit/workbench/nav';
import { useProjects } from '@/state/queries';

export function RatingNavSection({ active, creating }: { /** The project being looked at. */ active?: string; /** The new-project screen is open. */ creating?: boolean }) {
  const projects = useProjects();
  // Newest first by creation, so a project does not move up the list each time it is worked on.
  const list = [...(projects.data ?? [])].sort((a, b) => b.created.localeCompare(a.created));
  return <NavSection icon="calc/ampacity" label="载流量计算">
    <NavItem icon="action/add" label="新建工程" active={creating} render={<Link to="/workbench" search={{ new: true }} />} />
    {list.map(project => <NavItem key={project.id} nested label={project.name} active={project.id === active}
      render={<Link to="/p/$projectId" params={{ projectId: project.id }} search={{}} />} />)}
  </NavSection>;
}

export function RatingSide({ active, creating }: { active?: string; creating?: boolean }) {
  return <WorkbenchNav>
    <NavSection icon="nav/cable-type" label="电缆型号">
      <NavItem icon="nav/library" label="型号库" render={<Link to="/library" />} />
    </NavSection>
    <RatingNavSection active={active} creating={creating} />
  </WorkbenchNav>;
}
