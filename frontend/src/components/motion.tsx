import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/format';

// Durations and displacements resolve from the shared design tokens; components never author their own timelines.
export function motionToken(name: 'fast' | 'standard' | 'slow' | 'loop' | 'result') {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`).trim();
  return Number.parseFloat(raw) / (raw.endsWith('ms') ? 1000 : 1);
}
const ease = [0.2, 0, 0, 1] as const;
const exitEase = [0.4, 0, 1, 1] as const;

export function MotionValue({ value, from, precision = 0, historical = false }: { value: number | null; from?: number; precision?: number; historical?: boolean }) {
  const reduced = useReducedMotion() || document.documentElement.dataset.reducedMotion === 'true';
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (reduced || from === undefined || !Number.isFinite(from) || value === null || !Number.isFinite(value)) { setDisplay(value); return; }
    const animation = animate(from, value, { duration: motionToken('result'), ease: t => 1 - (1 - t) ** 3, onUpdate: setDisplay });
    return () => animation.stop();
  }, [value, from, reduced]);
  return <span data-motion="value" className={historical ? 'motion-value is-historical' : 'motion-value'}>{formatNumber(display, precision)}</span>;
}

export function MotionReveal({ open, kind = 'collapse', children, className, id }: { open: boolean; kind?: 'collapse' | 'drawer'; children: ReactNode; className?: string; id?: string }) {
  const reduced = useReducedMotion() || document.documentElement.dataset.reducedMotion === 'true';
  const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-1'));
  return <AnimatePresence initial={false}>{open && <motion.div id={id} className={className} data-motion={kind}
    initial={kind === 'collapse' ? { height: 0, opacity: 0 } : { opacity: 0, x: reduced ? 0 : offset }}
    animate={kind === 'collapse' ? { height: 'auto', opacity: 1 } : { opacity: 1, x: 0 }}
    exit={kind === 'collapse' ? { height: 0, opacity: 0 } : { opacity: 0, x: reduced ? 0 : offset, transition: { duration: reduced ? 0 : motionToken('standard'), ease: exitEase } }}
    transition={{ duration: reduced ? 0 : motionToken('standard'), ease }}>{children}</motion.div>}</AnimatePresence>;
}

export function MotionGlyph({ kind }: { kind: 'running' | 'selection' }) {
  const reduced = useReducedMotion() || document.documentElement.dataset.reducedMotion === 'true';
  if (kind === 'selection') return <span aria-hidden="true" className="motion-glyph glyph-selection" data-motion="selection"><motion.span className="selection-outline" initial={{ inset: reduced ? '0px' : 'calc(0px - var(--space-1))' }} animate={{ inset: '0px' }} transition={{ duration: reduced ? 0 : motionToken('fast'), ease }} /></span>;
  return <motion.span aria-hidden="true" className={`motion-glyph glyph-${kind}`} data-motion={kind}
    animate={{ rotate: reduced ? 0 : 360 }} initial={false}
    transition={{ duration: motionToken('loop'), repeat: reduced ? 0 : Infinity, ease: 'linear' }} />;
}
