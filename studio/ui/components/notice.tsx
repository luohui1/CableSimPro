// One place where a failed action says what went wrong, in the host's own words.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError } from '@/state/api';
import { Icon } from './icon';

export const useNotice = create<{ message: string | null; show: (message: string) => void; clear: () => void }>(set => ({
  message: null,
  show: message => set({ message }),
  clear: () => set({ message: null }),
}));

/** For mutation onError: the host's message when it has one. */
export const reportFailure = (error: unknown) =>
  useNotice.getState().show(error instanceof ApiError ? error.issue.message : error instanceof Error ? error.message : '操作没有完成。');

export function Notice() {
  const { message, clear } = useNotice();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clear, 8000);
    return () => clearTimeout(timer);
  }, [message, clear]);
  return <AnimatePresence>
    {message && <motion.div role="alert" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="fixed bottom-6 left-1/2 z-50 flex max-w-[640px] -translate-x-1/2 items-start gap-3 rounded-card bg-ink py-3 pr-3 pl-4 text-14 text-panel shadow-modal">
      <Icon name="status/error" className="mt-0.5" />
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" aria-label="关闭" onClick={clear} className="flex size-6 items-center justify-center rounded-chip opacity-70 hover:opacity-100"><Icon name="action/close" className="size-4" /></button>
    </motion.div>}
  </AnimatePresence>;
}
