'use client';

// 来源链：一个结果从输入到交付经过的环节。铜色游标沿链自动走，鼠标移到哪一环就停在哪一环并说明这一环留下了什么。
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

import { Window } from './window';

const steps = [
  { name: '厂家结构表', note: '保存导入原件与列映射关系。' },
  { name: '型号版本', note: '每次修改生成新版本，历史版本保持不变。' },
  { name: '载流量研究', note: '记录敷设条件、运行工况与方法参数。' },
  { name: '运行快照', note: '冻结本次运行的输入、方法版本与插件封签。' },
  { name: '计算书 / 规格书', note: '交付文件注明数据来源、计算口径与方法版本。' },
];

export function SourceChain() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held || reduced) return;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % steps.length), 2400);
    return () => window.clearTimeout(timer);
  }, [active, held, reduced]);

  return (
    <Window title="追溯链" className="h-full" bodyClassName="flex h-[calc(100%-24px)] flex-col items-center px-6 py-8">
      <ol className="flex flex-col items-center" onPointerLeave={() => setHeld(false)}>
        {steps.map((step, index) => (
          <li key={step.name} className="flex flex-col items-center">
            {index > 0 && (
              <span className={cn('h-6 w-px transition-colors', index <= active ? 'bg-brand' : 'bg-fd-foreground/40')} />
            )}
            <button
              type="button"
              onPointerEnter={() => {
                setHeld(true);
                setActive(index);
              }}
              onFocus={() => {
                setHeld(true);
                setActive(index);
              }}
              onBlur={() => setHeld(false)}
              className={cn(
                'relative border px-4 py-1.5 font-mono text-sm transition-colors',
                index === active ? 'border-brand bg-brand-soft' : 'border-fd-foreground/70 bg-fd-background hover:bg-fd-accent',
              )}
            >
              {index === active && (
                <motion.span
                  layoutId="chain-cursor"
                  className="absolute -left-4 top-1/2 size-2 -translate-y-1/2 rotate-45 bg-brand"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              {step.name}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-auto min-h-12 pt-7 text-center text-sm text-fd-muted-foreground">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {steps[active].note}
          </motion.p>
        </AnimatePresence>
      </div>
    </Window>
  );
}
