import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

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
/**
 * Everything that makes something behave like an M3 button: the fill layer, the press
 * morph, the state layer, the focus ring. Exported because a button is a button — Toggle
 * imports this instead of restating a version, which is how the interaction-type picker
 * ended up on stock shadcn while the buttons beside it had a state layer.
 */
export const buttonInteraction = [
    "group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center",
    // overflow-hidden clips the ripple to the pill. It does not clip the focus ring —
    // overflow clips content, not box-shadow.
    "bg-clip-padding font-medium whitespace-nowrap select-none",
    // The fill layer: width and style only. A colour here wins over every `t-surface-*` by
    // source order — which is why the outlined variant rendered a transparent border and
    // read as unstyled text. Each surface sets its own. rounded-[inherit] is what lets the
    // press morph carry through to the fill rather than only the outline.
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:bg-clip-padding",
    // The press morph. M3 Expressive: "when pressed, buttons can morph to become more
    // square" — round and square buttons share the same pressed shape, so this does not
    // depend on the resting shape. The fill inherits it, so the whole surface changes.
    //
    // The radius lives on the ELEMENT and animates here; the ::before inherits it. A
    // border-radius animates on its specified value, which is why the resting shape is
    // 50% and not rounded-full's 9999px: 9999px is clamped down to half the height, so
    // animating from it would hold a full pill for nearly the whole duration and then
    // snap.
    // Two curves for one property, and the direction is the whole trick.
    //
    // The base is what runs when `:active` is REMOVED — the release — and it must not
    // overshoot. A spatial spring on the way back carries the radius past the resting
    // shape, and on a pill "past" means past 50%, which the browser clamps: the button
    // visibly swells wider than it rests before settling. That reads as a wobble, not a
    // spring.
    //
    // `:active` overrides with the spatial spring, so going IN still bounces. Press in
    // springy, press out settled — which is what the bounce is for.
    "transition-[border-radius] duration-[length:var(--m3-duration-medium1)] ease-[var(--m3-easing-emphasized)]",
    "active:not-aria-[haspopup]:duration-[length:var(--m3-spring-expressive-fast-spatial-duration)] active:not-aria-[haspopup]:ease-[var(--m3-spring-expressive-fast-spatial)]",
    // M3 Expressive PressedContainerShape is 8/8/12/16/16 across XS/S/M/L/XL. The size
    // sets its own; this is the fallback.
    "active:not-aria-[haspopup]:rounded-[8px]",
    "data-pressed:not-aria-[haspopup]:rounded-[8px]",
    // "Shape morphs when selected": a round button goes square when it is on, and a
    // square one goes round. That is the toggle affordance — you can see which is
    // selected without reading the label. The shape variant supplies the resting
    // radius, so this only has to invert it.
    "aria-pressed:not-aria-[haspopup]:rounded-[12px]",
    "data-[shape=square]:aria-pressed:not-aria-[haspopup]:rounded-[50%]",
    "motion-reduce:transition-none",
    // The state layer. Installs an ::after; the t-state-* utilities drive its opacity.
    "t-state-layer t-state-hover t-state-press t-state-focus",
    "focus-visible:ring-ring focus-visible:ring-3 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:outline-none",
    "focus-visible:rounded-[8px]",
    "aria-invalid:ring-destructive/20 aria-invalid:ring-3 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0"
].join(" ")

const buttonVariants = cva(
  [buttonInteraction],
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
      shape: {
        // M3 Expressive: round is the default and the pill. Square is a per-size
        // radius, not one value — 12/12/16/28/28 across XS/S/M/L/XL — so the size
        // decides and this only says which one is in play.
        round: "",
        square: "",
      },
      size: {
        // md-comp-*-button: container-height 40, label-large, with-icon icon 18.
        default:
          "h-10 gap-2 rounded-[20px] px-4 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)] tracking-[length:var(--m3-label-large-tracking)] has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 [&_svg:not([class*='size-'])]:size-5",
        sm: "h-10 gap-2 rounded-[20px] px-4 text-[length:var(--m3-label-large-size)] leading-[length:var(--m3-label-large-line-height)] tracking-[length:var(--m3-label-large-tracking)] has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 [&_svg:not([class*='size-'])]:size-5",
        xs: "h-8 gap-1.5 rounded-[16px] px-3 text-[length:var(--m3-label-medium-size)] leading-[length:var(--m3-label-medium-line-height)] tracking-[length:var(--m3-label-medium-tracking)] [&_svg:not([class*='size-'])]:size-4",
        lg: "h-14 gap-2 rounded-[28px] px-6 text-[length:var(--m3-title-medium-size)] leading-[length:var(--m3-title-medium-line-height)] active:not-aria-[haspopup]:rounded-[12px] data-pressed:not-aria-[haspopup]:rounded-[12px] [&_svg:not([class*='size-'])]:size-6",
        icon: "size-10 rounded-[20px] [&_svg:not([class*='size-'])]:size-6",
        "icon-lg": "size-14 rounded-[28px] [&_svg:not([class*='size-'])]:size-7",
        "icon-sm": "size-8 rounded-[16px] [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-[12px] [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default", shape: "round" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "round",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-shape={shape}
      className={cn(
        buttonVariants({ variant, size, shape, className }),
        // Solid, not a wash. M3 dims a disabled label and a disabled container with
        // separate TOKENS; an alpha on the whole element lands on neither and, worse,
        // is a different colour against every background behind it.
        "disabled:pointer-events-none disabled:text-muted-foreground disabled:before:bg-muted",
        className,
      )}
      {...props}
    />
  )
}

export { Button, buttonVariants }
