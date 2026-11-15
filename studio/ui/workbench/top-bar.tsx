// The top bar sits on the ground, not in a panel: the product, the project, undo, and the next step.
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, ToolButton } from '@/components/button';
import { Icon, Mark } from '@/components/icon';
import { reportFailure } from '@/components/notice';
import { Menu, MenuItem } from '@/components/popover';
import { api } from '@/state/api';
import { useTheme } from '@/state/theme';
import type { ProjectMeta } from '@shared/types';

/** The next step: either the calculation sheet, or an action the workbench names. */
export type Step = { kind: 'sheet' } | { kind: 'action'; label: string; icon: string; busy?: boolean; disabled?: boolean; onClick: () => void };

export function TopBar({ projects, project, sheetRun, next, canUndo, canRedo, onUndo, onRedo, onOpenProject }: {
  projects: ProjectMeta[];
  project: ProjectMeta | undefined;
  /** The kept run record a calculation sheet can be made from. */
  sheetRun: string | undefined;
  next: Step;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenProject: (id: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const sheet = useMutation({
    mutationFn: async () => {
      // The tab is opened inside the click, so the browser does not treat it as a pop-up.
      const tab = window.open('', '_blank');
      try {
        const exported = await api.op<{ url: string }>('report.export', { project: project?.id, run: sheetRun });
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
    <Link to="/library" className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-14 text-ink no-underline hover:bg-hover"><Icon name="nav/library" />产品库</Link>
    <span className="mx-1 h-5 w-px bg-control" />
    <Menu trigger={
      <button type="button" className="flex h-8 max-w-96 items-center gap-2 rounded-full px-3 text-14 text-ink transition-colors duration-fast ease-std hover:bg-hover data-[popup-open]:bg-hover">
        <span className="truncate">{project?.name ?? '选择工程'}</span>
        <Icon name="action/chevrons-up-down" className="size-4 text-ink-2" />
      </button>}>
      {projects.map(item => <MenuItem key={item.id} checked={item.id === project?.id} onSelect={() => onOpenProject(item.id)}>{item.name}</MenuItem>)}
    </Menu>
    <div className="flex-1" />
    <ToolButton icon="action/undo" label="撤销上一次改动（Ctrl+Z）" disabled={!canUndo} onClick={onUndo} />
    <ToolButton icon="action/redo" label="重做（Ctrl+Y）" disabled={!canRedo} onClick={onRedo} />
    <ToolButton icon="nav/theme" label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle} />
    {/* One copper button: the next step. */}
    {next.kind === 'sheet'
      ? <Button variant="primary" icon="result/report" busy={sheet.isPending} onClick={() => sheet.mutate()}>出计算书</Button>
      : <>
        <Button icon="result/report" disabled={!sheetRun} busy={sheet.isPending} onClick={() => sheet.mutate()}>计算书</Button>
        <Button variant="primary" icon={next.icon} busy={next.busy} disabled={next.disabled} onClick={next.onClick}>{next.label}</Button>
      </>}
  </header>;
}
