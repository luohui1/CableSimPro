import { Link } from '@tanstack/react-router';
import { ProductIcon as Icon, ToolButton } from './product-controls';
import { Mark } from './icon';
import { useTheme } from '@/state/theme';

export function LibraryHeader() {
  const { theme, toggle } = useTheme();
  return <header className="library-header">
    <Link to="/library" aria-label="Cable Studio 产品库" className="library-brand"><Mark /><span className="hidden sm:inline">Cable Studio</span></Link>
    <nav aria-label="工作区" className="library-workspaces">
      <Link to="/library" aria-current="page" className="is-current"><Icon name="nav/library" />产品库</Link>
      <Link to="/workbench"><Icon name="object/section" />断面工作台</Link>
    </nav>
    <div className="flex-1" />
    <ToolButton icon={theme === 'light' ? 'moon' : 'sun'} label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle} />
  </header>;
}
