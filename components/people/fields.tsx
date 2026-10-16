"use client"

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

const STAGE_TONE: Record<string, string> = {
  // Solid, from the palette. These were `bg-<colour>-500/10` over white, which is a
  // 10% wash: a different colour against every surface the badge lands on, and roughly
  // 3% of luminance, so the stage was hard to read at all. A badge names a role now.
  new:
    "bg-[oklch(0.92_0.085_245)] text-[oklch(0.32_0.099_245)] dark:bg-[oklch(0.4_0.07_245)] dark:text-[oklch(0.9_0.085_245)]",
  contacted:
    "bg-[oklch(0.92_0.085_305)] text-[oklch(0.32_0.099_305)] dark:bg-[oklch(0.4_0.07_305)] dark:text-[oklch(0.9_0.085_305)]",
  qualified:
    "bg-[oklch(0.92_0.085_60)] text-[oklch(0.32_0.099_60)] dark:bg-[oklch(0.4_0.07_60)] dark:text-[oklch(0.9_0.085_60)]",
  customer:
    "bg-[oklch(0.92_0.085_158)] text-[oklch(0.32_0.099_158)] dark:bg-[oklch(0.4_0.07_158)] dark:text-[oklch(0.9_0.085_158)]",
  disqualified: "bg-muted text-muted-foreground",
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STAGE_TONE[stage] ?? "bg-muted text-muted-foreground",
      )}
    >
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