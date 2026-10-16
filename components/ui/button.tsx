import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * The button.
 *
 * **The element is transparent.** Its ::before, at `-z-10` inside `isolate`, is the
 * visible body: fill, border, and the entire press transition. That is what
 * `rounded-[inherit]` on the before is for — the outline follows the pill instead of
 * being a rounded rectangle stamped onto a circle.
 *
 * It works because `isolate` plus a negative z-index paints the layer above the element's
 * own background and below its content, in its own stacking context. Which is also why
 * nothing here sets `bg-*` on the element: a background there paints over the layer and
 * hides it completely. Colours go on the ::before, which is what the `t-surface-*`
 * utilities in globals.css are for — one place that decides what a filled button is,
 * rather than six copies of `before:bg-*` in this file.
 *
 * **Pressing scales the layer, not the button.** The colour shrinks inside a box that
 * does not move: no reflow, no layout shift, and the text stays put while the surface gives
 * under the finger. Scaling the element would shift every neighbouring pixel for 150ms.
 *
 * Two variants opt out of that. `push` translates the button itself instead, for
 * something that reads as a physical key. A menu trigger (`aria-haspopup`) does not
 * scale, because the menu appearing is already the feedback.
 */
const buttonVariants = cva(
  [
    "group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center",
    "rounded-full bg-clip-padding text-sm font-medium whitespace-nowrap transition-ring outline-none select-none",
    // The layer: border, and the whole press transition.
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:border-transparent before:bg-clip-padding",
    "before:transition-[scale,background-color,border-color] before:duration-150 before:ease-out",
    "focus-visible:ring-3 focus-visible:ring-ring/50",
    "motion-reduce:before:transition-none",
    "active:not-aria-[haspopup]:not-data-[variant=push]:before:scale-[0.99]",
    "data-pressed:not-aria-[haspopup]:not-data-[variant=push]:before:scale-[0.99]",
    "motion-reduce:active:before:scale-100 motion-reduce:data-pressed:before:scale-100",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "t-surface t-surface-primary",
        outline: "t-surface t-surface-outline",
        secondary: "t-surface t-surface-muted",
        ghost: "t-surface t-surface-ghost",
        destructive:
          "t-surface t-surface-destructive focus-visible:ring-destructive/20",
        link: "text-primary rounded-none underline-offset-4 hover:underline before:hidden",
        // Translates rather than scales, so it reads as a key going down. Excluded from
        // the scale rules above by not-data-[variant=push].
        push:
          "t-surface t-surface-outline active:not-aria-[haspopup]:translate-y-px data-pressed:translate-y-px motion-reduce:active:translate-y-0 motion-reduce:data-pressed:translate-y-0",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
      // The pill's wider horizontal padding, layered over whatever size is in play — so
      // every button reads as a pill without each size re-deciding its own side padding.
      shape: {
        pill: "px-3.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        square: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "pill",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "pill",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, shape, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
