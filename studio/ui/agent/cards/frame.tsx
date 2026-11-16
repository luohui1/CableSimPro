// What every result card has in common: a title, its content, and the button that takes the object to the workbench.
import { useRouter } from '@tanstack/react-router';
import { ArrowUpRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function OpenInWorkbench({ href, label = '在工作台打开' }: { href: string; label?: string }) {
  const router = useRouter();
  return <Button variant="outline" size="sm" onClick={() => router.history.push(href)}>{label}<ArrowUpRightIcon data-icon="inline-end" /></Button>;
}

export function CardFrame({ title, aside, href, children, className }: { title: ReactNode; aside?: ReactNode; href?: string; children: ReactNode; className?: string }) {
  return <section className={cn('bg-card flex flex-col overflow-hidden rounded-xl border', className)}>
    <header className="flex min-h-11 items-center gap-3 border-b px-4 py-2">
      <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
      {aside}
      {href && <OpenInWorkbench href={href} />}
    </header>
    <div className="p-4">{children}</div>
  </section>;
}
