"use client"

import {
  RiCheckLine,
  RiCloseCircleLine,
  RiPhoneLine,
  RiSparklingLine,
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
 * One hue per stage, each with a dark counterpart, and one icon.
 *
 * **Why this has `dark:` variants after all.** It did not, on the argument that a solid
 * tone reads the same in both modes. That was wrong, and the argument hid the actual
 * rule. "The same tone in both modes" is right for a *border* or a *foreground* — things
 * that sit on whatever surface they land on. A badge is a filled surface itself, and a
 * light fill on a near-black page is a glare source: at `-100` every stage became a pale
 * blob with near-black text, which reads as five bright stickers punched into a dark
 * table.
 *
 * So the fill inverts with the theme while the *hue* does not. Light mode gets a pale
 * tint under dark ink; dark mode gets a deep tint under light ink. Same colour identity,
 * opposite polarity, and legibility held in both.
 *
 * The icons are not decoration. A stage is a position on a funnel and the label alone
 * makes you read it; a shape lets you scan the column and still know where each lead is.
 * They also stop the colour from being load-bearing — at a glance a dot reads even if
 * two hues are close, or if someone has the page zoomed past the point the label is
 * legible.
 */
const STAGE: Record<
  string,
  { tone: string; Icon: typeof RiCheckLine }
> = {
  new: {
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    Icon: RiSparklingLine,
  },
  contacted: {
    tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    Icon: RiPhoneLine,
  },
  qualified: {
    tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    Icon: RiCheckLine,
  },
  customer: {
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    Icon: RiStarLine,
  },
  disqualified: {
    tone: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
    Icon: RiCloseCircleLine,
  },
}

export function StageBadge({ stage }: { stage: string }) {
  const entry = STAGE[stage]

  // A stage this build has never heard of is still a stage. Render it neutral rather than
  // dropping it: the read path renders an empty name as "Unnamed" for the same reason.
  if (!entry) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {stage}
      </span>
    )
  }

  const Icon = entry.Icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        entry.tone,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden={true} />
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