"use client"

// shadcn/ui progress (base-nova, Base UI), restyled to the theme: an 8 px track on the light fill with the bar in ink, the
// label and the count above it. For work that runs in counted steps (compute a whole series: 3 of 11 done).
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@/lib/utils"

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root value={value} data-slot="progress" className={cn("flex flex-wrap gap-2", className)} {...props}>
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn("relative flex h-2 w-full items-center overflow-x-hidden rounded-full bg-subtle", className)}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full rounded-full bg-ink transition-all duration-std data-indeterminate:w-full data-indeterminate:animate-pulse data-indeterminate:bg-ink-3 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return <ProgressPrimitive.Label className={cn("text-sm font-medium text-ink", className)} data-slot="progress-label" {...props} />
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return <ProgressPrimitive.Value className={cn("ml-auto text-sm text-ink-2 tabular-nums", className)} data-slot="progress-value" {...props} />
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue }
