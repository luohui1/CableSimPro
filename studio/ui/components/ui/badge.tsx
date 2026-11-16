import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// A tag states one fact in a few words. 13 px, round; the verdict tones always come with an icon (see kit/marks).
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors duration-fast focus-visible:ring-3 focus-visible:ring-ring has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        default: "bg-copper text-on-copper",
        secondary: "bg-subtle text-ink-2",
        destructive: "bg-error-fill text-error",
        outline: "border-line-strong text-ink-2",
        ghost: "text-ink-2 hover:bg-hover",
        link: "text-copper underline-offset-4 hover:underline",
        success: "bg-success-fill text-success",
        attention: "bg-attention-fill text-attention",
        error: "bg-error-fill text-error",
        agent: "bg-agent-fill text-agent",
        selected: "bg-copper-fill text-copper",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

function Badge({
  className,
  variant = "secondary",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
