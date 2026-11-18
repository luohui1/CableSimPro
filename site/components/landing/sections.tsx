// 首页的内容区块（服务端渲染）：标准滚动条、三条主线、AI、热模型预告、插件墙、部署与文档目录。
import { ArrowRight, Bot, BrainCircuit, FileSearch, KeyRound, Plug } from 'lucide-react';
import Link from 'next/link';

import { AgentDemo } from './agent-demo';
import { Reveal } from './motion-bits';
import { ThermalMatrix } from './thermal-matrix';

// 插件清单（plugins/*/plugin.json）里实际引用的标准
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

export function StandardsTicker() {
  return (
    <div className="group flex items-stretch overflow-hidden border-b border-fd-foreground/60 font-mono text-[13px]">
      <span className="z-10 flex shrink-0 items-center border-r border-fd-foreground/60 bg-fd-background px-3">依据</span>
      {[0, 1].map((copy) => (
        <ul
          key={copy}
          aria-hidden={copy === 1}
          className="ticker flex shrink-0 items-center gap-10 py-2.5 pr-10 group-hover:[animation-play-state:paused]"
        >
          {standards.map((name) => (
            <li key={name} className="flex items-center gap-10 whitespace-nowrap">
              <span className="size-1.5 rotate-45 bg-brand" />
              {name}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

const heading = 'font-display text-[34px] leading-snug text-balance sm:text-[46px]';
const card =
  'group flex h-full flex-col border border-fd-foreground/70 bg-fd-card p-6 shadow-[4px_4px_0_0_rgb(28_26_23/0.1)] transition-[transform,box-shadow] duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_var(--color-brand)] dark:shadow-[4px_4px_0_0_rgb(0_0_0/0.45)]';

const lines = [
  {
    title: '载流量计算',
    text: 'IEC 60287 逐项算损耗与热阻，GB 50217 校正，热网络交叉校核。',
    points: ['直埋、排管、回填，多回路互热', '应急额定与交叉热源降额', '结果注明口径，缺项逐条指出'],
    href: '/docs/methods/iec-60287/',
    cta: '看方法与依据',
  },
  {
    title: '电缆设计',
    text: '导入结构表，核对尺寸，算电气参数，出载流量表和规格书。',
    points: ['厂家结构表与 PDF 资料导入', '按产品标准核对尺寸与电阻', '电气参数、短路容量、规格书'],
    href: '/docs/quickstart/factory/',
    cta: '电缆厂上手',
  },
  {
    title: '电缆仿真',
    text: '有限元温度场、暂态和电热耦合，提交超算，和 IEC 结果对照。',
    points: ['稳态热场，阶跃与负荷曲线暂态', '电热耦合与护套损耗', '网格收敛证据随结果保存'],
    href: '/docs/quickstart/research/',
    cta: '研究院上手',
  },
];

export function CoreLines() {
  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-20 md:pb-24">
      <Reveal>
        <h2 className={heading}>
          三条主线，<span className="text-brand">一个工程</span>。
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {lines.map((line, index) => (
          <Reveal key={line.title} delay={index * 0.08}>
            <article className={card}>
              <p className="font-pixel text-4xl text-fd-foreground/25 transition-colors group-hover:text-brand">0{index + 1}</p>
              <h3 className="mt-4 font-display text-[28px] leading-tight">{line.title}</h3>
              <p className="mt-3 leading-relaxed text-fd-muted-foreground">{line.text}</p>
              <ul className="mt-5 space-y-2 text-[15px]">
                {line.points.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-[9px] size-1.5 shrink-0 rotate-45 bg-brand" />
                    {point}
                  </li>
                ))}
              </ul>
              <Link
                href={line.href}
                className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[15px] font-medium underline decoration-fd-foreground/30 underline-offset-[6px] transition hover:decoration-brand"
              >
                {line.cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const abilities = [
  { Icon: Bot, title: 'Agent 协作', text: '读工程、理待办、解释结果，起草字段级的修改方案，先试算再给你看。' },
  { Icon: Plug, title: '插件即工具', text: '插件里的计算能力，Agent 都能当工具调用，走的是和界面按钮同一套接口。' },
  { Icon: FileSearch, title: '资料识别', text: '厂家 PDF 逐页识别参数，保留页码和原文位置；结果只是候选，逐项核对后才入库。' },
  { Icon: BrainCircuit, title: 'AI 额定模型', text: '用收敛的有限元结果训练的修正模型，给出载流量和 95% 预测区间；超出训练范围就拒算，默认只作参考。' },
  { Icon: KeyRound, title: '模型你定', text: '接 OpenAI 兼容的模型服务，密钥只放环境变量；扫描件默认离线识别，数据可以不出内网。' },
];

export function AiSection() {
  return (
    <section className="border-y border-fd-foreground/60 bg-fd-card">
      <div className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <Reveal>
          <p className="inline-flex items-center gap-2 border border-fd-foreground/70 bg-brand-soft px-2.5 py-0.5 font-mono text-xs">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            AI 原生
          </p>
          <h2 className={`${heading} mt-5`}>
            AI 不是外挂，是坐在旁边的<span className="text-brand">同事</span>。
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
            它读得懂工程，也守规矩：只提方案，批准永远在你手里。
          </p>
        </Reveal>
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Reveal>
            <AgentDemo />
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="border border-fd-foreground/70 bg-fd-background">
              {abilities.map(({ Icon, title, text }, index) => (
                <li
                  key={title}
                  className={`group flex gap-4 px-5 py-4 transition-colors hover:bg-brand-soft/60 ${index > 0 ? 'border-t border-fd-foreground/25' : ''}`}
                >
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-fd-foreground/70 bg-fd-card transition-colors group-hover:bg-brand group-hover:text-white dark:group-hover:text-fd-background">
                    <Icon className="size-[18px]" />
                  </span>
                  <span>
                    <span className="block font-semibold">{title}</span>
                    <span className="mt-1 block text-[15px] leading-relaxed text-fd-muted-foreground">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const thermalFacts = [
  { value: '5 × 5', label: '单芯结构 × 敷设方式' },
  { value: '150', label: '个独立复核算例' },
  { value: '0.35%', label: '最大载流量误差' },
  { value: '0.22 ℃', label: '最大导体温差' },
];

export function ThermalSection() {
  return (
    <section className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Reveal>
          <p className="inline-block -rotate-2 border-2 border-brand px-2.5 py-0.5 font-mono text-xs font-medium tracking-widest text-brand">
            即将接入
          </p>
          <h2 className={`${heading} mt-5`}>
            下一步：<span className="text-brand">电缆热模型</span>。
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-fd-muted-foreground">
            不跑有限元，也能拿到允许电流、导体温度和预测区间；条件超出验证范围，直接拒算。
          </p>
          <dl className="mt-8 grid grid-cols-2 border border-fd-foreground/70">
            {thermalFacts.map((fact, index) => (
              <div
                key={fact.label}
                className={`px-4 py-4 ${index % 2 ? 'border-l border-fd-foreground/25' : ''} ${index > 1 ? 'border-t border-fd-foreground/25' : ''}`}
              >
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <span className="font-pixel text-3xl text-brand sm:text-4xl">{fact.value}</span>
                  <span className="mt-1.5 block text-sm text-fd-muted-foreground">{fact.label}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-fd-muted-foreground">
            误差参照的是收敛的有限元结果。现场精度和工程批准还在验证中，这个模型目前尚未接入 CableSimPro。
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <ThermalMatrix />
        </Reveal>
      </div>
    </section>
  );
}

export interface PluginTile {
  id: string;
  name: string;
  version: string;
  capabilities: number;
}

export function PluginWall({ plugins }: { plugins: PluginTile[] }) {
  return (
    <ul className="grid grid-cols-2 border-l border-t border-fd-background/25 md:grid-cols-3 lg:grid-cols-4">
      {plugins.map((plugin) => (
        <li
          key={plugin.id}
          className="group border-b border-r border-fd-background/25 px-4 py-4 transition-colors hover:bg-fd-background/10"
        >
          <p className="font-medium transition-colors group-hover:text-brand-invert">{plugin.name}</p>
          <p className="mt-1.5 flex justify-between font-mono text-xs text-fd-background/60">
            <span>{plugin.capabilities} 项能力</span>
            <span>v{plugin.version}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const deploy = [
  { title: '离线安装包', text: '安装包自带运行时和依赖，按哈希离线安装，全程不联网。' },
  { title: '内网部署', text: '服务、工程库和这份文档都能放在内网；升级前自动快照，可以回退。' },
  { title: '超算作业', text: '有限元和批量仿真提交到 Slurm 集群，核时有上限，结果带着收敛证据取回。' },
];

const docs = [
  { title: '快速上手', text: '两条真实工作线，照着做一遍。', href: '/docs/quickstart/factory/' },
  { title: '安装与部署', text: '离线安装、配置、内网、超算、模型。', href: '/docs/' },
  { title: '使用指南', text: '型号、研究、仿真、交付与 Agent。', href: '/docs/' },
  { title: '方法与依据', text: '每个方法的原理、范围与验证。', href: '/docs/methods/iec-60287/' },
  { title: '插件与开发', text: '清单字段、示例与宿主接口。', href: '/docs/' },
  { title: '版本说明', text: '更新内容与已知限制。', href: '/docs/' },
];

export function DeployAndDocs() {
  return (
    <section className="border-t border-fd-foreground/60">
      <div className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <Reveal>
          <h2 className={heading}>
            装在<span className="text-brand">你自己的机器</span>上。
          </h2>
        </Reveal>
        <div className="mt-10 grid border border-fd-foreground/70 md:grid-cols-3">
          {deploy.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.06} className={index > 0 ? 'border-t border-fd-foreground/25 md:border-l md:border-t-0' : ''}>
              <div className="h-full px-6 py-6">
                <p className="font-pixel text-sm text-brand">0{index + 1}</p>
                <h3 className="mt-2 font-display text-2xl">{item.title}</h3>
                <p className="mt-2.5 leading-relaxed text-fd-muted-foreground">{item.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-20">
          <h2 className={heading}>文档里有什么</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((item, index) => (
            <Reveal key={item.title} delay={(index % 3) * 0.06}>
              <Link
                href={item.href}
                className="group flex h-full items-start justify-between gap-4 border border-fd-foreground/70 bg-fd-card px-5 py-4 transition-colors hover:bg-brand-soft"
              >
                <span>
                  <span className="block font-display text-xl">{item.title}</span>
                  <span className="mt-1 block text-[15px] text-fd-muted-foreground">{item.text}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 transition-transform group-hover:translate-x-1" />
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
