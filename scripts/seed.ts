/**
 * Fill a workspace with a realistic-looking CRM.
 *
 *   bun run seed              # new workspace, 24 companies, 420 leads
 *   LEADS=200 bun run seed    # fewer
 *   SEED_EMAIL=… SEED_PASSWORD=… bun run seed   # add to the one you already have
 *
 * It goes through the same HTTP API the browser uses, on purpose. Seeding with SQL would
 * be faster and would prove nothing — this way the run exercises tenancy, validation and
 * the notify path, and anything it trips over is a real bug rather than a gap in the
 * script. It is also why the script is ~150 lines and not 40.
 */

export {} // top-level await requires a module

const WEB = process.env.WEB_URL ?? "http://localhost:3000"
const API = process.env.API_URL ?? "http://localhost:8080"
const LEADS = Number(process.env.LEADS ?? 420)
const COMPANIES = Number(process.env.COMPANIES ?? 24)
const ACTIVITY_EVERY = Number(process.env.ACTIVITY_EVERY ?? 4)

// ---------------------------------------------------------------- vocabulary

const FIRST = [
  "Amara", "Bo", "Camila", "Dmitri", "Elena", "Farid", "Grace", "Hana", "Idris",
  "Ingrid", "Jae-won", "Kofi", "Lucia", "Mateo", "Nadia", "Omar", "Priya", "Quinn",
  "Rafael", "Sofia", "Tomas", "Uma", "Viktor", "Wren", "Xiulan", "Yusuf", "Zara",
  "Adaeze", "Bjorn", "Carmen", "Dario", "Esme", "Fionn", "Gita", "Hiro", "Imani",
  "Joaquin", "Kwame", "Leila", "Mira", "Niall", "Oksana", "Pablo", "Rina",
]

const LAST = [
  "Abiodun", "Bergstrom", "Castellanos", "Duarte", "Eriksen", "Fontaine",
  "Gallagher", "Haddad", "Ibarra", "Jelinek", "Kowalczyk", "Laurent", "Moreau",
  "Nakamura", "Okonkwo", "Pereira", "Quintero", "Rasmussen", "Solberg", "Tanaka",
  "Ustinov", "Vasquez", "Whitfield", "Ximenes", "Yamamoto", "Zieliński",
  "Abernathy", "Baptiste", "Chaudhry", "Delacroix", "Espinoza", "Fitzgerald",
  "Grimaldi", "Hollis", "Ivanova", "Jørgensen", "Kaminski", "Lindqvist",
  "Mbeki", "Novotný",
]

/** Weighted so the funnel looks like a funnel. Order is the draw order. */
const STAGES: string[] = [
  ...Array<string>(40).fill("new"),
  ...Array<string>(22).fill("contacted"),
  ...Array<string>(16).fill("qualified"),
  ...Array<string>(12).fill("customer"),
  ...Array<string>(6).fill("disqualified"),
]

const SOURCES = [
  "Website form", "Website form", "Referral", "Referral", "Cold outreach",
  "Conference", "LinkedIn", "Webinar", "Partner",
]

const TITLES = [
  "Head of Operations", "Operations Manager", "Facilities Manager", "Site Manager",
  "Procurement Lead", "Construction Manager", "Project Engineer", "Estimating Manager",
  "Commercial Director", "Finance Manager", "Owner", "General Manager", "Superintendent",
  "Quality Manager", "Contracts Manager", "Pre-construction Manager",
  "Regional Sales Manager", "Account Executive", "Director of Sales",
]

