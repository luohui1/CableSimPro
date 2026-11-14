// The top bar sits on the ground, not in a panel: the product, the project, and the two actions on a project.
import { useMutation } from '@tanstack/react-query';
import { Button, ToolButton } from '@/components/button';
import { Icon, Mark } from '@/components/icon';
import { reportFailure } from '@/components/notice';
import { Menu, MenuItem } from '@/components/popover';
import { api } from '@/state/api';
import { queryClient } from '@/state/queries';
import { useTheme } from '@/state/theme';
import type { ProjectMeta, RunHeader } from '@shared/types';

export function TopBar({ projects, project, run, runnable, fresh, onOpenProject, onOpenRun }: {
  projects: ProjectMeta[];
  project: ProjectMeta | undefined;
  /** The shown run, when a calculation sheet can be made from it. */
  run: string | undefined;
  runnable: boolean;
  /** The shown result belongs to the project's present inputs. */
  fresh: boolean;
  onOpenProject: (id: string) => void;
  onOpenRun: (run: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const rate = useMutation({
    mutationFn: () => api.op<RunHeader>('run.rate', { project: project?.id }),
    onSuccess: async saved => {
      await queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
      onOpenRun(saved.id);
    },
    onError: reportFailure,
  });
  const sheet = useMutation({
    mutationFn: async () => {
      // The tab is opened inside the click, so the browser does not treat it as a pop-up.
      const tab = window.open('', '_blank');
      try {
        const exported = await api.op<{ url: string }>('report.export', { project: project?.id, run });
        if (tab) tab.location.href = exported.url;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
    onError: reportFailure,
  });

  return <header className="flex h-12 shrink-0 items-center gap-3 px-4">
    <Mark />
    <span className="text-16 font-strong text-ink">Cable Studio</span>
    <span className="mx-1 h-5 w-px bg-control" />
    <Menu trigger={
      <button type="button" className="flex h-8 max-w-96 items-center gap-2 rounded-full px-3 text-14 text-ink transition-colors duration-fast ease-std hover:bg-hover data-[popup-open]:bg-hover">
        <span className="truncate">{project?.name ?? '选择工程'}</span>
        <Icon name="action/chevrons-up-down" className="size-4 text-ink-2" />
      </button>}>
      {projects.map(item => <MenuItem key={item.id} checked={item.id === project?.id} onSelect={() => onOpenProject(item.id)}>{item.name}</MenuItem>)}
    </Menu>
    <div className="flex-1" />
    <ToolButton icon="nav/theme" label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle} />
    {/* One copper button: the next step. Without a result that is to compute; with a fresh result it is the sheet. */}
    <Button variant={fresh ? 'outline' : 'primary'} icon="run/run" disabled={!runnable} busy={rate.isPending} onClick={() => rate.mutate()}>{fresh ? '重新计算' : '运行校核'}</Button>
    <Button variant={fresh ? 'primary' : 'outline'} icon="result/report" disabled={!run} busy={sheet.isPending} onClick={() => sheet.mutate()}>{fresh ? '出计算书' : '计算书'}</Button>
  </header>;
}
