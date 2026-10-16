"use client"

import { cn } from "cn"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * The table shell both record lists render into.
 *
 * It exists because header and body rows drifted apart. Each list built its own frame,
 * each set its own grid template in two places, and "aligned" was a thing you re-checked
 * by eye whenever a column changed — which is how a header label ends up sitting above a
 * different column than the one it names.
 *
 * Two rules make it hold:
 *  1. One `columns` template, applied to the header row and to every body row by the same
 *     helper below. It is impossible to give them different values from here.
 *  2. Header cells are flex containers exactly like body cells, so `justify-end` means
 *     the same thing on both sides. A header that is not a flex container right-aligns its
 *     text inside the cell while the cell right-aligns its content, and the two drift by
 *     the difference in how they measure.
 *
 * Virtualization is the caller's business — the leads list needs it and the companies
 * list does not — so the body is a slot and the rows are the caller's rows, styled with
 * `gridRow`.
 *
 * The table is unconditionally hidden below `lg`, and it used to be each caller's job to
 * remember that — a job that fails silently, since a company's contact table rendered
 * this without the guard and cropped half its columns off the right edge of a phone with
 * no error anywhere. The narrow layout is a different component, `RecordCards`, and this
 * one owns the breakpoint so it cannot be forgotten.
 *
 * `lg`, not `md`, because `lg` is the first width where the table actually fits. The
 * sidebar takes 240px, so at 768px a tablet leaves a 528px pane — and the leads table
 * needs 760. It scrolled, which is not a crop but does read like one: the last three
 * columns simply were not there. At 1024px the pane is 784px and every table in the app
 * fits without scrolling, so the rule is "show the table only where there is room for it".
 */
export function RecordTable({
  columns,
  minWidth,
  headings,
  header,
  className,
  scrollRef,
  bodyClassName,
  bodyStyle,
  children,
}: {
  /** One grid template, e.g. "minmax(200px, 2fr) minmax(90px, auto)". */
  columns: string
  /** Floor so a narrow viewport scrolls rather than crushing the columns. */
  minWidth: number
  /** Static column labels. Ignored when `header` is given. */
  headings?: { label: string; align?: "left" | "right" }[]
  /**
   * Custom header cells, for a list whose columns come from a table library. Rendered
   * inside the same grid row, so it cannot end up somewhere else.
   */
  header?: React.ReactNode
  /** The outer frame, for hiding or positioning the whole table. */
  className?: string
  /** The scrolling element, which a virtualized list needs in order to scroll itself. */
  scrollRef?: React.RefObject<HTMLDivElement | null>
  bodyClassName?: string
  bodyStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <div className={cn("hidden min-h-0 overflow-hidden rounded-lg border lg:block", className)}>
      <div ref={scrollRef} className="h-full overflow-auto">
        <Table style={{ display: "grid", minWidth }} className="w-full">
          <TableHeader className="bg-background sticky top-0 z-10 grid">
            {/* w-full matters: without it the header grid sizes to its content while the
                body rows fill the width, and the columns stop lining up. */}
            <TableRow className="grid w-full" style={{ gridTemplateColumns: columns }}>
              {header ??
                headings?.map((heading) => (
                  <TableHead
                    key={heading.label}
                    className={cn(
                      "flex items-center overflow-hidden",
                      heading.align === "right" && "justify-end",
                    )}
                  >
                    {heading.label}
                  </TableHead>
                ))}
            </TableRow>
          </TableHeader>

          <TableBody className={cn("grid", bodyClassName)} style={bodyStyle}>
            {children}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** The style a body row must carry to line up with the header. */
export function gridRow(columns: string) {
  return { gridTemplateColumns: columns }
}

/**
 * The same records as cards, below md.
 *
 * A record table cannot shrink into a phone, so every list needs a second shape. This is
 * it, in one place, because it had already been written out twice by hand and the third
 * caller did not copy it.
 *
 * Each caller supplies only what goes *inside* a card. The frame, the spacing and the
 * whole-card link target belong here so two lists cannot disagree about them.
 */
export function RecordCards<T extends { id: string }>({
  items,
  children,
}: {
  items: readonly T[]
  children: (item: T) => React.ReactNode
}) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden">
      {items.map((item) => (
        <li key={item.id}>{children(item)}</li>
      ))}
    </ul>
  )
}

/**
 * The link that fills a card, so one tap anywhere on it opens the record — the card
 * equivalent of the stretched link, and for the same reason: the name is the link, and
 * the target is bigger than the name.
 */
export function cardLinkClass() {
  return "hover:bg-muted/50 flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors"
}

/** The class a body row must carry. Absolute for virtualized lists. */
export function rowClass(virtual?: boolean) {
  // Neither is the whole row clickable any more: the name is a link to the record, so a
  // row that looks clickable but is not would be a lie about where the click goes.
  return virtual
    ? "absolute grid w-full transition-colors hover:bg-muted/50"
    : "grid w-full transition-colors hover:bg-muted/50"
}

/**
 * A body cell. Matches the header cell's flex treatment exactly — see rule 2 above.
 *
 * Deliberately NOT overflow-hidden: it clipped the stretched link's ::after to the cell,
 * so clicking anywhere but the name did nothing. Truncation is the inner span's job.
 */
export function cellClass(align?: "left" | "right") {
  return cn("flex items-center", align === "right" && "justify-end")
}

/**
 * A cell holding the record's primary name, which opens the record.
 *
 * The stretched-link pattern: the anchor is only as wide as the text, and a ::after
 * pseudo-element covers the whole row. So the entire row is the click target — one tap
 * anywhere on it opens the record — while the anchor itself stays a real link that is
 * middle-clickable, shows its URL in the status bar, and can be opened in a new tab.
 *
 * The alternative, a click handler on the <tr>, gives up all of that and breaks
 * keyboard access unless the row is also given a role, which erases it from screen-reader
 * table navigation. See AGENTS.md.
 *
 * The row must be `relative` for the ::after to resolve against it.
 */
export function nameButtonClass() {
  // after:content-[''] is not optional: in Tailwind v4 `after:absolute` alone emits no
  // ::after at all, and the whole row silently stops being clickable.
  // after:cursor-pointer puts the pointer on the actual hit area, so hovering anywhere in
  // the row shows it — not just the cells the link physically occupies.
  return "after:absolute after:inset-0 after:content-[''] after:cursor-pointer -my-1 block max-w-full truncate px-1 text-left font-medium hover:underline underline-offset-4 focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
}

/**
 * Position a row so a stretched link's ::after resolves against it.
 *
 * Only for rows that are NOT already positioned. A virtualized row is `absolute`, which
 * is a positioning context on its own — adding `relative` would override it and break the
 * virtualizer's translateY maths.
 */
export function clickableRowClass(positioned: boolean) {
  return positioned ? "" : "relative"
}

export { TableCell, TableRow }