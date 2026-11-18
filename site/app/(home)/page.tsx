import { ArrowRight, Bot, Check, Cpu, Gauge, History, PencilRuler, ShieldCheck, UserCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { TraceBeam } from '@/components/landing/trace-beam';
import { Glow } from '@/components/launchui/glow';
import { Mockup, MockupFrame } from '@/components/launchui/mockup';
import { AnimatedShinyText } from '@/components/magicui/animated-shiny-text';
import { AuroraText } from '@/components/magicui/aurora-text';
import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid';
import { BorderBeam } from '@/components/magicui/border-beam';
import { AnimatedGridPattern } from '@/components/magicui/animated-grid-pattern';
import { Marquee } from '@/components/magicui/marquee';
import heroShot from '@/src/assets/screenshots/research/result-base.webp';
import ratingShot from '@/src/assets/screenshots/research/result-changed.webp';
import designShot from '@/src/assets/screenshots/factory/type-rating-table.webp';

// 插件清单（plugins/*/plugin.json）里实际引用的标准。
const standards = [
  'IEC 60287-1-1',
  'IEC 60287-2-1',
  'IEC 60287-3-3',
  'IEC 60853-2',
  'IEC 60949',
  'CIGRE TB 880',
  'GB 50217',
  'GB/T 12706.2',
  'GB/T 11017.1',
  'GB/T 3956',
];

const agentSteps = ['读取工程与运行记录', '整理待办', '起草修改方案', '调用插件试算', '等你确认后保存'];

const primaryButton =
  'inline-flex items-center gap-2 rounded-full bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90';
const secondaryButton =
  'inline-flex items-center gap-2 rounded-full border bg-fd-card/80 px-6 py-3 text-sm font-medium backdrop-blur transition hover:bg-fd-accent';

function Shot({ src, className }: { src: typeof heroShot; className?: string }) {
  return (
    <Image
      src={src}
      alt=""
      className={`absolute max-w-none rounded-lg border shadow-xl transition-transform duration-500 ease-out group-hover:scale-[1.03] ${className ?? ''}`}
    />
  );
}

export default function HomePage() {
  return (
    <main className="relative w-full overflow-x-clip">
      {/* 首屏 */}
      <section className="relative px-6 pt-12 sm:pt-16 [mask-image:linear-gradient(to_top,transparent,#000_22%)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-brand)_22%,transparent),transparent_65%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-7 text-center sm:gap-9">
          <Link
            href="/docs/"
            className="animate-appear group rounded-full border border-black/5 bg-fd-secondary/80 text-sm opacity-0 transition hover:bg-fd-accent dark:border-white/10"
          >
            <AnimatedShinyText className="inline-flex items-center gap-1.5 px-4 py-1.5">
              给电缆厂技术部和研究院
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </AnimatedShinyText>
          </Link>
          <h1 className="animate-appear text-6xl font-semibold leading-[1.1] tracking-tight opacity-0 [animation-delay:100ms] sm:text-7xl md:text-8xl">
            <span className="inline-block bg-linear-to-r from-fd-foreground to-fd-foreground bg-clip-text text-transparent dark:to-fd-muted-foreground">
              电缆计算
            </span>
            <br />
            <AuroraText colors={['var(--aurora-1)', 'var(--aurora-2)', 'var(--aurora-3)', 'var(--aurora-2)']} speed={0.8}>
              有据可查
            </AuroraText>
          </h1>
          <p className="animate-appear max-w-xl text-lg text-balance text-fd-muted-foreground opacity-0 [animation-delay:250ms] sm:text-xl">
            从结构表到规格书，每个结果都追得到输入、方法和版本。
          </p>
          <div className="animate-appear flex flex-wrap justify-center gap-3 opacity-0 [animation-delay:400ms]">
            <Link href="/docs/quickstart/research/" className={primaryButton}>
              快速上手
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs/methods/iec-60287/" className={secondaryButton}>
              方法与依据
            </Link>
          </div>
          <div className="relative mt-2 w-full max-w-5xl pt-6 sm:mt-4">
            <MockupFrame className="animate-appear opacity-0 [animation-delay:700ms]">
              <Mockup className="w-full rounded-xl border-0 bg-fd-background/90">
                <Image src={heroShot} alt="载流量研究：敷设截面、工况输入与允许电流" className="w-full" priority />
              </Mockup>
              <BorderBeam size={220} duration={9} borderWidth={2} colorFrom="#E08A4C" colorTo="#00A6E4" />
            </MockupFrame>
            <Glow variant="top" className="animate-appear-zoom opacity-0 [animation-delay:1000ms]" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 pb-24">
        {/* 依据标准 */}
        <section className="mt-4">
          <p className="text-center text-sm text-fd-muted-foreground">插件依据的标准</p>
          <div className="relative mt-5">
            <Marquee pauseOnHover className="[--duration:36s] [--gap:0.75rem]">
              {standards.map((name) => (
                <span
                  key={name}
                  className="whitespace-nowrap rounded-full border bg-fd-card px-4 py-1.5 font-mono text-sm text-fd-foreground/80"
                >
                  {name}
                </span>
              ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1/6 bg-linear-to-r from-fd-background" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-1/6 bg-linear-to-l from-fd-background" />
          </div>
        </section>

        {/* 核心能力 */}
        <section className="mt-28">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">核心能力</h2>
          <BentoGrid className="mt-10 auto-rows-[24rem] lg:auto-rows-[22rem]">
            <BentoCard
              className="lg:col-span-2"
              Icon={Gauge}
              name="载流量计算"
              description="IEC 60287 稳态与 GB 50217 校正，缺数据就拒算。"
              href="/docs/methods/iec-60287/"
              cta="看方法与依据"
              background={
                <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_18%,transparent_45%)] lg:[mask-image:linear-gradient(to_bottom,#000_32%,transparent_60%)]">
                  <Shot src={ratingShot} className="top-0 left-0 w-[215%] -translate-x-[34.5%] -translate-y-[12%]" />
                </div>
              }
            />
            <BentoCard
              className="lg:col-span-1"
              Icon={Cpu}
              name="电缆仿真"
              description="有限元温度场，超算上批量运行。"
              background={
                <AnimatedGridPattern
                  numSquares={28}
                  maxOpacity={0.35}
                  duration={3}
                  repeatDelay={1}
                  className="inset-x-0 inset-y-[-30%] h-[160%] skew-y-12 text-[#1E88D6] [mask-image:radial-gradient(320px_circle_at_top,white,transparent)]"
                />
              }
            />
            <BentoCard
              className="lg:col-span-1"
              Icon={Bot}
              name="Agent 协作"
              description="读工程、起草方案，最终由人批准。"
              background={
                <div className="absolute inset-x-0 top-0 h-[50%] [mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)] lg:h-[58%]">
                  <Marquee vertical pauseOnHover repeat={3} className="h-full px-6 [--duration:16s] [--gap:0.6rem]">
                    {agentSteps.map((step) => (
                      <div
                        key={step}
                        className="flex items-center gap-3 rounded-xl border bg-fd-background px-4 py-2.5 text-sm shadow-sm"
                      >
                        <Check className="size-4 shrink-0 text-brand" />
                        {step}
                      </div>
                    ))}
                  </Marquee>
                </div>
              }
            />
            <BentoCard
              className="lg:col-span-2"
              Icon={PencilRuler}
              name="电缆设计"
              description="导入厂家结构表，核对标准，生成载流量表和规格书。"
              href="/docs/quickstart/factory/"
              cta="电缆厂快速上手"
              background={
                <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_18%,transparent_45%)] lg:[mask-image:linear-gradient(to_bottom,#000_32%,transparent_60%)]">
                  <Shot src={designShot} className="top-5 left-0 w-[160%] -translate-x-[15%]" />
                </div>
              }
            />
          </BentoGrid>
        </section>

        {/* 可追溯 */}
        <section className="mt-28">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">每个结果，都能追到源头</h2>
          <div className="mt-10">
            <TraceBeam />
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
            {[
              { Icon: ShieldCheck, text: '缺数据就拒算' },
              { Icon: History, text: '带输入快照与方法版本' },
              { Icon: UserCheck, text: '签发由人确认' },
            ].map(({ Icon, text }) => (
              <li key={text} className="inline-flex items-center gap-2 rounded-full border bg-fd-card px-4 py-2">
                <Icon className="size-4 text-brand" />
                {text}
              </li>
            ))}
          </ul>
        </section>

        {/* 行动 */}
        <section className="group relative mt-28 overflow-hidden rounded-3xl border bg-fd-card/40 px-6 py-20 text-center">
          <h2 className="relative z-10 text-2xl font-semibold tracking-tight sm:text-4xl">从一条真实工作线开始</h2>
          <div className="relative z-10 mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/docs/quickstart/factory/" className={primaryButton}>
              电缆厂：结构表到规格书
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs/quickstart/research/" className={secondaryButton}>
              研究院：工程到计算书
            </Link>
          </div>
          <div className="absolute inset-0 translate-y-8 opacity-80 transition-all duration-500 ease-in-out group-hover:-translate-y-4 group-hover:opacity-100">
            <Glow variant="bottom" />
          </div>
        </section>
      </div>
    </main>
  );
}
