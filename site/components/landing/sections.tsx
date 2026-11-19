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
      <span className="z-10 flex shrink-0 items-center border-r border-fd-foreground/60 bg-fd-background px-3">依据标准</span>
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
    text: '依据 IEC 60287 计算稳态载流量，支持 GB 50217 校正与热网络交叉校核。',
    points: ['直埋、排管与回填敷设，多回路互热', '应急负荷与交叉热源降额', '逐项输出损耗、热阻与适用范围说明'],
    href: '/docs/methods/iec-60287/',
    cta: '计算方法与依据',
  },
  {
    title: '电缆设计',
    text: '由结构数据生成型号，完成标准核对、电气参数计算与技术文件输出。',
    points: ['厂家结构表与 PDF 技术资料导入', '结构尺寸与导体电阻合规核对', '电气参数、短路容量与产品规格书'],
    href: '/docs/quickstart/factory/',
    cta: '制造企业快速入门',
  },
  {
    title: '电缆仿真',
    text: '有限元稳态与暂态热场、电热耦合分析，由超算集群求解并与标准计算对照。',
    points: ['稳态热场，阶跃与负荷曲线暂态温升', '电热耦合与金属护套损耗', '网格收敛性证据随结果归档'],
    href: '/docs/quickstart/research/',
    cta: '科研院所快速入门',
  },
];

export function CoreLines() {
  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-20 md:pb-24">
      <Reveal>
        <h2 className={heading}>
          三项核心功能，<span className="whitespace-nowrap text-brand">统一工程数据</span>。
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
  { Icon: Bot, title: '工程智能体（Agent）', text: '读取工程、研究与运行结果，梳理待办事项，生成字段级修改方案并支持试算验证。' },
  { Icon: Plug, title: '插件能力调用', text: '计算插件的能力以工具形式向智能体开放，调用路径与界面操作一致，同样受预检与适用范围约束。' },
  { Icon: FileSearch, title: '技术资料识别', text: '从厂家 PDF 资料中提取结构参数，保留页码与原文位置；提取结果作为候选项，经人工逐项核对后入库。' },
  { Icon: BrainCircuit, title: 'AI 载流量模型', text: '基于收敛的有限元结果训练的修正模型，输出载流量及 95% 预测区间；超出训练范围时拒绝计算，默认仅供参考。' },
  { Icon: KeyRound, title: '模型接入与数据安全', text: '支持接入 OpenAI 兼容的模型服务，密钥仅通过环境变量配置；扫描件默认离线识别，可配合内网部署的模型运行。' },
];

export function AiSection() {
  return (
    <section className="border-y border-fd-foreground/60 bg-fd-card">
      <div className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <Reveal>
          <p className="inline-flex items-center gap-2 border border-fd-foreground/70 bg-brand-soft px-2.5 py-0.5 font-mono text-xs">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            AI 深度融合
          </p>
          <h2 className={`${heading} mt-5`}>
            AI 贯穿<span className="whitespace-nowrap text-brand">录入、计算与校核</span>全流程。
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
            工程智能体可读取工程数据、调用计算插件并提出修改方案；数据保存、计算运行与文件签发均须人工确认。
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
  { value: '150', label: '独立复核算例' },
  { value: '0.35%', label: '最大载流量相对误差' },
  { value: '0.22 ℃', label: '最大导体温度偏差' },
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
            <span className="text-brand">电缆热模型</span>：以有限元为基准的代理模型。
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-fd-muted-foreground">
            无需运行有限元即可输出允许电流、导体温度及预测区间；输入超出验证范围时拒绝计算。
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
            误差以收敛的有限元结果为基准。现场验证与工程审批尚在进行，该模型目前尚未集成至 CableSimPro。
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
  { title: '离线安装', text: '安装包内置运行环境与全部依赖，经哈希校验后离线安装，无需联网。' },
  { title: '内网部署', text: '服务、工程库与文档站点均可部署于内网；升级前自动创建快照，支持版本回退。' },
  { title: '超算求解', text: '有限元与批量仿真作业提交至 Slurm 集群，设有核时上限，结果连同收敛性证据一并取回。' },
];

const docs = [
  { title: '快速入门（含视频）', text: '按制造企业与科研院所两条主线完成首次实操。', href: '/docs/quickstart/factory/' },
  { title: '安装与部署', text: '离线安装、参数配置、内网部署、超算与模型接入。', href: '/docs/install/' },
  { title: '使用指南', text: '型号库、载流量研究、仿真、交付文件与 Agent。', href: '/docs/guide/' },
  { title: '方法与依据', text: '各计算方法的原理、适用范围、验证等级与依据。', href: '/docs/methods/' },
  { title: '插件与开发', text: '插件清单字段、声明式示例、宿主契约与 REST 接口。', href: '/docs/develop/' },
  { title: '版本与适用边界', text: '版本更新说明、常见问题与当前已知限制。', href: '/docs/releases/' },
];

export function DeployAndDocs() {
  return (
    <section className="border-t border-fd-foreground/60">
      <div className="mx-auto max-w-[1400px] px-6 py-20 md:py-24">
        <Reveal>
          <h2 className={heading}>
            本地化部署，<span className="whitespace-nowrap text-brand">数据自主可控</span>。
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
          <h2 className={heading}>文档导航</h2>
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
