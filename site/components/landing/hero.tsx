'use client';

// 首屏：点阵背景、标题、入口按钮和可拖动的窗口；窗口可以在整个首屏范围内拖动。
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

import { primaryButton, secondaryButton } from './buttons';
import { DotField } from './dot-field';
import { Headline } from './headline';
import { HeroDesktop } from './hero-desktop';

export function Hero() {
  const area = useRef<HTMLElement>(null);
  return (
    <section ref={area} className="relative overflow-hidden">
      <DotField className="pointer-events-none absolute inset-0 h-full w-full text-fd-foreground/45 [mask-image:radial-gradient(80%_90%_at_68%_45%,#000,transparent)]" />
      <div className="relative mx-auto grid max-w-[1400px] items-center gap-12 px-6 pb-14 pt-12 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-10">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 border border-fd-foreground/70 bg-fd-card px-2.5 py-0.5 font-mono text-xs">
            <span className="size-1.5 rotate-45 bg-brand" />
            电缆设计与载流量计算平台
          </p>
          <Headline />
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fd-muted-foreground">
            依据 IEC 60287 与国家标准完成电缆结构设计、载流量计算与有限元热仿真，每项结果均记录输入数据、计算方法与版本。
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/docs/quickstart/factory/"
              className={primaryButton}
            >
              制造企业快速入门
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs/quickstart/research/"
              className={secondaryButton}
            >
              科研院所快速入门
            </Link>
            <Link
              href="/docs/methods/iec-60287/"
              className="group inline-flex items-center gap-1 px-1 py-2.5 text-[15px] underline decoration-fd-foreground/30 underline-offset-[6px] transition hover:decoration-brand"
            >
              计算方法与依据
              <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <HeroDesktop area={area} />
      </div>
    </section>
  );
}
