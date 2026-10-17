import { cn } from "cn"

/**
 * The header every list page opens with.
 *
 * It was written out twice — once in each list — with the same class strings, which is
 * how a heading ends up `text-xl` on one list and `text-2xl` on the other six months
 * later. One definition means the two cannot drift, and a third list gets it for free.
 *
 * The count sits under the title rather than beside it. It is a qualifier on the title
 * ("Companies", "24 in this workspace"), not a second piece of information, and putting
 * them on one line made the title's position depend on how many rows the workspace
 * happened to hold.
 */
export function RecordListHeader({
  title,
  meta,
  children,
  className,
}: {
  title: string
  meta?: string
  /** The toolbar: search, filters, the primary action. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {meta ? <p className="text-muted-foreground text-sm">{meta}</p> : null}
      </div>
      {children}
    </header>
  )
}

/**
 * The row of controls under a list header.
 *
 * `min-h-9` so search, the filter chips and the primary action share one height whatever
 * each component's own size is. Without it the row is as tall as its tallest child and
 * the primary button floats off the baseline of the input beside it — which is the kind
 * of two-pixel wrong that reads as "unfinished" without being able to name.
 */
export function RecordToolbar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  )
}
