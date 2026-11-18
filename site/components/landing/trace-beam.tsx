'use client';

// 首页"可追溯"示意：三类输入经 CableSimPro 计算，得到三类交付文件；连线用 Magic UI 的 AnimatedBeam。
import { forwardRef, useRef, type ReactNode } from 'react';
import { BookCheck, FileSpreadsheet, FileText, Layers, NotebookText, Table2 } from 'lucide-react';

import { BrandMark } from '@/components/brand';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { cn } from '@/lib/cn';

const Node = forwardRef<HTMLDivElement, { className?: string; children: ReactNode }>(({ className, children }, ref) => (
  <div
    ref={ref}
    className={cn(
      'z-10 flex items-center gap-2 whitespace-nowrap rounded-full border bg-fd-card px-3 py-2 text-xs font-medium shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] sm:px-4 sm:py-2.5 sm:text-sm',
      className,
    )}
  >
    {children}
  </div>
));
Node.displayName = 'TraceNode';

const icon = 'size-4 shrink-0 text-brand';

export function TraceBeam() {
  const container = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const inputs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const outputs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const beam = { pathColor: 'currentColor', pathOpacity: 0.12, gradientStartColor: '#C47A3D', gradientStopColor: '#00A6E4' };

  return (
    <div
      ref={container}
      className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl border bg-fd-card/60 px-4 py-12 text-fd-muted-foreground sm:px-10"
    >
      <div className="flex w-full max-w-3xl items-center justify-between gap-4 text-fd-foreground">
        <div className="flex flex-col gap-5">
          <Node ref={inputs[0]}>
            <FileSpreadsheet className={icon} />
            厂家结构表
          </Node>
          <Node ref={inputs[1]}>
            <BookCheck className={icon} />
            产品标准
          </Node>
          <Node ref={inputs[2]}>
            <Layers className={icon} />
            敷设与环境
          </Node>
        </div>
        <div
          ref={hub}
          className="z-10 flex size-16 shrink-0 items-center justify-center rounded-full border-2 bg-fd-card shadow-[0_0_40px_-8px_rgba(196,122,61,0.7)] sm:size-20"
        >
          <BrandMark className="size-9 sm:size-11" />
        </div>
        <div className="flex flex-col gap-5">
          <Node ref={outputs[0]}>
            <Table2 className={icon} />
            载流量表
          </Node>
          <Node ref={outputs[1]}>
            <FileText className={icon} />
            规格书
          </Node>
          <Node ref={outputs[2]}>
            <NotebookText className={icon} />
            计算书
          </Node>
        </div>
      </div>
      {inputs.map((from, index) => (
        <AnimatedBeam key={`in-${index}`} containerRef={container} fromRef={from} toRef={hub} delay={index * 0.4} {...beam} />
      ))}
      {outputs.map((to, index) => (
        <AnimatedBeam key={`out-${index}`} containerRef={container} fromRef={hub} toRef={to} delay={1.2 + index * 0.4} {...beam} />
      ))}
    </div>
  );
}
