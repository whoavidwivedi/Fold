"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { buttonInteraction } from "@/components/ui/button"

// A toggle IS a button, so it gets the button treatment rather than a second version of
// it. Before this it kept the stock shadcn string — `hover:bg-muted`, `transition-all`,
// no state layer — which is why the interaction-type picker looked like a different
// component from the buttons sitting beside it.
const toggleVariants = cva(
  [
    buttonInteraction,
    // The group owns the outer corners, so a member must not round the side it shares.
    "rounded-[12px] group-data-[spacing=0]/toggle-group:rounded-none",
    "disabled:pointer-events-none disabled:text-muted-foreground disabled:before:bg-muted",
    "[&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "t-surface-ghost",
        outline: "t-surface-outline",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)]",
        sm: "h-7 min-w-7 px-2.5 text-[length:var(--m3-label-medium-size)] leading-[length:var(--m3-label-medium-line-height)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)]",
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
      aria-pressed={props.value !== undefined ? undefined : undefined}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
