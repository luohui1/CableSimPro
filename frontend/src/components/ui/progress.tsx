"use client"

import * as React from "react"
import { cn } from '@/lib/cn'
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root asChild value={value}
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-ui-pill bg-primary/20",
        className
      )}
      {...props}
    >
      <progress className="native-progress" value={value ?? undefined} max={100} />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
