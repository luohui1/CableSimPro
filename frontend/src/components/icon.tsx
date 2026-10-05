import { cn } from '@/lib/cn';

const svgModules = import.meta.glob('../../../design/icons/*/*.svg', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

// Trusted, repository-owned SVG only; never accepts URL, user input or server markup.
const icons = Object.fromEntries(Object.entries(svgModules).map(([path, svg]) => [
  path.split('/').slice(-2).join('/').replace('.svg', ''), svg,
]));

export function Icon({ name, className }: { name: string; className?: string }) {
  if (!icons[name]) throw new Error(`缺少图标：${name}`);
  return <span aria-hidden="true" className={cn('icon', className)} dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
