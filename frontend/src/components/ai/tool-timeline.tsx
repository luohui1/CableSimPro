import { WrenchIcon } from 'lucide-react'
import * as React from 'react'

import { TimelineConnector, TimelineStatusIcon } from '@/components/ai/timeline-status'
import { cn } from '@/lib/cn'

interface ToolTimelineItem {
  detail?: string
  id: string
  status: 'complete' | 'pending' | 'running' | 'failed'
  target?: string
  time?: string
  verb: string
}

interface ToolTimelineProps extends React.ComponentProps<'section'> {
  items: ToolTimelineItem[]
  summary?: string
  title?: string
}

const rowTone = {
  failed: { verb: 'text-destructive', target: 'text-muted-foreground' },
  complete: { verb: 'text-muted-foreground', target: 'text-foreground/70' },
  running: { verb: 'text-muted-foreground', target: 'text-foreground' },
  pending: { verb: 'text-muted-foreground', target: 'text-muted-foreground' },
}

function ToolTimeline({
  className,
  items,
  summary,
  title = '运行时间线',
  ...props
}: ToolTimelineProps) {
  return (
    <section
      data-slot="tool-timeline"
      className={cn(
        'rounded-ui-panel bg-card p-4 font-sans text-ui-note font-[450] tracking-[-0.05px] text-muted-foreground shadow-card',
        className,
      )}
      {...props}
    >
      <header className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <h3 className="text-ui-note leading-5 font-medium text-muted-foreground">{title}</h3>
        {summary && (
          <span className="ml-auto text-ui-note leading-5 text-muted-foreground">{summary}</span>
        )}
      </header>

      <ol className="mt-4">
        {items.map((item, index) => {
          const next = items[index + 1]
          const tone = rowTone[item.status]
          const isFile = item.target ? /\.[a-z0-9]+$/i.test(item.target) : false

          return (
            <li
              className="relative flex gap-3 pb-5 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] last:pb-0 starting:opacity-0"
              key={item.id}
            >
              {next && <TimelineConnector reached={next.status !== 'pending'} />}
              <TimelineStatusIcon className="mt-0.5" status={item.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 truncate text-ui-note leading-5">
                    <span className={tone.verb}>{item.verb}</span>
                    {item.target && (
                      <>
                        {' '}
                        <span
                          className={cn(
                            'font-medium',
                            tone.target,
                            isFile && 'font-mono text-ui-note font-normal',
                          )}
                        >
                          {item.target}
                        </span>
                      </>
                    )}
                  </p>
                  {item.time && (
                    <time
                      className={cn(
                        'shrink-0 font-mono text-ui-note tabular-nums',
                        item.status === 'running'
                          ? 'text-foreground/70'
                          : 'text-muted-foreground',
                      )}
                    >
                      {item.time}
                      {item.status === 'running' && '…'}
                    </time>
                  )}
                </div>
                {item.detail && (
                  <p className="mt-0.5 text-ui-note leading-4 text-muted-foreground">{item.detail}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export { ToolTimeline }
export type { ToolTimelineItem, ToolTimelineProps }
