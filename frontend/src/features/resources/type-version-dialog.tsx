import { useNavigate } from '@tanstack/react-router';
import { CreateTypeDialog } from '@/features/type/create-dialog';
import { TypeNavigationContext } from '@/features/type/navigation';
import '@/features/type/type.css';

export function TypeVersionDialog({ id, theme, onClose }: { id: string; theme: 'light' | 'dark'; onClose: () => void }) {
  const navigate = useNavigate();
  const go = (path: string) => { const target = new URL(path, window.location.origin); void navigate({ to: target.pathname, search: () => ({ ...Object.fromEntries(target.searchParams), theme }) }); };
  return <TypeNavigationContext.Provider value={{ location: { module: 'list', tab: '', theme }, navigate: go,
    onTheme: () => void navigate({ to: '.', search: (previous: Record<string, unknown>) => ({ ...previous, theme: theme === 'light' ? 'dark' : 'light' }) }) }}>
    <CreateTypeDialog open initialModelId={id} onClose={onClose} />
  </TypeNavigationContext.Provider>;
}
