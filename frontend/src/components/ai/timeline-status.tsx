import { LoaderIcon as LoaderCircleIcon, CheckIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/cn'

type TimelineStatus = 'complete' | 'pending' | 'running' | 'failed'

const timelineLabelTone: Record<TimelineStatus, string> = {
  failed: 'text-destructive',
  complete: 'text-muted-foreground',
  pending: 'text-muted-foreground',
  running: 'text-foreground',
}

const timelineDetailTone: Record<TimelineStatus, string> = {
  failed: 'text-destructive',
  complete: 'text-muted-foreground',
  pending: 'text-muted-foreground',
  running: 'text-muted-foreground',
}

const timelineStatusLabel: Record<TimelineStatus, string> = {
  complete: '成功',
  pending: '排队',
  running: '执行中',
  failed: '失败',
}

function TimelineStatusIcon({ className, status }: { className?: string; status: TimelineStatus }) {
  return (
    <span className={cn('flex size-4 shrink-0 items-center justify-center', className)}>
      {status === 'failed' ? <XIcon className="size-4 text-destructive" /> : status === 'complete' ? (
        <CheckIcon className="size-4 text-muted-foreground" />
      ) : status === 'running' ? (
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-3.5 animate-spin text-foreground motion-reduce:animate-none dark:text-foreground"
        />
      ) : (
        <span
          aria-hidden="true"
          className="size-3 rounded-ui-pill border border-muted-foreground"
        />
      )}
      <span className="sr-only">{timelineStatusLabel[status]}</span>
    </span>
  )
}

function TimelineConnector({ reached }: { reached: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute top-6 bottom-1 left-2 w-px -translate-x-1/2 transition-colors duration-200 ease-out',
        reached ? 'bg-foreground/25' : 'bg-foreground/8',
      )}
    />
  )
}

export { TimelineConnector, TimelineStatusIcon, timelineDetailTone, timelineLabelTone }
export type { TimelineStatus }
