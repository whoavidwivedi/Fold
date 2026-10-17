"use client"

import {
  RiCheckLine,
  RiCloseLine,
  RiPhoneLine,
  RiStarLine,
  RiUserAddLine,
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
 * The stages, and the only place any of this is written down.
 *
 * Was two things: a `STAGES` array with real labels, and a `STAGE` tone map keyed by the
 * same values. They could drift, and did — the filter said "Disqualified" while the badge
 * on every row said `disqualified`, because the badge rendered the raw enum it was handed.
 * A chip that prints 27,000 database values is not a design decision, it is a missing
 * lookup. Now the label, the icon and the tone travel together and cannot disagree.
 *
 * ## Why the chip has no background
 *
 * Three earlier versions had a tinted fill, a saturated label and a solid icon disc — three
 * colour values per chip, at 32px, which is button weight. In a list of 27,000 rows that
 * put the least important attribute on the row above the person's name, and a filled block
 * in a table cell is the single thing that makes a CRM table look like a toy.
 *
 * A stage is data, not a control. So the chip is an **annotation**: a solid disc carrying
 * the only hue, and the label in ordinary foreground ink. The hue is then redundant rather
 * than load-bearing — colour tells you the stage before you read it, and the word still
 * says it if you cannot see colour at all, on a bad projector, or zoomed past legibility.
 *
 * ## Why that also fixed dark mode
 *
 * The original complaint was that dark mode looked wrong, and the fix at the time was a
 * `dark:` variant on every hue. This needs none, and the reason is the fill is gone. With
 * a transparent chip the only themed value is the label, and the label is `text-foreground`
 * — a token. A solid `-600` disc reads the same on a white page and a near-black one,
 * because it does not sit *on* either, it sits on itself. The bug class is gone rather than
 * patched.
 *
 * ## Why the discs are all `-600`
 *
 * They were `-600` except amber, which was `-500` with dark ink because white on amber-500
 * fails contrast. One exception is how a set stops looking like a set — the odd disc reads
 * as a mistake. Amber-600 carries white at 3.1:1, which is under 4.5:1 for body text, so
 * amber keeps its own value and the other four match each other.
 *
 * Every glyph is flat and none draws a circle. `add-circle` and `close-circle` put a second
 * ring inside a disc that is already a circle: two concentric rings 12px across leave the
 * inner one as four pixels of nothing, so both read as a grey blob whatever stage they sat
 * on. The disc already supplies the circle; the glyph's only job is to say which stage.
 */
export const STAGES = [
  {
    value: "new",
    label: "New",
    Icon: RiUserAddLine,
    disc: "bg-sky-600 text-white",
  },
  {
    value: "contacted",
    label: "Contacted",
    Icon: RiPhoneLine,
    disc: "bg-violet-600 text-white",
  },
  {
    value: "qualified",
    label: "Qualified",
    Icon: RiCheckLine,
    // White on amber-500 is 2.2:1. Amber-400 with near-black ink is 9.1:1, so this disc is
    // lighter than its four siblings on purpose — see the note on `-600` above.
    disc: "bg-amber-400 text-amber-950",
  },
  {
    value: "customer",
    label: "Customer",
    Icon: RiStarLine,
    disc: "bg-emerald-600 text-white",
  },
  {
    value: "disqualified",
    label: "Disqualified",
    Icon: RiCloseLine,
    // Not a dashed outline any more. There is nothing behind the chip now, so a dashed
    // border is a floating ring with a hole in it; a solid grey disc says the same thing
    // and is quieter, which is right for the one stage that is an absence.
    disc: "bg-neutral-400 text-white",
  },
]

const STAGE_BY_VALUE = new Map(STAGES.map((s) => [s.value, s]))

export function StageBadge({ stage }: { stage: string }) {
  const entry = STAGE_BY_VALUE.get(stage)

  // A stage this build has never heard of is still a stage, so it still renders — with the
  // raw value, since inventing a label for it would be a lie. The read path renders an
  // empty name as "Unnamed" for the same reason, and a missing chip is indistinguishable
  // from a broken query.
  if (!entry) {
    return (
      <span className="inline-flex items-center text-xs font-medium text-muted-foreground whitespace-nowrap">
        {stage}
      </span>
    )
  }

  const { Icon } = entry

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground whitespace-nowrap">
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full", entry.disc)}>
        {/* 10px in a 16px disc. Any larger and the glyph's own outline starts to crowd
            the disc edge and the pair reads as a smudge at table density. */}
        <Icon className="size-2.5" aria-hidden={true} />
      </span>
      {entry.label}
    </span>
  )
}