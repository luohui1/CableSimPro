import { cn } from '@/lib/cn';
import type { SVGProps } from 'react';

const svgModules = import.meta.glob('../../../design/icons/*/*.svg', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

// Trusted, repository-owned SVG only; never accepts URL, user input or server markup.
const icons = Object.fromEntries(Object.entries(svgModules).map(([path, svg]) => [
  path.split('/').slice(-2).join('/').replace('.svg', ''), svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, ''),
]));

export function Icon({ name, className, ...props }: { name: string } & SVGProps<SVGSVGElement>) {
  if (!icons[name]) throw new Error(`缺少图标：${name}`);
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('icon', className)} {...props} dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
