// 取自 Magic UI（https://magicui.design，MIT 许可，Copyright (c) Magic UI），许可全文见 site/THIRD_PARTY_NOTICES.md。
// 改动：按钮换成站内链接，图标换成 lucide，颜色换成 Fumadocs 主题色，链接可省略。
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface BentoGridProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
  className?: string;
}

interface BentoCardProps extends ComponentPropsWithoutRef<'div'> {
  name: string;
  className?: string;
  background: ReactNode;
  Icon: ElementType;
  description: string;
  href?: string;
  cta?: string;
}

export function BentoGrid({ children, className, ...props }: BentoGridProps) {
  return (
    <div className={cn('grid w-full auto-rows-[22rem] grid-cols-3 gap-4', className)} {...props}>
      {children}
    </div>
  );
}

function CardLink({ href, cta }: { href: string; cta: string }) {
  return (
    <Link
      href={href}
      className="pointer-events-auto inline-flex items-center gap-1.5 text-sm font-medium text-fd-foreground hover:text-brand"
    >
      {cta}
      <ArrowRight className="size-4" />
    </Link>
  );
}

export function BentoCard({ name, className, background, Icon, description, href, cta, ...props }: BentoCardProps) {
  return (
    <div
      className={cn(
        'group relative col-span-3 flex flex-col justify-between overflow-hidden rounded-xl',
        'bg-fd-card [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]',
        'transform-gpu dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset] dark:[border:1px_solid_rgba(255,255,255,.1)]',
        className,
      )}
      {...props}
    >
      <div>{background}</div>
      <div className="p-6">
        <div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1.5 transition-all duration-300 lg:group-hover:-translate-y-8">
          <Icon className="mb-1 size-9 origin-left transform-gpu text-fd-foreground/80 transition-all duration-300 ease-in-out group-hover:scale-75" />
          <h3 className="text-xl font-semibold">{name}</h3>
          <p className="max-w-lg text-fd-muted-foreground">{description}</p>
        </div>
        {href && cta && (
          <div className="mt-3 flex lg:hidden">
            <CardLink href={href} cta={cta} />
          </div>
        )}
      </div>
      {href && cta && (
        <div className="pointer-events-none absolute bottom-0 hidden w-full translate-y-10 transform-gpu flex-row items-center px-6 pb-5 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 lg:flex">
          <CardLink href={href} cta={cta} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-black/[.03] group-hover:dark:bg-neutral-800/10" />
    </div>
  );
}
