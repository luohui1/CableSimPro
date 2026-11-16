"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// A button that stays pressed: a drawing layer, a view. Square with 8 px corners (tools are not pills); pressed is a grey
// fill and ink text, never copper.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-fast outline-none hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-hover aria-pressed:text-ink data-[state=on]:bg-hover data-[state=on]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-line-strong bg-surface hover:bg-subtle",
      },
      size: {
        default: "h-8 min-w-8 px-2",
        sm: "h-7 min-w-7 px-2 text-xs",
        lg: "h-9 min-w-9 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
