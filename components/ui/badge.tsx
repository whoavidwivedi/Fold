import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  // 24dp, `label-small`. `py-0.5` was dead against a fixed h-5, and `transition-all` was
  // doing work no one wanted — it animates box-shadow mid-focus, which is why the ring
  // looked like it lagged. Transition the two properties that actually change.
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl px-2 text-[length:var(--m3-label-small-size)] leading-[length:var(--m3-label-small-line-height)] tracking-[length:var(--m3-label-small-tracking)] font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary",
        // Live is a role, not a variant. It exists because "connected" was being drawn
        // with a palette literal that no theme could reach.
        live:
          "bg-[var(--live-surface)] text-[var(--live)] border border-[var(--live-border)]",
        destructive:
          "bg-destructive-container text-destructive-foreground-container focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
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
