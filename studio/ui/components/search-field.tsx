import { cn } from '@/lib/cn';
import { Icon } from './icon';

export function SearchField({ label, value, onChange, placeholder, className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return <div className={cn('flex h-9 min-w-0 items-center gap-2 rounded-field border border-control bg-panel px-3 focus-within:border-ink', className)}>
    <Icon name="action/search" className="text-ink-2" />
    <input type="search" aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}
      className="min-w-0 flex-1 bg-transparent text-14 text-ink outline-none placeholder:text-ink-2" />
  </div>;
}
