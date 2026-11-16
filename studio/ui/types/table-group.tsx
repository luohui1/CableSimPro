// A titled group whose body is a table running edge to edge, as PropertyGroup is for a list of properties.
import type { ReactNode } from 'react';

export function TableGroup({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <section className="border-b border-line last:border-b-0">
    <header className="flex min-h-11 items-center justify-between gap-3 px-4">
      <h3 className="m-0 text-h3 text-ink">{title}</h3>
      {aside}
    </header>
    {children}
  </section>;
}
