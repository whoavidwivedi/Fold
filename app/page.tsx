import Link from "next/link"
import {
  RiHistoryLine,
  RiBuildingLine,
  RiFlashlightLine,
  RiLockLine,
  RiSearchLine,
  RiStackLine,
} from "@remixicon/react"

import { StageBadge } from "@/components/people/fields"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

/**
 * The marketing page. It replaced a redirect to /people.
 *
 * ## No entrance animation
 *
 * Every other animated surface in this app has a reason to move — a drawer opens, a toast
 * arrives. This page does not: a visitor arrives once, reads it, and either signs up or
 * leaves. Animating a one-shot view costs a JavaScript bundle or a keyframe for a
 * transition nobody sees twice, and it delays the thing they came for. It is also the
 * page most likely to be opened on a phone on a slow connection, where a 400ms fade is
 * 400ms of blank page.
 *
 * ## The hero visual is the real component
 *
 * Not a screenshot. A screenshot of a table that no longer looks like that is worse than
 * no visual at all, and it goes stale the first time someone changes a row height. The
 * stage chips below are the actual `StageBadge`, so this page cannot drift out of sync
 * with the product it describes.
 *
 * ## Every claim here is something the app does
 *
 * No testimonials, no logo wall, no "10,000 teams". The feature list is the six things
 * that are built and tested; the roadmap does not get a section on the front page.
 */

/** The rows in the hero mock. Same shape the API returns, four of them. */
const PREVIEW = [
  { name: "Carmen Castellanos", email: "carmen@anvilbeam.test", stage: "new", source: "Partner", score: 82 },
  { name: "Yusuf Fontaine", email: "yusuf@fenwickroofing.test", stage: "contacted", source: "Referral", score: 64 },
  { name: "Fionn Nakamura", email: "fionn@willowbend.test", stage: "customer", source: "Outbound", score: 91 },
  { name: "Amara Kaminski", email: "amara@saltgrassroofing.test", stage: "qualified", source: "Webinar", score: 57 },
  { name: "Leila Baptiste", email: "leila@copperfieldmech.test", stage: "new", source: "Conference", score: 38 },
]

const FEATURES = [
  {
    Icon: RiStackLine,
    title: "Leads and companies, linked",
    body: "A contact belongs to a company, a company counts its contacts, and neither can drift out of sync with the other. Attaching a lead to a company is one field, not a reconciliation job.",
  },
  {
    Icon: RiSearchLine,
    title: "Search that finds things",
    body: "Full-text and substring across names, emails and domains, on every list. Keyset pagination underneath, so the page after the first is as fast as the first.",
  },
  {
    Icon: RiHistoryLine,
    title: "Every touch on the record",
    body: "Notes, calls and email land on the lead's own timeline with who did them and when. Not a separate activity tab you have to remember to open.",
  },
  {
    Icon: RiFlashlightLine,
    title: "Realtime without the ceremony",
    body: "One server-sent event stream for the whole app. A lead created in one tab appears in the other, and a change made on a phone shows up on a desktop.",
  },
  {
    Icon: RiLockLine,
    title: "Isolation at the database",
    body: "Row Level Security on every table. A query without a tenant context returns nothing, so a missing WHERE clause is a 404 rather than someone else's customers.",
  },
  {
    Icon: RiBuildingLine,
    title: "Works past the demo size",
    body: "Tuned and tested against tens of thousands of leads per workspace. First paint stays flat because the list pages by keyset, not by OFFSET.",
  },
]

/**
 * One grid template for the header and every row, so the columns cannot drift — and a
 * different one per breakpoint, in a custom property rather than a media query, because a
 * template that is not identical for the header and the rows is exactly how they drift.
 *
 * Below `sm` the email column goes away entirely rather than shrinking. Four columns in a
 * 390px phone leaves about 70px each, which truncated every name and every address to
 * "Carmen C…" and "carmen@…" — the same decision the app's own RecordCards makes, for the
 * same reason: a half-width column is not a narrow column, it is a broken one.
 */
const PREVIEW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.6fr)]"

export default function LandingPage() {
  return (
    <main className="min-h-svh">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <span className="text-base font-semibold tracking-tight">Fold</span>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" render={<Link href="/sign-in" />}>
              Sign in
            </Button>
            <Button size="sm" render={<Link href="/sign-up" />}>
              Get started
            </Button>
          </nav>
        </div>
      </header>

      {/* `pt-24 pb-20` rather than a section rhythm: the hero gets room to breathe because
          it is the only thing on screen at this scroll position, and every section after
          it is shorter and closer. */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-20">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Every lead you have, and everything that happened to them.
          </h1>
          <p className="mt-6 text-lg text-pretty text-muted-foreground">
            Fold is a lead management CRM. Capture the lead, keep it current, and see who
            did what to it — without a second tool, a spreadsheet, or a tab you forget to
            open.
          </p>

          {/* gap-3 rather than gap-2: two buttons side by side at 32px need enough
              separation that a misclick picks the other one on purpose, not by accident. */}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button size="lg" render={<Link href="/sign-up" />}>
              Create a workspace
            </Button>
            <Button variant="outline" size="lg" render={<Link href="/sign-in" />}>
              Sign in
            </Button>
          </div>
        </div>

        <HeroPreview />
      </section>

      <section className="border-t border-border/60 bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            What it actually does
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground">
            Six things, all of them built and tested. Not a roadmap.
          </p>

          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-card p-6">
                <f.Icon className="size-5 text-muted-foreground" aria-hidden />
                <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-pretty text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          It takes about a minute to find out.
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-muted-foreground">
          Create a workspace, add a lead, attach a company, log a call. No card, no trial
          countdown, no sales call.
        </p>
        <div className="mt-8">
          <Button size="lg" render={<Link href="/sign-up" />}>
            Create a workspace
          </Button>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span>Fold</span>
          <nav className="flex items-center gap-4">
            <Link href="/sign-in" className="cursor-pointer hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="cursor-pointer hover:text-foreground">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}

/**
 * The hero visual.
 *
 * The rows are deliberately NOT links and carry no hover state. This app has one rule about
 * affordance — if it looks clickable it is clickable, and it says so with the cursor — and
 * a row that highlighted on hover and went nowhere would be the first lie on the page.
 */
function HeroPreview() {
  return (
    <div className="mt-16 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {/* A search box drawn, not rendered. A real input here would take focus on a
            marketing page, which is the one place nobody wants a text cursor. */}
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-sm text-muted-foreground">
          <RiSearchLine className="size-4" aria-hidden />
          Search name, email or domain
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">
          {PREVIEW.length.toLocaleString()} of 27,218
        </span>
      </div>

      <div
        className={cn(
          PREVIEW_COLUMNS,
          "items-center gap-4 border-b border-border bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground",
        )}
      >
        <span>Lead</span>
        <span className="hidden sm:block">Email</span>
        <span>Stage</span>
        <span className="text-right">Score</span>
      </div>

      {PREVIEW.map((row, i) => (
        <div
          key={row.email}
          className={cn(
            PREVIEW_COLUMNS,
            "items-center gap-4 px-4 py-3 text-sm",
            // border-t on every row but the first, rather than border-b on every row but
            // the last. Same result, and it cannot be wrong when a row is added.
            i > 0 && "border-t border-border/60",
          )}
        >
          <span className="truncate font-medium">{row.name}</span>
          <span className="hidden truncate text-muted-foreground sm:block">{row.email}</span>
          <span>
            <StageBadge stage={row.stage} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{row.score}</span>
        </div>
      ))}
    </div>
  )
}
