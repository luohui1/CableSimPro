'use client';

// 实机演示视频播放器（按需加载）：初始只渲染轻量 WebP 封面（< 90 KB），点击播放才建立 <video> 请求并加载中文字幕。
import { ArrowUpRight, Play } from 'lucide-react';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import agentCover from '@/src/assets/screenshots/videos/agent-cover.webp';
import factoryCover from '@/src/assets/screenshots/videos/factory-cover.webp';
import overviewCover from '@/src/assets/screenshots/videos/overview-cover.webp';
import researchCover from '@/src/assets/screenshots/videos/research-cover.webp';

import { CornerMarks, Window, windowFrame } from './landing/window';

export type VideoKind = 'overview' | 'factory' | 'research' | 'agent';

interface VideoSpec {
  kind: VideoKind;
  num: string;
  tabLabel: string;
  windowTitle: string;
  title: string;
  duration: string;
  summary: string;
  slug: string;
  poster: StaticImageData;
  docHref: string;
  docLabel: string;
}

export const VIDEOS: Record<VideoKind, VideoSpec> = {
  overview: {
    kind: 'overview',
    num: '01',
    tabLabel: '平台全链路总览',
    windowTitle: 'demo / product-overview.mp4',
    title: '平台实机总览：型号设计、载流量校核、Agent 协同与电缆热模型',
    duration: '01:42',
    summary: '串联厂家 Excel 结构表入库、全系列核对与规格书、110 kV 直埋敏感性对比、Agent 受控提案审阅及 5×5 电缆热模型验证矩阵。',
    slug: 'product-overview',
    poster: overviewCover,
    docHref: '/docs/',
    docLabel: '进入文档总览',
  },
  factory: {
    kind: 'factory',
    num: '02',
    tabLabel: '制造企业快速上手',
    windowTitle: 'quickstart / factory-walkthrough.mp4',
    title: '制造企业实操：从厂家 Excel 结构表到正式产品规格书',
    duration: '01:39',
    summary: '五步向导导入 YJV22 结构表、逐项核查原表行号、11 个规格批量国标核对与载流量计算、3×240 缺项明确拦截及 3×300 多章节规格书导出。',
    slug: 'quickstart-factory',
    poster: factoryCover,
    docHref: '/docs/quickstart/factory/',
    docLabel: '阅读《电缆厂：从结构表到正式规格书》',
  },
  research: {
    kind: 'research',
    num: '03',
    tabLabel: '科研院所快速上手',
    windowTitle: 'quickstart / research-walkthrough.mp4',
    title: '科研院所实操：110 kV 品字形直埋载流量校核、敏感性对比与计算书',
    duration: '01:43',
    summary: '锁定型号版本新建研究，预检求解 944.8 A，修改土壤热阻率至 1.5 K·m/W 重算 801.1 A，双列核对 SI 输入差异并在线预览下载 PDF 计算书。',
    slug: 'quickstart-research',
    poster: researchCover,
    docHref: '/docs/quickstart/research/',
    docLabel: '阅读《研究院：从新建工程到计算书》',
  },
  agent: {
    kind: 'agent',
    num: '04',
    tabLabel: 'AI 工程智能体实操',
    windowTitle: 'guide / agent-walkthrough.mp4',
    title: '工程智能体（Agent）实操：只读快照调取、待审提案卡与四级签栏计算书',
    duration: '01:14',
    summary: '演示只读工具调取保存运行 748.3 A、“待你审阅”字段级修改卡片、拒绝原因抽屉、人工单步接受重算及带独立追溯页的正式 PDF 计算书。',
    slug: 'guide-agent',
    poster: agentCover,
    docHref: '/docs/guide/agent/',
    docLabel: '阅读《Agent 的用法和边界》',
  },
};

const ORDER: VideoKind[] = ['overview', 'factory', 'research', 'agent'];

function assetUrl(subpath: string) {
  const base = (process.env.NEXT_PUBLIC_DOCS_BASE ?? '').replace(/\/+$/, '');
  return `${base}${subpath}`;
}

