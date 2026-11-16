import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-field outline-none placeholder:text-ink-3 focus-visible:border-ink-3 focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60 aria-invalid:border-error aria-invalid:ring-3 aria-invalid:ring-error-fill",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
