// The repository's own icons (design/icons/<group>/<name>.svg): a 24 px grid, 1.5 px stroke, drawn in the text colour.
// Every icon on a kit part comes from here; lucide-react is used only inside components/ui.
import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

const sources = import.meta.glob('../../../design/icons/*/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Repository-owned SVG only: the markup never comes from a URL, a user or the server.
const ICONS: Record<string, string> = Object.fromEntries(Object.entries(sources).map(([path, svg]) => [
  path.split('/').slice(-2).join('/').replace('.svg', ''),
  svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, ''),
]));

/** `name` is group/name, for example `calc/ampacity`. Sizes: size-4 in text and buttons, size-5 in tiles. */
export function Icon({ name, className, ...props }: { name: string } & Omit<SVGProps<SVGSVGElement>, 'dangerouslySetInnerHTML'>) {
  const body = ICONS[name];
  if (!body) throw new Error(`缺少图标：${name}`);
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" data-icon={name} className={cn('size-4 shrink-0', className)} {...props} dangerouslySetInnerHTML={{ __html: body }} />;
}

/** The product mark: a cable in section. */
export function ProductMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn('size-6 shrink-0', className)}>
    <circle cx="12" cy="12" r="9" stroke="var(--text)" strokeWidth="2" />
    <circle cx="12" cy="12" r="5.75" stroke="var(--text-secondary)" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3" fill="var(--conductor)" />
  </svg>;
}

/** A spinning arc, for work in progress. Stops spinning when the system asks for less motion. */
export function Spinner({ className }: { className?: string }) {
  return <Icon name="status/spinner" className={cn('animate-spin motion-reduce:animate-none', className)} />;
}