const COMPANIES_ = [
  ["Northside Roofing", "roofing", "Roofing & Exteriors", "51-200", "Denver, Colorado"],
  ["Cascade Civil Works", "cascadecivil", "Civil Engineering", "201-500", "Portland, Oregon"],
  ["Meridian Build Group", "meridianbuild", "General Contracting", "501-1000", "Austin, Texas"],
  ["Harbor Point Marine", "harborpoint", "Marine Construction", "51-200", "Norfolk, Virginia"],
  ["Ironvale Steel", "ironvale", "Steel Fabrication", "201-500", "Pittsburgh, Pennsylvania"],
  ["Lakeshore Concrete", "lakeshoreconcrete", "Ready-Mix Concrete", "51-200", "Chicago, Illinois"],
  ["Tinder & Oak Restoration", "tinderoak", "Historic Restoration", "11-50", "Savannah, Georgia"],
  ["Summit Ridge Roofing", "summitridge", "Roofing & Exteriors", "51-200", "Boise, Idaho"],
  ["Copperfield Mechanical", "copperfieldmech", "HVAC & Mechanical", "201-500", "Phoenix, Arizona"],
  ["Granite Line Rail", "graniteline", "Rail Infrastructure", "1000+", "Omaha, Nebraska"],
  ["Blue Heron Roofing", "blueheronroofing", "Roofing & Exteriors", "11-50", "Tampa, Florida"],
  ["Foundry 9 Fabrication", "foundry9", "Metal Fabrication", "51-200", "Cleveland, Ohio"],
  ["Palmetto Sitework", "palmetto", "Excavation & Site Work", "51-200", "Charleston, South Carolina"],
  ["Kestrel Roofing Systems", "kestrelroofing", "Roofing & Exteriors", "201-500", "Raleigh, North Carolina"],
  ["Anvil & Beam", "anvilbeam", "Structural Steel", "11-50", "Pittsburgh, Pennsylvania"],
  ["Willow Bend Lumber", "willowbend", "Lumber & Timber", "51-200", "Eugene, Oregon"],
  ["Saltgrass Roofing Co", "saltgrassroofing", "Roofing & Exteriors", "11-50", "Corpus Christi, Texas"],
  ["Quarry Road Aggregates", "quarryroad", "Aggregates & Quarrying", "201-500", "Denver, Colorado"],
  ["Brightwater Plumbing", "brightwater", "Plumbing Services", "11-50", "Tacoma, Washington"],
  ["Redstone Commercial", "redstonecomm", "Commercial Real Estate", "501-1000", "Nashville, Tennessee"],
  ["Fenwick Roofing", "fenwickroofing", "Roofing & Exteriors", "11-50", "Hartford, Connecticut"],
  ["Stonegate Restoration", "stonegate", "Historic Restoration", "51-200", "Boston, Massachusetts"],
  ["Thornfield Roofing", "thornfield", "Roofing & Exteriors", "51-200", "Madison, Wisconsin"],
  ["Emberline Fireproofing", "emberline", "Fireproofing", "11-50", "Phoenix, Arizona"],
] as const

const NOTES = [
  "Quoted three bundles of architectural shingles, underlayment and 40 linear feet of flashing. Sent Friday.",
  "Wants the tear-off labour itemised separately from the materials. Resent the estimate with a breakdown.",
  "Site is a 1970s property with two layers already down. Flagged the deck condition in photos.",
  "Called about the warranty on the flashing we installed last spring. Said it is holding but the sealant is lifting.",
  "Prefers a single point of contact. Forwarded everything to their operations lead.",
  "Budget is approved for Q3. Asked us to hold the current pricing through the end of the quarter.",
  "Said a competitor quoted 15% lower. Challenged on the warranty length rather than matching.",
  "Inspection report came back with two items. Crew is out Thursday to address them.",
  "Asked for references on a job of similar size. Sent three.",
  "Payment terms moved to net 45 after their finance team reviewed the credit application.",
]

const CALLS = [
  "Left a voicemail with the office. Will try the mobile after the site visit.",
  "Walked through the scope. They already have a roof plan drawn up, which saved ten minutes.",
  "Discussed the timeline. Weather window closes in about three weeks, so they want to move now.",
  "Confirmed the crew is booked for the 14th. Asked them to clear the driveway.",
  "No answer. Left a message with the receptionist.",
]

const EMAILS = [
  { direction: "inbound", body: "Re: quote request — can you add the tear-off labour separately?" },
  { direction: "outbound", body: "Estimate attached. Happy to walk through it on a call if easier." },
  { direction: "inbound", body: "The inspection flagged two items. When can the crew come out?" },
  { direction: "outbound", body: "Confirming Thursday 9am. Please have the driveway clear." },
  { direction: "inbound", body: "Approved. Send the paperwork and we will get this scheduled." },
]

// ---------------------------------------------------------------- helpers

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

/** Stable per-run variety, so two seeds do not produce identical data. */
function shuffled<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

async function json<T>(res: Response): Promise<T> {
  const body = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  return JSON.parse(body) as T
}

/** Bounded concurrency. Enough to be quick, low enough not to look like a load test. */
async function pool<T>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<void>,
) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        await run(items[index], index)
      }
    }),
  )
}

// ---------------------------------------------------------------- auth

/**
 * Sign in when told to, otherwise make a workspace.
 *
 * Re-runnable on purpose: seeding the same workspace twice should give you 840 leads,
 * not a second workspace you have to go and find.
 */
