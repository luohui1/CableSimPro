import type { ReactNode, RefObject } from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon';

/** assistant-ui owns stream scrolling, user scroll intent, and returning to the latest message. */
export function AgentThread({ children, compact = false, busy, viewportRef }: {
  children: ReactNode; session?: string; compact?: boolean; busy?: boolean; viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  return <ThreadPrimitive.Root className="agent-thread-shell">
    <ThreadPrimitive.Viewport ref={viewportRef} className={`agent-thread ${compact ? 'is-compact' : ''}`}
      aria-label="任务对话记录" aria-busy={busy || undefined} tabIndex={0} turnAnchor="bottom">
      <div className="agent-thread-content" role="log" aria-live="off">{children}</div>
      <ThreadPrimitive.ScrollToBottom render={<Button size="compact" variant="outline" className="agent-scroll-latest" />}>
        <Icon name="action/arrow-down" />回到最新
      </ThreadPrimitive.ScrollToBottom>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}
