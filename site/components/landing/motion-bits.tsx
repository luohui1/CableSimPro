'use client';

// 首页的小动效：滚动到视野里再浮现、数字滚动计数、页脚逐字可悬停的大字。
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.6, delay, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!seen || reduced) return;
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.2, 0, 0, 1],
      onUpdate: (current) => setShown(Math.round(current)),
    });
    return () => controls.stop();
  }, [seen, reduced, value]);

  return (
    <span ref={ref} className={className}>
      {String(shown).padStart(String(value).length, '0')}
    </span>
  );
}

export function PixelWordmark({ text }: { text: string }) {
  return (
    <p aria-hidden className="select-none whitespace-nowrap text-center font-pixel leading-none text-[clamp(44px,13.2vw,220px)]">
      {[...text].map((char, index) => (
        <span
          key={index}
          className="inline-block text-fd-foreground/12 transition-[color,transform] duration-300 hover:-translate-y-2 hover:text-brand"
        >
          {char}
        </span>
      ))}
    </p>
  );
}