function PlayerSurface({ spec }: { spec: VideoSpec }) {
  const [playing, setPlaying] = useState(false);
  const mp4Url = assetUrl(`/videos/${spec.slug}.mp4`);
  const vttUrl = assetUrl(`/videos/${spec.slug}.vtt`);

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-fd-muted">
      {playing ? (
        <video
          key={spec.slug}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="block h-full w-full bg-black object-contain"
        >
          <source src={mp4Url} type="video/mp4" />
          <track kind="subtitles" srcLang="zh-CN" label="简体中文" src={vttUrl} default />
        </video>
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`播放实操视频：${spec.title}（时长 ${spec.duration}）`}
          className="group relative block h-full w-full cursor-pointer text-left focus-visible:outline-none"
        >
          <Image
            src={spec.poster}
            alt={spec.title}
            className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent transition-opacity group-hover:opacity-90"
          />
          <span className="absolute inset-0 flex items-center justify-center p-4">
            <span className="inline-flex items-center gap-3 border border-fd-foreground bg-brand px-5 py-3 font-medium text-white shadow-[5px_5px_0_0_var(--color-fd-foreground)] transition-[transform,box-shadow] duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-[7px_7px_0_0_var(--color-fd-foreground)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">
              <Play className="size-4 fill-current" />
              <span>播放实机演示</span>
              <span className="border-l border-white/35 pl-2.5 font-pixel text-sm tracking-wider">{spec.duration}</span>
            </span>
          </span>
          <span className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <span className="border border-fd-foreground/80 bg-fd-card/95 px-2.5 py-1 text-fd-foreground">
              {spec.title}
            </span>
            <span className="border border-fd-foreground/80 bg-fd-background/95 px-2 py-1 text-fd-muted-foreground">
              1080p · 中文配音与字幕 · 按需加载
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

/** 文档正文内嵌播放器（MDX 中通过 <VideoPlayer kind="..." /> 调用） */
export function VideoPlayer({ kind }: { kind: VideoKind }) {
  const spec = VIDEOS[kind] ?? VIDEOS.overview;
  return (
    <div className="not-prose my-7">
      <Window title={spec.windowTitle}>
        <PlayerSurface spec={spec} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-fd-foreground/70 bg-fd-background px-3.5 py-2 text-xs text-fd-muted-foreground">
          <span>{spec.summary}</span>
          <span className="shrink-0 font-mono">时长 {spec.duration}</span>
        </div>
      </Window>
    </div>
  );
}

/** 首页四合一实机演示切换台 */
export function VideoShowcase() {
  const [active, setActive] = useState<VideoKind>('overview');
  const current = VIDEOS[active];

  return (
    <div className={cn(windowFrame, 'relative')}>
      <CornerMarks />
      <div
        role="tablist"
        aria-label="实机演示视频切换"
        className="flex items-stretch overflow-x-auto whitespace-nowrap border-b border-fd-foreground/70 bg-fd-background text-sm"
      >
        {ORDER.map((key) => {
          const item = VIDEOS[key];
          const selected = key === active;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(key)}
              className={cn(
                'flex items-center gap-2 border-r border-fd-foreground/70 px-4 py-2.5 transition-colors',
                selected
                  ? 'bg-brand-soft font-medium text-fd-foreground'
                  : 'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground',
              )}
            >
              <span className={cn('font-pixel text-sm', selected ? 'text-brand' : 'text-fd-foreground/45')}>
                {item.num}
              </span>
              <span>{item.tabLabel}</span>
              <span className="font-mono text-xs text-fd-muted-foreground">{item.duration}</span>
            </button>
          );
        })}
        <span className="window-stripes mx-3 my-auto hidden h-2.5 flex-1 text-fd-foreground/30 lg:block" />
        <span className="my-auto hidden pr-3 font-mono text-xs text-fd-muted-foreground lg:block">
          {current.windowTitle}
        </span>
      </div>

      <PlayerSurface key={current.kind} spec={current} />

      <div className="flex flex-col justify-between gap-3 border-t border-fd-foreground/70 bg-fd-background px-4 py-3 text-sm sm:flex-row sm:items-center sm:px-5">
        <p className="text-fd-muted-foreground">{current.summary}</p>
        <Link
          href={current.docHref}
          className="group inline-flex shrink-0 items-center gap-1 font-medium text-fd-foreground underline decoration-fd-foreground/35 underline-offset-[5px] transition hover:decoration-brand"
        >
          {current.docLabel}
          <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
