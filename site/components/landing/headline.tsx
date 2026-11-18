'use client';

// 首屏标题：逐字落位，强调词下面画一道手写下划线。
import { motion, useReducedMotion } from 'motion/react';

const first = '每个载流量，';
const lead = '都';
const accent = '经得起追问';

export function Headline() {
  const reduced = useReducedMotion();
  let index = 0;
  const letters = (text: string, className?: string) =>
    [...text].map((char) => {
      const delay = 0.05 + index++ * 0.045;
      return (
        <motion.span
          key={`${char}-${delay}`}
          className={`inline-block ${className ?? ''}`}
          initial={reduced ? false : { opacity: 0, y: '0.35em', rotate: 6 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26, delay }}
        >
          {char}
        </motion.span>
      );
    });

  return (
    <h1
      aria-label={`${first}${lead}${accent}。`}
      className="font-display text-[42px] leading-[1.18] sm:text-6xl xl:text-[72px] 2xl:text-[80px]"
    >
      <span aria-hidden className="block">
        {letters(first)}
      </span>
      <span aria-hidden className="block whitespace-nowrap">
        {letters(lead)}
        <span className="relative inline-block">
          {letters(accent, 'text-brand')}
          <motion.svg
            viewBox="0 0 300 14"
            preserveAspectRatio="none"
            className="absolute -bottom-[0.14em] left-0 h-[0.16em] w-full overflow-visible"
            initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={{ duration: 0.7, delay: 0.75, ease: [0.2, 0, 0, 1] }}
          >
            <path
              d="M3 9 C 40 3, 78 12, 118 7 S 196 3, 236 8 S 280 10, 297 5"
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </motion.svg>
        </span>
        {letters('。')}
      </span>
    </h1>
  );
}
