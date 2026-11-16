"use client"

// Base UI NumberField in the field's looks (the input-group's border, height and focus ring): a number typed, parsed and
// formatted by the field itself, right-aligned in tabular figures, with what precedes it (U₀) and its unit after it. Grouping
// separators are off by default: 15000 V reads as 15000, as engineers write it.
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field"
import { MinusIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const PLAIN: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 6 }

function NumberField({ className, format = PLAIN, ...props }: NumberFieldPrimitive.Root.Props) {
  return <NumberFieldPrimitive.Root data-slot="number-field" format={format} className={cn("flex min-w-0 flex-col", className)} {...props} />
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "flex h-9 w-full min-w-0 items-center rounded-field border border-line-strong bg-surface transition-field has-[input:focus-visible]:border-ink-3 has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring data-disabled:bg-subtle data-disabled:opacity-60 has-[[aria-invalid=true]]:border-error",
        className
      )}
      {...props}
    />
  )
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn("h-full min-w-0 flex-1 bg-transparent px-3 text-right text-sm text-ink tabular-nums outline-none placeholder:text-ink-3", className)}
      {...props}
    />
  )
}

/** Text inside the field: a name before the number (U₀), or the unit after it. */
function NumberFieldAddon({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="number-field-addon" className={cn("shrink-0 text-sm text-ink-2 select-none", className)} {...props} />
}

function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 outline-none hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50", className)}
      {...props}
    >
      <MinusIcon className="size-3.5" />
    </NumberFieldPrimitive.Decrement>
  )
}

function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 outline-none hover:bg-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50", className)}
      {...props}
    >
      <PlusIcon className="size-3.5" />
    </NumberFieldPrimitive.Increment>
  )
}

export { NumberField, NumberFieldAddon, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput }
