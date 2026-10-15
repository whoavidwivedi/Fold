"use client"

import { useMemo, useState } from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiArrowRightLine,
  RiChat1Line,
  RiMailLine,
  RiPhoneLine,
  RiStickyNoteLine,
} from "@remixicon/react"

import { listTimeline, logActivity } from "@/lib/api/generated/endpoints/activity/activity"
import { listCompanies } from "@/lib/api/generated/endpoints/companies/companies"
import { getPerson, updatePerson } from "@/lib/api/generated/endpoints/people/people"
import type { Entry, LogBody, Person } from "@/lib/api/generated/model"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { StageBadge } from "@/components/people/fields"

const PAGE_SIZE = 50

// Sentinel for "no company". It cannot be the empty string: Base UI treats "" as an
// unset value, so selecting it would not fire onValueChange at all.
const NONE = "__none__"

type Kind = NonNullable<LogBody["kind"]>

/**
 * Kinds a rep can log, and how each reads in the feed.
 *
 * Built once at module scope for the same reason the field renderers are: this map is
 * looked up per timeline row, and rebuilding an icon table inside the loop is the
 * difference between a smooth feed and a janky one. See AGENTS.md.
 */
const KIND_META: Record<string, { label: string; Icon: typeof RiStickyNoteLine }> = {
  note: { label: "Note", Icon: RiStickyNoteLine },
  call: { label: "Call", Icon: RiPhoneLine },
  email: { label: "Email", Icon: RiMailLine },
  stage_change: { label: "Stage change", Icon: RiChat1Line },
}

