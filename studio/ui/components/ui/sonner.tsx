"use client"

// shadcn/ui sonner (base-nova) with this app's theme store in place of next-themes. Its colours, border and radius come from
// the theme (ui/styles/theme.css, [data-sonner-toaster]), not from inline variables.
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/state/theme"

const Toaster = (props: ToasterProps) => {
  const theme = useTheme(state => state.theme)
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-ink-2" />,
        warning: <TriangleAlertIcon className="size-4 text-attention" />,
        error: <OctagonXIcon className="size-4 text-error" />,
        loading: <Loader2Icon className="size-4 animate-spin text-ink-2" />,
      }}
      {...props}
    />
  )
}

export { Toaster }
