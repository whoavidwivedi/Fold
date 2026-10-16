import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { useRipple } from "@/hooks/use-ripple"

/**
 * The button, on Material 3 tokens. See docs/m3.md.
 *
 * **The element is transparent.** Its ::before, at `-z-10` inside `isolate`, is the
 * visible body: fill and border. That is what `rounded-[inherit]` on the before is
 * for — the outline follows the shape instead of being one shape stamped onto another.
 *
 * Colours go on the ::before and **never on the element**: a background there paints over
 * the layer and hides it. The `t-surface-*` utilities in globals.css are where those
 * colours live, so what "a filled button is" is decided in one place.
 *
 * **Interaction is a state layer, not a background swap.** ::after carries
 * `currentColor` at the opacities in md-sys-state — 0.08 hover, 0.12 press, 0.12 focus.
 * `currentColor` is not a shortcut, it is the spec: the layer is `on-primary` on a
 * filled button and `primary` on an outlined one, which is exactly what it resolves to.
 *
 * **Pressing scales the fill, not the button.** The layer on ::before shrinks to 0.99 so
 * the colour moves inside a box that does not: no reflow, and the text stays put while
 * the surface gives under the finger.
 *
 * Values are M3's, not ours: 40px containers, `corner-full` on every variant, `label-large`
 * (14/20/0.1px), 18px icons, and a disabled label at 0.38 — M3 dims the label and the
 * container separately, and `opacity-50` on the whole element lands on neither.
 *
 * Sizes below the 40px default are ours. M3 defines one button height; a CRM needs a
 * compact one, and inventing a 40px minimum would push every dense control out of reach.
 */
const buttonVariants = cva(
  [
    "group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center",
    // overflow-hidden clips the ripple to the pill. It does not clip the focus ring —
    // overflow clips content, not box-shadow.
    "bg-clip-padding overflow-hidden rounded-full font-medium whitespace-nowrap transition-ring select-none",
    // The fill layer, and the press transition that scales it.
    // Width and style only. A colour here wins over every `t-surface-*` by source order —
    // which is why the outlined variant was rendering a transparent border and reading
    // as unstyled text. Each surface sets its own.
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:bg-clip-padding",
    "before:transition-[scale,background-color,border-color] before:duration-150 before:ease-out",
    // The state layer. Installs an ::after; the t-state-* utilities drive its opacity.
    "t-state-layer t-state-hover t-state-press t-state-focus",
    "focus-visible:ring-ring focus-visible:ring-3 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:outline-none",
    "motion-reduce:before:transition-none",
    "active:not-aria-[haspopup]:not-data-[variant=push]:before:scale-[0.99]",
    "data-pressed:not-aria-[haspopup]:not-data-[variant=push]:before:scale-[0.99]",
    "motion-reduce:active:before:scale-100 motion-reduce:data-pressed:before:scale-100",
    "aria-invalid:ring-destructive/20 aria-invalid:ring-3 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "t-surface-primary",
        outline: "t-surface-outline",
        secondary: "t-surface-muted",
        ghost: "t-surface-ghost",
        destructive: "t-surface-destructive aria-invalid:ring-destructive/20",
        link: "text-primary rounded-none underline-offset-4 hover:underline t-state-hover",
        push:
          "t-surface-outline active:not-aria-[haspopup]:translate-y-px data-pressed:translate-y-px motion-reduce:active:translate-y-0 motion-reduce:data-pressed:translate-y-0",
      },
      size: {
        // md-comp-*-button: container-height 40, label-large, with-icon icon 18.
        default:
          "h-10 gap-2 px-6 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)] tracking-[length:var(--m3-label-large-tracking)] has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4 [&_svg:not([class*='size-'])]:size-[18px]",
        sm: "h-8 gap-1.5 px-3.5 text-[length:var(--m3-label-medium-size)] leading-[length:var(--m3-label-medium-line-height)] tracking-[length:var(--m3-label-medium-tracking)] has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5 [&_svg:not([class*='size-'])]:size-[16px]",
        xs: "h-6 gap-1 px-2.5 text-[length:var(--m3-label-small-size)] leading-[length:var(--m3-label-small-line-height)] tracking-[length:var(--m3-label-small-tracking)] [&_svg:not([class*='size-'])]:size-[14px]",
        lg: "h-12 gap-2 px-7 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)] [&_svg:not([class*='size-'])]:size-[20px]",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-6",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-12 [&_svg:not([class*='size-'])]:size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // Unbounded for icon buttons: there is no pointer inside their visible bounds to grow
  // from, so the ripple is centred and sized to reach the far corner.
  const ripple = useRipple<HTMLButtonElement>(Boolean(size?.startsWith("icon")))

  return (
    <ButtonPrimitive
      ref={ripple}
      data-slot="button"
      data-variant={variant}
      className={cn(
        buttonVariants({ variant, size, className }),
        // M3 dims the label to 0.38 and the container to 0.12, separately. One
        // opacity on the element lands on neither.
        "disabled:pointer-events-none disabled:text-foreground/38 disabled:before:bg-foreground/12",
        className,
      )}
      {...props}
    />
  )
}

export { Button, buttonVariants }
