import { cn } from "cn"
import { RiLoaderLine } from "@remixicon/react"

// `children` is omitted from the spread type. RemixiconProps declares children as
// `undefined`, so forwarding React.ComponentProps<"svg">'s children into it fails to
// typecheck — and there is nothing to forward anyway, since this is a self-closing icon.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <RiLoaderLine
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      // `children` is stripped because RemixiconProps declares it as `undefined`, which
      // React.ComponentProps<"svg"> cannot satisfy. Spinner has no children by design.
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Spinner }