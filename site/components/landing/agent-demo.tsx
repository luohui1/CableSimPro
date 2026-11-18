'use client';

// Agent 协作的流程演示：提出任务 → 读取 → 起草修改 → 试算 → 给出方案，最后必须由访客"按住批准"或拒绝。
// 这是演示脚本，不连接模型；允许电流取自研究院快速上手里的两次真实运行（土壤热阻率 1.00 与 1.50 K·m/W）。
import { Check, CornerDownLeft, LoaderCircle, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';

import { TitleBar, windowFrame } from './window';

const tools = ['读取研究及最近一次运行结果', '生成修改方案（字段级对比）', '试算（不保存）：IEC 60287 载流量'];
const HOLD = 1100; // 按住批准需要的毫秒数
const PROPOSAL = tools.length + 2;

export function AgentDemo() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-20% 0px' });
  const [step, setStep] = useState(0);
  const [verdict, setVerdict] = useState<'approved' | 'rejected' | null>(null);
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  // 进入视野后按节奏播放到"等待批准"为止；之后停在那里等访客决定
  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      setStep(PROPOSAL);
      return;
    }
    if (step >= PROPOSAL) return;
    const wait = step === 0 ? 500 : step <= tools.length ? 950 : 700;
    const id = window.setTimeout(() => setStep((current) => current + 1), wait);
    return () => window.clearTimeout(id);
  }, [seen, step, reduced]);

  const release = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const press = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => {
      release();
      setVerdict('approved');
    }, HOLD);
  };
  useEffect(() => release, []);

  const replay = () => {
    release();
    setVerdict(null);
    setStep(0);
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setVerdict('approved');
    }
  };

  const row = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  return (
    <div ref={ref} className={cn(windowFrame, 'flex h-full flex-col')}>
      <TitleBar title="Agent — 直埋载流量研究" />
      <div className="flex min-h-[400px] flex-1 flex-col gap-3 px-4 py-5 text-sm sm:px-5">
        {step >= 1 && (
          <motion.p {...row} className="ml-auto max-w-[85%] bg-fd-foreground px-3.5 py-2 text-fd-background">
            <span className="font-mono text-brand-invert">@直埋载流量</span> 将土壤热阻率调整为 1.5 K·m/W，评估对允许电流的影响
          </motion.p>
        )}
        {tools.map(
          (tool, index) =>
            step >= index + 2 && (
              <motion.p key={tool} {...row} className="flex items-center gap-2 font-mono text-[13px] text-fd-muted-foreground">
                {step === index + 2 && !reduced ? (
                  <LoaderCircle className="size-3.5 animate-spin text-brand" />
                ) : (
                  <Check className="size-3.5 text-brand" />
                )}
                {tool}
              </motion.p>
            ),
        )}
        {step >= PROPOSAL && (
          <motion.div {...row} className="space-y-3">
            <p className="leading-relaxed text-pretty">
              土壤热阻率由 1.00 调整为 1.50 K·m/W 后，允许电流由 <strong className="font-semibold">944.8 A</strong> 降至{' '}
              <strong className="font-semibold text-brand">801.1 A</strong>。是否保存该修改？
            </p>
            <div className="border border-fd-foreground/70 bg-fd-background">
              <div className="flex items-center justify-between border-b border-fd-foreground/70 px-3 py-1.5 font-mono text-xs">
                <span>修改方案</span>
                <span className={verdict === 'approved' ? 'text-brand' : 'text-fd-muted-foreground'}>
                  {verdict === 'approved' ? '已批准' : verdict === 'rejected' ? '已拒绝' : '待审批'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <span className="text-fd-muted-foreground">介质热阻率</span>
                <span className="font-mono line-through decoration-fd-foreground/40">1.00</span>
                <span className="font-mono text-brand">→ 1.50 K·m/W</span>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {verdict === null ? (
                  <motion.div key="actions" exit={{ opacity: 0 }} className="flex items-center gap-2 border-t border-fd-foreground/70 px-3 py-2.5">
                    <button
                      type="button"
                      onPointerDown={press}
                      onPointerUp={release}
                      onPointerLeave={release}
                      onKeyDown={onKey}
                      className="relative select-none overflow-hidden border border-fd-foreground bg-fd-card px-4 py-1.5 font-medium touch-none"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-0 origin-left bg-brand"
                        style={{
                          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
                          transition: holding ? `transform ${HOLD}ms linear` : 'transform 150ms ease-out',
                        }}
                      />
                      <span className={cn('relative transition-colors', holding && 'text-white dark:text-fd-background')}>按住批准</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerdict('rejected')}
                      className="border border-fd-foreground/50 px-4 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
                    >
                      拒绝
                    </button>
                    <span className="ml-auto hidden items-center gap-1 font-mono text-xs text-fd-muted-foreground sm:flex">
                      <CornerDownLeft className="size-3" />
                      须人工审批
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key={verdict}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 border-t border-fd-foreground/70 px-3 py-2.5"
                  >
                    <span className={cn('size-2 shrink-0 rotate-45', verdict === 'approved' ? 'bg-brand' : 'bg-fd-foreground/40')} />
                    <span>
                      {verdict === 'approved'
                        ? '已保存为新修订。计算运行仍须在工作台完成预检后人工确认。'
                        : '已放弃修改。试算结果不保存，工程数据未发生变更。'}
                    </span>
                    <button
                      type="button"
                      onClick={replay}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-xs text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                    >
                      <RotateCcw className="size-3" />
                      重播
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-fd-foreground/70 px-4 py-2.5 text-[13px] text-fd-muted-foreground sm:px-5">
        产品中可通过
        <kbd className="border border-fd-foreground/50 bg-fd-background px-1.5 font-mono text-xs text-fd-foreground">@</kbd>
        引用研究或型号，通过
        <kbd className="border border-fd-foreground/50 bg-fd-background px-1.5 font-mono text-xs text-fd-foreground">/</kbd>
        选择常用任务。
      </p>
      <p className="border-t border-fd-foreground/25 px-4 py-2 font-mono text-xs text-fd-muted-foreground sm:px-5">
        流程示意，未连接模型；允许电流数值取自快速入门中的两次实际运行。
      </p>
    </div>
  );
}