export function RecordDrawer({
  personId,
  onClose,
}: {
  personId: string | null
  onClose: () => void
}) {
  return (
    <Sheet open={personId !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed so switching records resets the composer instead of carrying a half-typed
          note from the lead you just closed into the one you just opened. */}
      {personId && (
        <SheetContent
          key={personId}
          side="right"
          // The drawer is an occasional surface, so it gets a standard animation — the
          // iOS curve, which is what --ease-drawer is for.
          className="w-full ease-drawer sm:max-w-lg"
        >
          <DrawerBody personId={personId} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function DrawerBody({ personId }: { personId: string }) {
  const queryClient = useQueryClient()

  const person = useQuery({
    queryKey: ["person", personId],
    queryFn: async () => {
      const res = await getPerson(personId)
      if (res.status !== 200) throw new Error("could not load person")
      return res.data as Person
    },
  })

  // Infinite rather than paged: a timeline only ever grows older, so there is no "next"
  // page to navigate to and no cursor stack to unwind. See the people table for why
  // keyset pagination there needs one.
  const timeline = useInfiniteQuery({
    queryKey: ["timeline", personId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await listTimeline(personId, { limit: PAGE_SIZE, cursor: pageParam })
      if (res.status !== 200) throw new Error("could not load timeline")
      return res.data
    },
    getNextPageParam: (last) => last.nextCursor || undefined,
  })

  const [kind, setKind] = useState<Kind>("note")
  const [body, setBody] = useState("")
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound")

  const log = useMutation({
    mutationFn: () =>
      logActivity(personId, {
        kind,
        body: body.trim(),
        ...(kind === "email" ? { direction } : {}),
      }),
    onSuccess: async () => {
      setBody("")
      // The server already broadcast this over SSE, which invalidates the same key.
      // Doing it here too covers the author, whose own change does not come back around
      // the loop.
      await queryClient.invalidateQueries({ queryKey: ["timeline", personId] })
    },
  })

  // entries is nullable in the spec, so an empty workspace arrives as null.
  const entries = timeline.data?.pages.flatMap((page) => page.entries ?? []) ?? []
  const canSubmit = body.trim().length > 0 && !log.isPending
  const kindLabel = KIND_META[kind]?.label ?? "interaction"

  return (
    <>
      <SheetHeader>
        <SheetTitle className="truncate">
          {person.data ? fullName(person.data) : <Skeleton className="h-6 w-48" />}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          {person.data?.email && (
            <a
              href={`mailto:${person.data.email}`}
              className="hover:underline underline-offset-4"
            >
              {person.data.email}
            </a>
          )}
          {person.data && <StageBadge stage={person.data.lifecycleStage} />}
        </SheetDescription>
      </SheetHeader>

      {person.data && (
        <CompanyField person={person.data} />
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) log.mutate()
        }}
      >
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>Log an interaction</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              {/* Base UI has no `type` prop: the array alone is the contract, so an
                  empty array means "nothing chosen" and picking the active item
                  deselects it. Guarded below rather than allowed to clear. */}
              <ToggleGroup
                value={[kind]}
                onValueChange={(v) => v.length > 0 && setKind(v[0] as Kind)}
                variant="outline"
                size="sm"
              >
                {(["note", "call", "email"] as const).map((k) => {
                  const { label, Icon } = KIND_META[k]
                  return (
                    <ToggleGroupItem key={k} value={k}>
                      <Icon aria-hidden />
                      {label}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>

              {/* Direction only means something for email. Always showing it would teach
                  reps to set a field that is ignored elsewhere. Toggles, not a Select —
                  two states is not a dropdown, and StageFilter sets that precedent. */}
              {kind === "email" && (
                <ToggleGroup
                  value={[direction]}
                  onValueChange={(v) => v.length > 0 && setDirection(v[0] as "inbound" | "outbound")}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="inbound">Inbound</ToggleGroupItem>
                  <ToggleGroupItem value="outbound">Outbound</ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
          </Field>

          <Field>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                kind === "call"
                  ? "What was said?"
                  : kind === "email"
                    ? "Subject or summary"
                    : "Add a note"
              }
              rows={3}
            />
          </Field>
        </FieldGroup>

        <SheetFooter>
          {/* Button has no isPending. Compose Spinner + data-icon + disabled. */}
          <Button type="submit" disabled={!canSubmit}>
            {log.isPending && <Spinner data-icon="inline-start" />}
            {log.isPending ? "Saving…" : `Log ${kindLabel.toLowerCase()}`}
          </Button>
          {log.isError && (
            <p role="alert" className="text-destructive text-sm">
              Could not save. Try again.
            </p>
          )}
        </SheetFooter>
      </form>

      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        {timeline.isPending ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiStickyNoteLine />
              </EmptyMedia>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>
                Calls, notes and emails logged here build this lead&apos;s history.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ol className="divide-border divide-y">
              {entries.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </ol>

            {timeline.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                disabled={timeline.isFetchingNextPage}
                onClick={() => timeline.fetchNextPage()}
              >
                {timeline.isFetchingNextPage && <Spinner data-icon="inline-start" />}
                Load older
              </Button>
            )}
          </>
        )}
      </div>
    </>
  )
}

function TimelineRow({ entry }: { entry: Entry }) {
  const meta = KIND_META[entry.kind] ?? { label: entry.kind, Icon: RiStickyNoteLine }
  const props = (entry.properties ?? {}) as {
    body?: string
    direction?: string
    fromStage?: string
    toStage?: string
  }

  // A stage change is not prose, so it does not get a note body — it gets the move.
  const isStageChange = entry.kind === "stage_change" && props.fromStage

  return (
    <li className="flex gap-3 py-3">
      <span className="bg-muted text-muted-foreground mt-0.5 grid size-7 shrink-0 place-items-center rounded-full">
        <meta.Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{meta.label}</span>
          {props.direction && (
            <span className="text-muted-foreground text-xs capitalize">{props.direction}</span>
          )}
          <span className="text-muted-foreground text-xs">
            {entry.actorName ?? "Someone"} · {relativeTime(entry.happensAt)}
          </span>
        </p>
        {isStageChange && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            <StageBadge stage={props.fromStage!} />
            <RiArrowRightLine className="text-muted-foreground size-3.5" aria-hidden />
            <StageBadge stage={props.toStage ?? ""} />
          </p>
        )}
        {props.body && <p className="mt-0.5 text-sm whitespace-pre-wrap">{props.body}</p>}
      </div>
    </li>
  )
}

function fullName(person: Person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unnamed"
}

/**
 * "3m ago" for today, a date beyond that.
 *
 * Absolute timestamps are wrong here: a rep reads the newest entry and only cares whether
 * it was seconds or weeks ago. The cutoff is local midnight, which is exactly where
 * "today" stops being true.
 */
function relativeTime(iso: string) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ""

  const seconds = Math.round((Date.now() - then.getTime()) / 1000)
  if (seconds < 60) return "just now"

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (then >= startOfToday) {
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
  }

  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
/**
 * Assign or clear the lead's company.
 *
 * This is the other half of the company work: without it a lead can belong to a company
 * but there is no way to put it there, and person.company_id is a column nothing writes.
 *
 * Options come from the company list, which the drawer already has cached after the
 * first visit — so switching between leads does not refetch the dropdown each time.
 */
function CompanyField({ person }: { person: Person }) {
  const queryClient = useQueryClient()

  const companies = useQuery({
    queryKey: ["companies", { search: "" }],
    queryFn: async () => {
      const res = await listCompanies({ limit: 100 })
      if (res.status !== 200) throw new Error("could not load companies")
      return res.data
    },
    // A workspace with more companies than this gets a searchable picker. Until then, a
    // 100-row ceiling is cheaper than the combobox it would need.
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: (companyId: string | undefined) =>
      // orval types the optional field as nullable; undefined is what "clear it" means.
      updatePerson(person.id, { companyId: companyId ?? undefined }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["person", person.id] })
      await queryClient.invalidateQueries({ queryKey: ["people"] })
    },
  })

  const current = person.companyId ?? ""

  // Base UI renders SelectValue from the `items` collection, not from the mounted
  // <SelectItem> children. Without this the trigger shows the raw uuid: technically
  // correct, completely useless, and it passes every API check. A company picker that
  // cannot be read is the same bug as a dangling foreign key with extra steps.
  const options = useMemo(
    () => [
      { value: NONE, label: "No company" },
      ...(companies.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [companies.data],
  )

  return (
    <Field>
      <FieldLabel htmlFor={`company-${person.id}`}>Company</FieldLabel>
      <Select
        items={options}
        value={current}
        onValueChange={(v) => save.mutate(v && v !== NONE ? v : undefined)}
      >
        <SelectTrigger id={`company-${person.id}`} size="sm" className="w-full">
          <SelectValue placeholder="No company" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          Could not update the company.
        </p>
      )}
    </Field>
  )
}
