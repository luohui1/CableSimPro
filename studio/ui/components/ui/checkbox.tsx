"use client"

// shadcn/ui checkbox (base-nova, Base UI), restyled to the theme: a 16 px square with the field border; checked is the
// selection colour, like the radio. The click area reaches past the box so the label beside it is easy to hit.
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface transition-colors duration-fast outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ink-3 focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        className
      )}
      {...props}
    >
      {/* Part of a list ticked (the box for all rows): a dash instead of the tick. */}
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="group/indicator grid place-content-center text-current">
        <CheckIcon className="size-3.5 group-data-indeterminate/indicator:hidden" />
        <MinusIcon className="hidden size-3.5 group-data-indeterminate/indicator:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
