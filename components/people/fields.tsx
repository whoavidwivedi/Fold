"use client"

import {
  RiCheckLine,
  RiCloseCircleLine,
  RiPhoneLine,
  RiAddCircleLine,
  RiStarLine,
} from "@remixicon/react"

import { cn } from "cn"
import { Badge } from "@/components/ui/badge"

/**
 * One renderer per custom-field type.
 *
 * This Map is the mechanism behind "fully customizable". A customer adds a field by
 * inserting a row into `field_definition` — no migration, no deploy — and it renders here
 * because the runtime looks the type up in this map.
 *
 * Two rules make it hold up:
 *  1. Build it once at module scope. A Record lookup or an object rebuild inside a cell
 *     render loop is the difference between a smooth 50-row table and a janky one.
 *  2. Add a new field type here and nowhere else. The table cell, the detail form and the
 *     validation all read this same map. See docs/adr/0006.
 */

export type FieldValue = unknown

export type FieldDefinition = {
  key: string
  label: string
  dataType: string
  options?: { value: string; label: string; color?: string }[]
}

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat()

type FieldRenderer = (value: FieldValue, def: FieldDefinition) => React.ReactNode

const renderers: Record<string, FieldRenderer> = {
  text: (v) => (v == null ? null : String(v)),
  textarea: (v) => (v == null ? null : String(v)),
  number: (v) => (typeof v === "number" ? number.format(v) : null),
  currency: (v) => (typeof v === "number" ? currency.format(v) : null),
  date: (v) => (typeof v === "string" ? formatDate(v) : null),
  checkbox: (v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : null),
  rating: (v) => (typeof v === "number" ? "★".repeat(Math.max(0, Math.min(5, v))) : null),
  select: (v, def) => {
    if (typeof v !== "string") return null
    const option = def.options?.find((o) => o.value === v)
    return (
      <Badge variant="secondary" className="font-normal">
        {option?.label ?? v}
      </Badge>
    )
  },
  multi_select: (v, def) => {
    if (!Array.isArray(v)) return null
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((item) => (
          <Badge key={String(item)} variant="secondary" className="font-normal">
            {def.options?.find((o) => o.value === item)?.label ?? String(item)}
          </Badge>
        ))}
      </span>
    )
  },
  phone: (v) =>
    typeof v === "string" ? (
      <a href={`tel:${v}`} className="hover:underline underline-offset-4">
        {v}
      </a>
    ) : null,
  url: (v) =>
    typeof v === "string" ? (
      <a
        href={v}
        target="_blank"
        rel="noreferrer noopener"
        className="hover:underline underline-offset-4"
      >
        {v}
      </a>
    ) : null,
}

/**
 * Render one custom-field value.
 *
 * An unknown type falls back to a JSON dump rather than rendering blank — if a workspace
 * has a field this build does not know about, the data should still be visible rather
 * than silently missing.
 */
export function renderFieldValue(value: FieldValue, def: FieldDefinition) {
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>

  const render = renderers[def.dataType]
  if (!render) {
    return (
      <code className="text-muted-foreground text-xs">
        {JSON.stringify(value)}
      </code>
    )
  }

  return <>{render(value, def)}</>
}

export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

/**
 * One hue per stage, each with a dark counterpart, and one icon in a filled disc.
 *
 * **Why this has `dark:` variants after all.** It did not, on the argument that a solid
 * tone reads the same in both modes. That was wrong, and the argument hid the actual
 * rule. "The same tone in both modes" is right for a *border* or a *foreground* — things
 * that sit on whatever surface they land on. A badge is a filled surface itself, and a
 * light fill on a near-black page is a glare source: at `-100` every stage became a pale
 * blob with near-black text, which reads as five bright stickers punched into a dark
 * table.
 *
 * The fill inverts with the theme; the hue does not.
 *
 * Three decisions carry the look, and all three are about weight:
 *
 * 1. **The icon sits in a filled disc**, not bare on the tint. A bare outline glyph is
 *    the same visual weight as the label beside it and the badge reads as a word with a
 *    decoration. A solid disc with a white glyph is the darkest thing in the badge, so
 *    the eye lands on the status before it reads the word.
 * 2. **The label takes the saturated hue, not the dark ink.** `sky-800` on `sky-100`
 *    is two greys with a hint of colour; `sky-700` is unmistakably that hue. It also
 *    means the text carries the colour alone, so the badge still reads at a size where
 *    the disc is only a few pixels.
 * 3. **The disc desaturates on the neutral stage** — dashed outline, no fill. "Not
 *    started" is the absence of progress, and a filled disc would give it as much
 *    presence as "Approved".
 *
 * The icon is not decoration. A stage is a position on a funnel and the label alone
 * makes you read it; a shape lets you scan the column and still know where each lead is.
 * It also stops the colour from being load-bearing.
 */
const STAGE: Record<
  string,
  {
    /** The pill: a tint of the hue, and the label in the hue itself. */
    pill: string
    /** The disc behind the glyph. Neutral is dashed and unfilled — see (3). */
    disc: string
    Icon: typeof RiCheckLine
  }
> = {
  new: {
    pill: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    disc: "bg-sky-600 text-white dark:bg-sky-500",
    Icon: RiAddCircleLine,
  },
  contacted: {
    pill: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    disc: "bg-violet-600 text-white dark:bg-violet-500",
    Icon: RiPhoneLine,
  },
  qualified: {
    pill: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    disc: "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950",
    Icon: RiCheckLine,
  },
  customer: {
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    disc: "bg-emerald-600 text-white dark:bg-emerald-500",
    Icon: RiStarLine,
  },
  disqualified: {
    pill: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
    disc: "border-2 border-dashed border-neutral-400 text-neutral-500 dark:border-neutral-500",
    Icon: RiCloseCircleLine,
  },
}

export function StageBadge({ stage }: { stage: string }) {
  const entry = STAGE[stage]

  // A stage this build has never heard of is still a stage. Render it neutral rather than
  // dropping it: the read path renders an empty name as "Unnamed" for the same reason.
  if (!entry) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
        {stage}
      </span>
    )
  }

  const Icon = entry.Icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-sm whitespace-nowrap",
        entry.pill,
      )}
    >
      {/* The disc is `size-5` and the glyph is `size-3` inside it — the glyph has to sit
          optically centred, and a 16px glyph on a 20px disc reads as a mistake. */}
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          entry.disc,
        )}
      >
        <Icon className="size-3" aria-hidden={true} />
      </span>
      {stage}
    </span>
  )
}

/**
 * The qualification stages, in the order a lead moves through them.
 *
 * Exported because three things now need it and they must agree: the filter chips on the
 * list, the stage badge tone map above, and the picker in the lead form. It replaced a
 * useStageOptions() hook that wrapped this constant in useMemo and was called from
 * nowhere.
 */
export const STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "customer", label: "Customer" },
  { value: "disqualified", label: "Disqualified" },
]