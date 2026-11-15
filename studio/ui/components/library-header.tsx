import { Link } from '@tanstack/react-router';
import { ToolButton } from './button';
import { Icon, Mark } from './icon';
import { useTheme } from '@/state/theme';

export function LibraryHeader() {
  const { theme, toggle } = useTheme();
  return <header className="flex min-h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4 sm:gap-6">
    <Link to="/library" aria-label="Cable Studio 产品库" className="flex shrink-0 items-center gap-2 text-16 font-strong text-ink no-underline"><Mark /><span className="hidden sm:inline">Cable Studio</span></Link>
    <nav aria-label="工作区" className="flex h-12 items-stretch gap-5 text-14">
      <Link to="/library" className="flex items-center gap-2 border-b-2 border-copper font-strong text-copper no-underline"><Icon name="nav/library" />产品库</Link>
      <Link to="/workbench" className="flex items-center text-ink no-underline hover:text-copper">断面工作台</Link>
    </nav>
    <div className="flex-1" />
    <ToolButton icon="nav/theme" label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle} />
  </header>;
}
