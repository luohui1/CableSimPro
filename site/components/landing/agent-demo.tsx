'use client';

// Agent 协作的流程演示，与产品的提案卡片一致：读取 → 修改工程输入（提案）→ 运行研究（提案）→ 结果。
// 每一步都要访客“接受”才继续；“拒绝”可填原因，不写入任何数据。
// 这是演示脚本，不连接模型；允许电流取自研究院快速上手里的两次真实运行（土壤热阻率 1.00 与 1.50 K·m/W）。
import { Check, LoaderCircle, RotateCcw } from 'lucide-react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { TitleBar, windowFrame } from './window';

const tools = ['读取研究及最近一次运行结果', '核对输入来源与方法适用范围'];
const FIRST = tools.length + 2;
const EXECUTE = 900; // 接受后“执行”的演示时长

type Stage = 'edit' | 'edit-running' | 'run' | 'run-running' | 'done' | 'rejected';
type Card = 'edit' | 'run';

export function AgentDemo() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-20% 0px' });
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<Stage>('edit');
  const [rejecting, setRejecting] = useState<Card | null>(null);
  const [rejectedCard, setRejectedCard] = useState<Card | null>(null);
  const [reason, setReason] = useState('');

  // 进入视野后按节奏播放到第一张提案为止；之后等访客决定
  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      setStep(FIRST);
      return;
    }
    if (step >= FIRST) return;
    const wait = step === 0 ? 500 : step <= tools.length ? 950 : 700;
    const id = window.setTimeout(() => setStep((current) => current + 1), wait);
    return () => window.clearTimeout(id);
  }, [seen, step, reduced]);

  // 接受后演示执行，完成后进入下一步
  useEffect(() => {
    if (stage !== 'edit-running' && stage !== 'run-running') return;
    const id = window.setTimeout(() => setStage(stage === 'edit-running' ? 'run' : 'done'), reduced ? 0 : EXECUTE);
    return () => window.clearTimeout(id);
  }, [stage, reduced]);

  const accept = (card: Card) => setStage(card === 'edit' ? 'edit-running' : 'run-running');
  const confirmReject = (card: Card) => {
    setRejectedCard(card);
    setRejecting(null);
    setStage('rejected');
  };
  const replay = () => {
    setStage('edit');
    setRejecting(null);
    setRejectedCard(null);
    setReason('');
    setStep(reduced ? FIRST : 0);
  };

  const row = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };
  const editDone = stage !== 'edit' && !(stage === 'rejected' && rejectedCard === 'edit');
  const showRun = stage === 'run' || stage === 'run-running' || stage === 'done' || (stage === 'rejected' && rejectedCard === 'run');

  const status = (card: Card): string => {
    if (stage === 'rejected' && rejectedCard === card) return '已拒绝';
    if (card === 'edit') return stage === 'edit' ? '待你审阅' : '已接受';
    return stage === 'run' ? '待你审阅' : '已接受';
  };

  const actions = (card: Card) => {
    const pending = card === 'edit' ? stage === 'edit' : stage === 'run';
    if (!pending) return null;
    if (rejecting === card) {
      return (
        <motion.div key="reject" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 border-t border-fd-foreground/70 px-3 py-2.5">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="拒绝的原因，Agent 会照此调整（可不写）"
            aria-label="拒绝的原因"
            className="w-full border border-fd-foreground/50 bg-fd-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:border-fd-foreground"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => confirmReject(card)} className="border border-fd-foreground bg-fd-card px-4 py-1.5 font-medium">
              确认拒绝
            </button>
            <button
              type="button"
              onClick={() => setRejecting(null)}
              className="border border-fd-foreground/50 px-4 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
            >
              取消
            </button>
          </div>
        </motion.div>
      );
    }
    return (
      <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 border-t border-fd-foreground/70 px-3 py-2.5">
        <button
          type="button"
          onClick={() => accept(card)}
          className="border border-fd-foreground bg-brand px-4 py-1.5 font-medium text-white transition-opacity hover:opacity-90 dark:text-fd-background"
        >
          接受
        </button>
        <button
          type="button"
          onClick={() => setRejecting(card)}
          className="border border-fd-foreground/50 px-4 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
        >
          拒绝
        </button>
        <span className="ml-auto hidden font-mono text-xs text-fd-muted-foreground sm:block">接受只授权这一步</span>
      </motion.div>
    );
  };

  return (
    <div ref={ref} className={cn(windowFrame, 'flex h-full flex-col')}>
      <TitleBar title="Agent — 直埋载流量研究" />
      <div className="flex min-h-[460px] flex-1 flex-col gap-3 px-4 py-5 text-sm sm:px-5">
        {step >= 1 && (
          <motion.p {...row} className="ml-auto max-w-[85%] bg-fd-foreground px-3.5 py-2 text-fd-background">
            把土壤热阻率改为 1.5 K·m/W，重新计算并和修改前对比。
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
        {step >= FIRST && (
          <motion.div {...row} className="space-y-3">
            <p className="leading-relaxed text-pretty">需要两步，每一步都请你确认。</p>
            <ProposalCard title="修改工程输入 · 直埋载流量" status={status('edit')} accent={editDone} footer={actions('edit')}>
              <span className="text-fd-muted-foreground">介质热阻率</span>
              <span className="font-mono">原值 1.00</span>
              <span className="font-mono text-brand">保存值 1.50 K·m/W</span>
            </ProposalCard>
          </motion.div>
        )}
        {stage === 'edit-running' && <Running text="已接受，正在执行；完成后继续处理下一步。" reduced={reduced} />}
        {showRun && (
          <motion.div {...row}>
            <ProposalCard
              title="运行研究 · 直埋载流量"
              status={status('run')}
              accent={stage === 'run-running' || stage === 'done'}
              footer={actions('run')}
            >
              <span className="text-fd-muted-foreground">方法</span>
              <span>IEC 60287 稳态载流量</span>
            </ProposalCard>
          </motion.div>
        )}
        {stage === 'run-running' && <Running text="已接受，正在执行；完成后继续处理下一步。" reduced={reduced} />}
        {(stage === 'done' || stage === 'rejected') && (
          <motion.div {...row} className="flex items-start gap-3">
            <span className={cn('mt-1.5 size-2 shrink-0 rotate-45', stage === 'done' ? 'bg-brand' : 'bg-fd-foreground/40')} />
            <p className="leading-relaxed text-pretty">
              {stage === 'done' ? (
                <>
                  新运行完成，允许电流由 <strong className="font-semibold">944.8 A</strong> 降至{' '}
                  <strong className="font-semibold text-brand">801.1 A</strong>。输入差异只有土壤热阻率，两次的限制对象相同；修改前的运行保留为历史结果。
                </>
              ) : (
                '已拒绝，没有写入任何数据。Agent 会按原因调整，不会换一种方式重试同一写入。'
              )}
            </p>
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
      </div>
      <p className="border-t border-fd-foreground/70 px-4 py-2.5 text-[13px] text-fd-muted-foreground sm:px-5">
        每一次修改、运行和导出都是一张提案卡片，由人在对话中接受后才执行；审核、批准和发布只能由人完成。
      </p>
      <p className="border-t border-fd-foreground/25 px-4 py-2 font-mono text-xs text-fd-muted-foreground sm:px-5">
        流程示意，未连接模型；允许电流数值取自快速入门中的两次实际运行。
      </p>
    </div>
  );
}

function ProposalCard({
  title,
  status,
  accent,
  footer,
  children,
}: {
  title: string;
  status: string;
  accent: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border border-fd-foreground/70 bg-fd-background">
      <div className="flex items-center justify-between border-b border-fd-foreground/70 px-3 py-1.5 font-mono text-xs">
        <span>{title}</span>
        <span className={accent ? 'text-brand' : 'text-fd-muted-foreground'}>{status}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">{children}</div>
      {footer}
    </div>
  );
}

function Running({ text, reduced }: { text: string; reduced: boolean | null }) {
  return (
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 font-mono text-[13px] text-fd-muted-foreground">
      {reduced ? <Check className="size-3.5 text-brand" /> : <LoaderCircle className="size-3.5 animate-spin text-brand" />}
      {text}
    </motion.p>
  );
}