async function authenticate(): Promise<{
  token: string
  orgId: string
  account: string
  password: string
}> {
  const jar: string[] = []
  const cookie = () => jar.join("; ")

  const remember = (res: Response) => {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0]
      const name = pair.slice(0, pair.indexOf("="))
      // Replace, do not append. setActive rewrites the session cookie, and a jar that
      // keeps both sends `session_token=old; session_token=new` — the server reads the
      // first, so setActive returns 200, activeOrganizationId comes back null, and the
      // JWT carries an empty workspace_id. Two identical-looking failures, one cause.
      const at = jar.findIndex((c) => c.startsWith(`${name}=`))
      if (at === -1) jar.push(pair)
      else jar[at] = pair
    }
  }

  const email = process.env.SEED_EMAIL
  const password = process.env.SEED_PASSWORD ?? "seed-password-123"

  // A function, not a value: an object literal evaluates cookie() once — before
  // sign-up, while the jar was still empty — and every later call goes out
  // unauthenticated. Better Auth answers 401 for organization/create with no explanation.
  //
  // The Origin header is not optional either: without it the answer is a 403
  // MISSING_OR_NULL_ORIGIN before credentials are even looked at.
  const origin = () => ({
    "Content-Type": "application/json",
    Origin: WEB,
    cookie: cookie(),
  })

  const signIn = () =>
    fetch(`${WEB}/api/auth/sign-in/email`, {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({ email, password }),
    })

  const signUp = () =>
    fetch(`${WEB}/api/auth/sign-up/email`, {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({
        email: email ?? `seed-${Date.now().toString(36)}@fold.test`,
        password,
        name: "Avery Rep",
      }),
    })

  // Seeded with a fixed SEED_EMAIL the second run adds to the workspace you already have
  // rather than making another one, so there is somewhere stable to log in. First run
  // falls back to sign-up, because the account cannot exist yet.
  let res = email ? await signIn() : await signUp()
  if (email && !res.ok) res = await signUp()
  remember(res)

  if (!res.ok) {
    throw new Error(
      `auth failed: ${res.status} ${await res.text()}\n` +
        (email
          ? "SEED_EMAIL was set and neither signing in nor signing up worked."
          : ""),
    )
  }
  // sign-in answers {user}, sign-up answers {token, user}. Read the user object and fall
  // back to what we asked for, since printing "undefined" as the login is no use.
  const body = (await res.clone().json().catch(() => ({}))) as {
    email?: string
    user?: { email?: string }
  }
  const account = email ?? body.user?.email ?? body.email ?? "(unknown)"
  console.log(`  signed in as ${account}`)

  // A session with no active workspace produces a JWT with an empty workspace_id, and the
  // Go API answers 401 for every call with no explanation. Gated on the session rather
  // than on which route we just took, so signing in to a brand new account — where the
  // sign-in fails and sign-up takes over — gets a workspace too.
  const readSession = async () =>
    json<{ session: { activeOrganizationId: string | null } }>(
      await fetch(`${WEB}/api/auth/get-session`, {
        headers: { cookie: cookie(), Origin: WEB },
      }),
    )

  // Adopt an existing workspace before creating one.
  //
  // Signing in never sets an active organization — only /organization/set-active does —
  // so `activeOrganizationId` is null for any fresh session even on an account that has
  // had a workspace for months. The old check read that null as "no workspace" and made a
  // second one, so `SEED_EMAIL` at an existing account seeded into an empty org while the
  // real data sat in the first. Symptom: the list shows 3 leads and the workspace you
  // thought you were in has 20,000 somewhere else.
  if (!(await readSession()).session.activeOrganizationId) {
    const existing = await json<{ organizations?: { id: string; name: string }[] }>(
      await fetch(`${WEB}/api/auth/organization/list`, {
        headers: { cookie: cookie(), Origin: WEB },
      }),
    )

    if (existing.organizations?.length) {
      // Newest first, because a second seed run is pointed at the workspace it just made.
      const pick = existing.organizations[existing.organizations.length - 1]
      console.log(`  using existing workspace ${pick.name}`)
      const adopted = await fetch(`${WEB}/api/auth/organization/set-active`, {
        method: "POST",
        headers: origin(),
        body: JSON.stringify({ organizationId: pick.id }),
      })
      remember(adopted)
      if (!adopted.ok) throw new Error(`setActive failed: ${await adopted.text()}`)
    }
  }

  if (!(await readSession()).session.activeOrganizationId) {
    const created = await fetch(`${WEB}/api/auth/organization/create`, {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({
        name: process.env.SEED_COMPANY ?? "Northwind Roofing",
        slug: `demo-${Date.now().toString(36)}`,
      }),
    })
    remember(created)
    if (!created.ok) throw new Error(`workspace create failed: ${created.status} ${await created.text()}`)

    const activated = await fetch(`${WEB}/api/auth/organization/set-active`, {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({ organizationId: (await json<{ id: string }>(created)).id }),
    })
    remember(activated)
    if (!activated.ok) throw new Error(`setActive failed: ${await activated.text()}`)
  }

  // Minted last: the JWT embeds workspace_id, so it has to be after setActive.
  const { token } = await json<{ token: string }>(
    await fetch(`${WEB}/api/auth/token`, { headers: { cookie: cookie(), Origin: WEB } }),
  )
  const { session } = await readSession()

  return { token, orgId: session.activeOrganizationId as string, account, password }
}

