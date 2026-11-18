import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import catalog from '@/.generated/plugins.json';
import { primaryButton, secondaryButton } from '@/components/landing/buttons';
import { Hero } from '@/components/landing/hero';
import { CountUp, PixelWordmark, Reveal } from '@/components/landing/motion-bits';
import { RulerBar } from '@/components/landing/ruler-bar';
import { ScreenshotTabs } from '@/components/landing/screenshot-tabs';
import { SourceChain } from '@/components/landing/source-chain';
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
  '厂家结构表直接导入，尺寸和电阻按产品标准逐项核对。',
  'IEC 60287 算载流量，有限元上超算，两边结果互相对照。',
  '数据不够就停下来告诉你缺什么，不拿默认值凑数。',
];

const shots = [
  { label: '结构表导入', src: importMapping, alt: '结构表导入：列映射' },
  { label: '载流量研究', src: resultBase, alt: '载流量研究：敷设截面、工况输入与允许电流' },
  { label: '型号载流量表', src: typeRating, alt: '型号载流量表' },
  { label: '规格书', src: specPdf, alt: '规格书 PDF 中的载流量表页' },
  { label: '运行对比', src: compare, alt: '两次运行的对比' },
];

// 数字在构建时从插件清单（plugins/*/plugin.json）统计，不手写
const pluginList = catalog.plugins as unknown as { capabilities: { validation: { cases: unknown[] } }[] }[];
let capabilityCount = 0;
let caseCount = 0;
for (const plugin of pluginList) {
  capabilityCount += plugin.capabilities.length;
  for (const capability of plugin.capabilities) caseCount += capability.validation.cases.length;
}
const stats = [
  { value: pluginList.length, label: '第一方插件' },
  { value: capabilityCount, label: '计算与核对能力' },
  { value: caseCount, label: '核对算例' },
];

export default function HomePage() {
  return (
    <main className="w-full overflow-x-clip">
      <Hero />
      <RulerBar sections={sections} />

      {/* 是什么 */}
      <section className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <Reveal>
          <h2 className="font-display text-[34px] leading-snug text-balance sm:text-[46px]">
            给<span className="whitespace-nowrap text-brand">电缆厂技术部</span>和
            <span className="whitespace-nowrap text-brand">研究院</span>的<span className="whitespace-nowrap">电缆计算工作台。</span>
          </h2>
          <ul className="mt-8 space-y-3 text-base text-fd-foreground/85">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span className="mt-[10px] size-1.5 shrink-0 rotate-45 bg-brand" />
                {point}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]" delay={0.1}>
          <ScreenshotTabs shots={shots} />
          <SourceChain />
        </Reveal>
      </section>

      {/* 插件与核对：反色色带 */}
      <section className="border-y border-fd-foreground/60 bg-fd-foreground text-fd-background">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:items-end">
          <Reveal>
            <h2 className="font-display text-[34px] leading-snug sm:text-[44px]">
              算法全在<span className="text-brand-invert">插件</span>里，
              <br />
              逐个封签，逐个核对。
            </h2>
          </Reveal>
          <Reveal className="grid grid-cols-3 border border-fd-background/25" delay={0.1}>
            {stats.map((item, index) => (
              <div key={item.label} className={index > 0 ? 'border-l border-fd-background/25 px-4 py-6 sm:px-6' : 'px-4 py-6 sm:px-6'}>
                <CountUp value={item.value} className="font-pixel text-5xl tabular-nums text-brand-invert sm:text-7xl" />
                <p className="mt-3 text-xs text-balance text-fd-background/70 sm:text-sm">{item.label}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 收尾 */}
      <section className="mx-auto max-w-[1400px] px-6 pb-6 pt-20 text-center md:pt-24">
        <Reveal>
          <h2 className="font-display text-[34px] leading-snug text-balance sm:text-[46px]">
            <span className="whitespace-nowrap">挑一条工作线，</span>
            <span className="whitespace-nowrap">照着走一遍。</span>
          </h2>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <Link href="/docs/quickstart/factory/" className={primaryButton}>
              电缆厂：结构表到规格书
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs/quickstart/research/" className={secondaryButton}>
              研究院：工程到计算书
            </Link>
          </div>
        </Reveal>
      </section>
      <div className="mt-10 overflow-hidden pb-4">
        <PixelWordmark text="CableSimPro" />
      </div>
    </main>
  );
}
