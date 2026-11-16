import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Buttons are round (pills). Copper is the one primary action of a screen; ink is the send button and other strong
// actions that must not compete with it; the rest are quiet.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-std outline-none select-none focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-copper text-on-copper hover:bg-copper-strong",
        ink: "bg-ink text-surface hover:bg-ink-2",
        outline:
          "border-line-strong bg-surface text-ink hover:bg-subtle aria-expanded:bg-subtle",
        secondary:
          "bg-subtle text-ink hover:bg-hover aria-expanded:bg-hover",
        ghost:
          "text-ink-2 hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink aria-pressed:bg-hover aria-pressed:text-ink",
        destructive:
          "bg-error-fill text-error hover:bg-error hover:text-surface",
        link: "rounded-sm px-0 text-copper underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-8 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/** A link in a button's looks: an anchor, so it stays a link for the browser and assistive technology. */
function ButtonLink({ className, variant = "default", size = "default", ...props }: React.ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  return <a data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, ButtonLink, buttonVariants }