// ---------------------------------------------------------------- seed

const auth = { token: "" }
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

const started = Date.now()

console.log(`Seeding ${WEB} → ${API}`)

const { token, account, password } = await authenticate()
auth.token = token
console.log("  signed in")

// Companies. The domain travels with the id, because a lead's email has to be at the
// company it is attached to — otherwise "search by domain" returns people at a firm they
// are not at, which is worse than having no demo data at all.
const companies: { id: string; domain: string }[] = []
// Cycle the name list rather than slicing it. The old  silently
// capped at the list length, so COMPANIES=400 produced 24 with no warning and the
// setting looked broken rather than capped.
if (COMPANIES > COMPANIES_.length) {
  console.log(
    `  only \`${COMPANIES_.length}\` company names are defined; cycling them to \`${COMPANIES}\``,
  )
}
// The domain gets a suffix on every cycle, because leads are assigned to a company by
// looking its domain up. 400 companies built from 24 names would put 376 leads on the
// same company and quietly make the distribution meaningless.
const companyNames = Array.from({ length: COMPANIES }, (_, i) => {
  const row = COMPANIES_[i % COMPANIES_.length]
  const cycle = Math.floor(i / COMPANIES_.length)
  return cycle === 0 ? row : [row[0], `${row[1]}-${cycle}`]
})

await pool(companyNames, 6, async (row) => {
  const [name, domain, industry, size, location] = row
  const created = await json<{ company: { id: string } }>(
    await call("/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name, domain: `${domain}.test`, industry, size, location }),
    }),
  )
  companies.push({ id: created.company.id, domain: `${domain}.test` })
})
// The pool races, so insertion order is whatever finished first. Sorting means leads
// spread evenly instead of the first company taking the earliest replies.
companies.sort((a, b) => a.id.localeCompare(b.id))
console.log(`  ${companies.length} companies`)

// Leads. Names are drawn without replacement per run, so a 420-lead workspace does not
// show the same four people over and over.
const first = shuffled(FIRST)
const last = shuffled(LAST)
const leads = Array.from({ length: LEADS }, (_, i) => {
  const company = companies[i % companies.length]
  const firstName = first[i % first.length]
  const lastName = last[i % last.length]

  return {
    companyId: company.id,
    firstName,
    lastName,
    jobTitle: pick(TITLES),
    lifecycleStage: pick(STAGES),
    source: pick(SOURCES),
    email: `${firstName}.${slug(lastName)}@${company.domain}`,
  }
})

/** Diacritics out of an email local part: "Zieliński" is not a valid mailbox. */
function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "")
}

const created: string[] = []
await pool(leads, 12, async (lead) => {
  // POST /v1/persons answers with the Person itself, not { person }. The company
  // endpoint nests it. Reading the wrong one gives undefined and no error.
  const person = await json<{ id: string }>(
    await call("/v1/persons", { method: "POST", body: JSON.stringify(lead) }),
  )
  created.push(person.id)
})
created.sort()
console.log(`  ${created.length} leads`)

// Activity, so timelines are not all empty. Spread over weeks so the list reads as a
// history rather than everything landing at once.
let logged = 0
await pool(created, 8, async (id, i) => {
  if (i % ACTIVITY_EVERY !== 0) return
  const kind = pick(["note", "call", "email"] as const)
  const body =
    kind === "note"
      ? { kind, body: pick(NOTES), happensAt: daysAgo(Math.floor(Math.random() * 60)) }
      : kind === "call"
        ? { kind, body: pick(CALLS), happensAt: daysAgo(Math.floor(Math.random() * 45)) }
        : {
            kind,
            ...pick(EMAILS),
            happensAt: daysAgo(Math.floor(Math.random() * 30)),
          }

  await call(`/v1/persons/${id}/activities`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  logged++
})
console.log(`  ${logged} activities`)

const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\nDone in ${secs}s — ${WEB}/people`)
console.log(`Log in with  ${account}  /  ${password}`)

// Honest note: score has no write path in the API. Every handler reads it and none sets
// it, so seeded leads sit at 0 and the Score column renders its em-dash. Fixing that
// means adding a way to set it, which is a product decision rather than a seed concern.
console.log("Note: Score is read-only in the API today, so it shows 0 (—) everywhere.")
