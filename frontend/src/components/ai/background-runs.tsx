import { CheckCircleIcon as CheckCircle2Icon, InfoIcon as CircleAlertIcon, ClockIcon as Clock3Icon, HistoryIcon as RunsIcon, LoaderIcon as LoaderCircleIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface BackgroundRun {
  detail?: string
  id: string
  label: string
  progress?: number
  status: 'complete' | 'failed' | 'queued' | 'running'
  updatedAt?: string
}

interface BackgroundRunsProps extends React.ComponentProps<'section'> {
  items: BackgroundRun[]
  onCancel?: (id: string) => void
  onOpen?: (id: string) => void
}

const titleTone: Record<BackgroundRun['status'], string> = {
  complete: 'text-muted-foreground',
  failed: 'text-muted-foreground',
  queued: 'text-muted-foreground',
  running: 'text-foreground',
}

function BackgroundRuns({ className, items, onCancel, onOpen, ...props }: BackgroundRunsProps) {
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  const running = items.filter((item) => item.status === 'running').length
  const queued = items.filter((item) => item.status === 'queued').length
  const summary =
    [running && `${running} 项执行中`, queued && `${queued} 项排队`].filter(Boolean).join(' · ') ||
    '运行已结束'

  React.useEffect(() => {
    if (!confirmingId) return
    const timer = window.setTimeout(() => setConfirmingId(null), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmingId])

  function cancel(item: BackgroundRun) {
    if (item.status === 'running' && confirmingId !== item.id) {
      setConfirmingId(item.id)
      return
    }
    setConfirmingId(null)
    onCancel?.(item.id)
  }

  return (
    <section
      data-slot="background-runs"
      className={cn(
        'overflow-hidden rounded-ui-panel bg-card font-sans text-ui-note font-[450] tracking-[-0.05px] text-muted-foreground shadow-card',
        className,
      )}
      {...props}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <RunsIcon className="size-4 text-muted-foreground" />
        <h3 className="text-ui-note leading-5 font-medium text-muted-foreground">运行记录</h3>
        <span className="ml-auto rounded-ui-pill bg-foreground/6 px-2 py-0.5 text-ui-note leading-5 text-muted-foreground tabular-nums">
          {summary}
        </span>
      </header>
      <ul className="space-y-1 border-t border-foreground/8 p-2">
        {items.map((item) => {
          const cancellable = !!onCancel && (item.status === 'queued' || item.status === 'running')
          const confirming = confirmingId === item.id

          return (
            <li
              className="group relative rounded-ui-item p-2.5 transition-colors hover:bg-foreground/4"
              key={item.id}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-6 shrink-0 items-center">
                  <RunStatus status={item.status} />
                </span>
                <button
                  className={cn(
                    'min-w-0 flex-1 rounded-ui-input text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    cancellable && 'pointer-coarse:pr-8',
                  )}
                  onClick={() => onOpen?.(item.id)}
                  type="button"
                >
                  <span className="flex items-baseline gap-3">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-ui-body leading-6 font-medium',
                        titleTone[item.status],
                      )}
                    >
                      {item.label}
                    </span>
                    {item.updatedAt && (
                      <time
                        className={cn(
                          'shrink-0 text-ui-note text-muted-foreground tabular-nums',
                          cancellable &&
                            'transition-opacity duration-150 ease-out group-focus-within:opacity-0 group-hover:opacity-0 pointer-coarse:opacity-100',
                          confirming && 'opacity-0',
                        )}
                      >
                        {item.updatedAt}
                      </time>
                    )}
                  </span>
                  {item.detail && (
                    <span className="mt-0.5 block truncate text-ui-note leading-5 text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </button>
                <span className="absolute top-2.5 right-2.5 flex h-6 items-center">
                  {cancellable &&
                    (confirming ? (
                      <Button
                        aria-label={`停止 ${item.label}`}
                        className="h-6 rounded-ui-pill bg-destructive/10 px-2 text-ui-note text-destructive hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => cancel(item)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        停止
                      </Button>
                    ) : (
                      <Button
                        aria-label={`取消 ${item.label}`}
                        className="opacity-0 transition-[opacity,background-color] duration-150 ease-out group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                        onClick={() => cancel(item)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <XIcon />
                      </Button>
                    ))}
                </span>
              </div>
              {item.status === 'running' && item.progress !== undefined && (
                <progress className="native-progress" aria-label="运行进度" value={item.progress} max={100} />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const statusEnterClass =
  'transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-90 starting:opacity-0 motion-reduce:starting:scale-100'

function RunStatus({ status }: Pick<BackgroundRun, 'status'>) {
  if (status === 'complete')
    return (
      <CheckCircle2Icon
        aria-label="成功"
        className={cn('size-4 text-foreground', statusEnterClass)}
      />
    )
  if (status === 'failed')
    return (
      <CircleAlertIcon
        aria-label="失败"
        className={cn('size-4 text-destructive', statusEnterClass)}
      />
    )
  if (status === 'running')
    return (
      <LoaderCircleIcon
        aria-label="执行中"
        className="size-4 animate-spin text-foreground motion-reduce:animate-none dark:text-foreground"
      />
    )
  return <Clock3Icon aria-label="排队中" className="size-4 text-muted-foreground" />
}

export { BackgroundRuns }
export type { BackgroundRun, BackgroundRunsProps }
