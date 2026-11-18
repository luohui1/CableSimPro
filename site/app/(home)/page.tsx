import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { ScreenshotTabs } from '@/components/landing/screenshot-tabs';
import { CornerMarks, Window } from '@/components/landing/window';
import importMapping from '@/src/assets/screenshots/factory/import-mapping.webp';
import specPdf from '@/src/assets/screenshots/factory/spec-pdf.webp';
import typeRating from '@/src/assets/screenshots/factory/type-rating-table.webp';
import compare from '@/src/assets/screenshots/research/compare.webp';
import resultBase from '@/src/assets/screenshots/research/result-base.webp';

const sections = [
  { label: 'CableSimPro', href: '/docs/' },
  { label: '电缆厂上手', href: '/docs/quickstart/factory/' },
  { label: '研究院上手', href: '/docs/quickstart/research/' },
  { label: 'IEC 60287', href: '/docs/methods/iec-60287/' },
];

const points = [
  '导入厂家结构表，按产品标准核对尺寸与电阻。',
  'IEC 60287 载流量、有限元仿真和规格书，在一个工程里完成。',
  '缺数据就拒算，结果都追得到输入、方法和版本。',
];

const shots = [
  { label: '载流量研究', src: resultBase, alt: '载流量研究：敷设截面、工况输入与允许电流' },
  { label: '结构表导入', src: importMapping, alt: '结构表导入：列映射' },
  { label: '型号载流量表', src: typeRating, alt: '型号载流量表' },
  { label: '规格书', src: specPdf, alt: '规格书 PDF 中的载流量表页' },
  { label: '运行对比', src: compare, alt: '两次运行的对比' },
];

// 一个结果从输入到交付经过的环节，每一环都保存版本
const chain = ['厂家结构表', '型号版本', '载流量研究', '运行快照', '计算书 / 规格书'];

export default function HomePage() {
  return (
    <main className="w-full">
      {/* 首屏 */}
      <section className="mx-auto grid max-w-[1400px] items-center gap-14 px-6 pb-16 pt-16 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
        <div>
          {/* 字号按各断点的栏宽取，第二行九个字始终一行放下 */}
          <h1 className="text-[34px] font-normal leading-[1.25] tracking-[-0.01em] sm:text-5xl xl:text-[60px] 2xl:text-[68px]">
            <span className="text-brand">电缆计算</span>，
            <br />
            <span className="whitespace-nowrap">每一步都有据可查。</span>
          </h1>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/quickstart/factory/"
              className="inline-flex items-center gap-2 border border-fd-foreground bg-brand px-5 py-2.5 text-[15px] font-medium text-white transition hover:brightness-110 dark:text-fd-background"
            >
              电缆厂上手
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs/quickstart/research/"
              className="inline-flex items-center border border-fd-foreground/70 bg-fd-card px-5 py-2.5 text-[15px] transition hover:bg-fd-accent"
            >
              研究院上手
            </Link>
            <Link
              href="/docs/methods/iec-60287/"
              className="inline-flex items-center gap-1 px-2 py-2.5 text-[15px] underline decoration-fd-foreground/30 underline-offset-[6px] transition hover:decoration-fd-foreground"
            >
              方法与依据
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>

        <div className="relative mx-6 lg:mx-0 lg:mr-6">
          <CornerMarks />
          <Window title="直埋载流量 — CableSimPro">
            <div className="relative">
              <Image src={resultBase} alt="载流量研究：敷设截面、工况输入与允许电流" className="block w-full" priority />
              {/* 标注截图里的允许电流（数值取自截图本身） */}
              <span className="absolute left-[43.6%] top-[25.6%] h-[4.4%] w-[5.6%] border-[1.5px] border-brand" />
              <span className="absolute left-[46.4%] top-[calc(-26px-14px)] h-[calc(25.6%+40px)] w-px bg-brand" />
              <span className="absolute left-[46.4%] top-[calc(-26px-44px)] -translate-x-1/2 whitespace-nowrap bg-fd-foreground px-2.5 py-1 font-mono text-xs text-fd-background shadow-[3px_3px_0_0_var(--color-brand)]">
                IEC 60287 · 允许电流 944.8 A
              </span>
            </div>
          </Window>
        </div>
      </section>

      {/* 刻度尺与分区导航 */}
      <div className="ruler h-4 w-full border-b border-fd-foreground/60 text-fd-foreground/45" />
      <nav className="flex items-center justify-between gap-3 border-b border-fd-foreground/60 px-3 py-1.5">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs text-fd-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-brand" />
          就绪
        </span>
        <div className="flex min-w-0 overflow-x-auto whitespace-nowrap text-[13px]">
          {sections.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={
                index === 0
                  ? 'border border-fd-foreground/70 bg-brand-soft px-2.5 py-0.5'
                  : 'border border-l-0 border-fd-foreground/70 px-2.5 py-0.5 transition-colors hover:bg-fd-accent'
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* 是什么 */}
      <section className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <h2 className="text-3xl font-normal leading-snug tracking-[-0.01em] text-balance sm:text-[40px]">
          CableSimPro 是给<span className="text-brand">电缆厂技术部</span>和<span className="text-brand">研究院</span>
          用的电缆计算平台。
        </h2>
        <ul className="mt-8 space-y-3 text-[15px] text-fd-foreground/85">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand" />
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
          <ScreenshotTabs shots={shots} />
          <Window title="来源链" bodyClassName="flex flex-col items-center px-6 py-8">
            {chain.map((step, index) => (
              <div key={step} className="flex flex-col items-center">
                {index > 0 && <span className="h-7 w-px bg-fd-foreground/60" />}
                <span
                  className={
                    index === 0
                      ? 'border border-fd-foreground/70 bg-brand-soft px-4 py-1.5 font-mono text-sm'
                      : 'border border-fd-foreground/70 bg-fd-background px-4 py-1.5 font-mono text-sm'
                  }
                >
                  {step}
                </span>
              </div>
            ))}
            <p className="mt-8 text-center text-sm text-fd-muted-foreground">每一环都保存版本，结果可以追回源头。</p>
          </Window>
        </div>
      </section>
    </main>
  );
}
