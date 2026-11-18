'use client';

// 首屏右侧的"桌面"：两扇可以拖动、点一下就置顶的窗口。
// 主窗口里可以切换土壤热阻率，截图和允许电流随之在两次真实运行之间切换（数值取自研究院快速上手的两次运行）。
import { animate, motion, useDragControls, useMotionValue, useTransform } from 'motion/react';
import Image from 'next/image';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';

import { cn } from '@/lib/cn';
import specPdf from '@/src/assets/screenshots/factory/spec-pdf.webp';
import resultBase from '@/src/assets/screenshots/research/result-base.webp';
import resultChanged from '@/src/assets/screenshots/research/result-changed.webp';

import { CornerMarks, TitleBar, windowFrame } from './window';

const runs = [
  { rho: '1.0', ampacity: 944.8, shot: resultBase },
  { rho: '1.5', ampacity: 801.1, shot: resultChanged },
] as const;

type WindowId = 'result' | 'spec';

function DragWindow({
  title,
  area,
  z,
  draggable,
  onFocus,
  onMoved,
  className,
  children,
}: {
  title: string;
  area: RefObject<HTMLElement | null>;
  z: number;
  draggable: boolean;
  onFocus: () => void;
  onMoved: () => void;
  className?: string;
  children: ReactNode;
}) {
  const controls = useDragControls();
  return (
    <motion.div
      drag={draggable}
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.06}
      dragConstraints={area}
      onDragEnd={onMoved}
      onPointerDown={onFocus}
      whileDrag={{ scale: 1.012 }}
      style={{ zIndex: z }}
      className={cn(windowFrame, className)}
    >
      <TitleBar
        title={title}
        onPointerDown={(event) => draggable && controls.start(event)}
        className={draggable ? 'cursor-grab touch-none active:cursor-grabbing' : undefined}
      />
      {children}
    </motion.div>
  );
}

export function HeroDesktop({ area }: { area: RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState(0);
  const [order, setOrder] = useState<WindowId[]>(['result', 'spec']);
  const [draggable, setDraggable] = useState(false);
  const [moved, setMoved] = useState(false);
  const [layout, setLayout] = useState(0);

  // 只在桌面宽度、用鼠标时允许拖动；窄屏下窗口按文档流排列
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
    const update = () => setDraggable(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const value = useMotionValue<number>(runs[0].ampacity);
  const text = useTransform(value, (current) => current.toFixed(1));
  useEffect(() => {
    const controls = animate(value, runs[active].ampacity, { duration: 0.7, ease: [0.2, 0, 0, 1] });
    return () => controls.stop();
  }, [active, value]);

  const focus = (id: WindowId) => setOrder((current) => [...current.filter((item) => item !== id), id]);
  const shared = { area, draggable, onMoved: () => setMoved(true) };

  return (
    <div className="relative lg:aspect-[4/3]">
      <DragWindow
        key={`spec-${layout}`}
        title="规格书.pdf"
        z={10 + order.indexOf('spec')}
        onFocus={() => focus('spec')}
        className="hidden lg:absolute lg:right-[-3%] lg:top-[40%] lg:block lg:w-[31%]"
        {...shared}
      >
        <Image src={specPdf} alt="规格书 PDF 中的载流量表页" className="block w-full" draggable={false} />
      </DragWindow>

      <DragWindow
        key={`result-${layout}`}
        title="直埋载流量 — CableSimPro"
        z={10 + order.indexOf('result')}
        onFocus={() => focus('result')}
        className="relative mt-12 lg:absolute lg:left-0 lg:top-12 lg:mt-0 lg:w-[86%]"
        {...shared}
      >
        <CornerMarks />
        <div className="box-border flex h-9 items-center gap-2.5 border-b border-fd-foreground/70 px-3 text-[13px]">
          <span className="whitespace-nowrap text-fd-muted-foreground">土壤热阻率</span>
          <div role="radiogroup" aria-label="土壤热阻率" className="flex">
            {runs.map((run, index) => (
              <button
                key={run.rho}
                type="button"
                role="radio"
                aria-checked={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  'border border-fd-foreground/70 px-2.5 py-0.5 font-mono text-xs transition-colors',
                  index > 0 && 'border-l-0',
                  index === active ? 'bg-brand text-white dark:text-fd-background' : 'hover:bg-fd-accent',
                )}
              >
                {run.rho}
              </button>
            ))}
          </div>
          <span className="font-mono text-xs text-fd-muted-foreground">K·m/W</span>
          <span className="ml-auto hidden whitespace-nowrap text-xs text-fd-muted-foreground sm:inline">
            切一下，看允许电流怎么变
          </span>
        </div>
        <div className="relative">
          {runs.map((run, index) => (
            <Image
              key={run.rho}
              src={run.shot}
              alt={`土壤热阻率 ${run.rho} K·m/W 时的载流量结果`}
              draggable={false}
              priority={index === 0}
              className={cn(
                'block w-full transition-opacity duration-300',
                index === 0 ? 'relative' : 'absolute inset-0',
                index === active ? 'opacity-100' : 'opacity-0',
              )}
            />
          ))}
          {/* 标注截图里的允许电流；窗口外框高 60px（标题栏 24 + 工况条 36） */}
          <motion.span
            key={active}
            className="absolute left-[43.6%] top-[25.6%] h-[4.4%] w-[5.6%] border-[1.5px] border-brand"
            initial={{ scale: 1.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          />
          <span className="pointer-events-none absolute left-[46.4%] top-[calc(-60px-14px)] h-[calc(25.6%+74px)] w-px bg-brand" />
          <span className="pointer-events-none absolute left-[46.4%] top-[calc(-60px-44px)] -translate-x-1/2 whitespace-nowrap bg-fd-foreground px-2.5 py-1 font-mono text-xs text-fd-background shadow-[3px_3px_0_0_var(--color-brand)]">
            IEC 60287 · 允许电流 <motion.span className="tabular-nums">{text}</motion.span> A
          </span>
        </div>
      </DragWindow>

      {draggable && (
        <p className="absolute bottom-0 left-0 hidden items-center gap-3 font-mono text-xs text-fd-muted-foreground lg:flex">
          试试：拖动窗口，切换土壤热阻率
          {moved && (
            <button
              type="button"
              onClick={() => {
                setLayout((current) => current + 1);
                setMoved(false);
              }}
              className="border border-fd-foreground/60 px-2 py-0.5 text-fd-foreground transition-colors hover:bg-fd-accent"
            >
              复位
            </button>
          )}
        </p>
      )}
    </div>
  );
}
