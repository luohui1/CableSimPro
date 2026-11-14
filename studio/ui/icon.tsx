// The repository's own icon set (design/icons/<group>/<name>.svg), drawn on a 24 px grid with a 1.5 px stroke.
import type { SVGProps } from 'react';

const sources = import.meta.glob('../../design/icons/*/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Repository-owned SVG only: the markup never comes from a URL, a user or the server.
const icons = Object.fromEntries(Object.entries(sources).map(([path, svg]) => [
  path.split('/').slice(-2).join('/').replace('.svg', ''),
  svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, ''),
]));

export function Icon({ name, className = '', ...props }: { name: string } & SVGProps<SVGSVGElement>) {
  if (!icons[name]) throw new Error(`缺少图标：${name}`);
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" className={`icon ${className}`} {...props} dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}

/** The product mark: a cable cross-section. */
export function Mark({ size = 28 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="var(--text)" strokeWidth="2" />
    <circle cx="12" cy="12" r="5.75" stroke="var(--text-secondary)" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3" fill="var(--conductor)" />
  </svg>;
}
