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
    <div className={cn("min-h-0 overflow-hidden rounded-lg border", className)}>
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

/** The class a body row must carry. Absolute for virtualized lists. */
export function rowClass(virtual?: boolean) {
  // Neither is the whole row clickable any more: the name is a link to the record, so a
  // row that looks clickable but is not would be a lie about where the click goes.
  return virtual
    ? "absolute grid w-full transition-colors hover:bg-muted/50"
    : "grid w-full transition-colors hover:bg-muted/50"
}

/** A body cell. Matches the header cell's flex treatment exactly — see rule 2 above. */
export function cellClass(align?: "left" | "right") {
  return cn("flex items-center overflow-hidden", align === "right" && "justify-end")
}

/** A cell holding the record's primary name, which opens the record. */
export function nameButtonClass() {
  return "-my-1 block max-w-full truncate px-1 text-left font-medium hover:underline underline-offset-4 focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
}

export { TableCell, TableRow }