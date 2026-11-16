import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

// Fields are 36 px (32 px when compact), 8 px corners, a line border that darkens on focus with the copper ring.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-field border border-line-strong bg-surface px-3 text-sm text-ink transition-field outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-3 focus-visible:border-ink-3 focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60 aria-invalid:border-error aria-invalid:ring-3 aria-invalid:ring-error-fill",
        className
      )}
      {...props}
    />
  )
}

export { Input }
