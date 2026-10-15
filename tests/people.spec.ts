import { expect, test, type Page } from "@playwright/test"

/**
 * The people list, end to end, in a real browser.
 *
 * Every assertion here corresponds to a bug that survived curl: the API returning 401 to
 * a session with no active workspace, orval's relative URLs landing on Next, and a token
 * cache that stayed poisoned after one failed refresh.
 */

const API = process.env.API_URL ?? "http://localhost:8080"

/**
 * Scope assertions to a table row.
 *
 * Addressing a bare cell by name is ambiguous here: the Lead column renders "Ada
 * Lovelace" and the Email column renders "ada@seed.test", so getByRole("cell", {name:
 * "Ada"}) matches both and Playwright refuses to guess. Scoping to the row keeps the
 * assertion about the record rather than about one column.
 */
const row = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name })

type SeedRow = {
  firstName: string
  lastName: string
  email?: string
  lifecycleStage?: string
}

const PASSWORD = "smoke-test-password"

/**
 * A fresh identity per call.
 *
 * Module-level constants looked tidy and were wrong: five tests shared one email, so
 * only the first sign-up could succeed and the rest failed on "user already exists".
 * Each test needs its own account, and its own workspace.
 */
function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `smoke-${stamp}@test.local`, password: PASSWORD }
}

/**
 * Sign up through the real form, not the API.
 *
 * Driving the UI is the whole point: it exercises the exact calls the browser makes,
 * including any that curl would happily forge differently.
 */
async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Smoke Tester")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Smoke Roofing ${id.stamp}`)
  await page.getByLabel("Password").fill(id.password)
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })
  return id
}

test.describe("people list", () => {
  test("signs up, shows the workspace, and renders rows", async ({ page }) => {
    const consoleErrors: string[] = []
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text())
    })

    const id = await signUp(page)

    // The workspace was created and activated by the sign-up flow. A missing workspace
    // here means every later API call is a 401 and the app looks empty.
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible()

    // Realtime must actually connect. This is the assertion that catches a poisoned
    // token cache, missing CORS, and a relative-URL mutator — all three produce an
    // Offline badge and no data while every curl check still passes.
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

    // Seed through the Go API so the table has something to render.
    const created = await seedLeads(page, id)

    for (const name of created) {
      await expect(row(page, name)).toBeVisible()
    }

    // header + the seeded rows
    expect(await page.getByRole("row").count()).toBeGreaterThanOrEqual(created.length + 1)

    expect(consoleErrors, "browser console should be clean").toHaveLength(0)
  })

  test("filters by stage", async ({ page }) => {
    const id = await signUp(page)
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

    await seedLeads(page, id, [
      { firstName: "Ana", lastName: "Qualified", lifecycleStage: "qualified" },
      { firstName: "Ben", lastName: "Fresh", lifecycleStage: "new" },
    ])

    await page.getByRole("button", { name: "New", exact: true }).click()

    await expect(row(page, "Ben Fresh")).toBeVisible()
    await expect(row(page, "Ana Qualified")).toHaveCount(0)
  })

  test("search finds a lead by email fragment", async ({ page }) => {
    const id = await signUp(page)
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

    await seedLeads(page, id, [
      { firstName: "Cara", lastName: "Target", email: `cara-${id.stamp}@northwind.test` },
      { firstName: "Dan", lastName: "Other", email: `dan-${id.stamp}@elsewhere.test` },
    ])

    await page.getByPlaceholder(/search name, email or domain/i).fill(`northwind-${id.stamp}`)
    await expect(row(page, "Cara Target")).toBeVisible()
    await expect(row(page, "Dan Other")).toHaveCount(0)
  })

  test("a new lead appears without a reload", async ({ page }) => {
    const id = await signUp(page)
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

    // No reload, no click. If the stream is dead this is the assertion that fails.
    await seedLeads(page, id, [{ firstName: "Eve", lastName: "Realtime", email: `eve-${id.stamp}@push.test` }])

    await expect(row(page, "Eve Realtime")).toBeVisible({ timeout: 15_000 })
  })

  test("signing out then back in still reaches the workspace", async ({ page }) => {
    const id = await signUp(page)
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole("button", { name: /Smoke Tester/i }).click()
    await page.getByRole("menuitem", { name: /sign out/i }).click()
    await page.waitForURL("**/sign-in")

    // A fresh session must still be scoped to a workspace. This is the regression that
    // left a signed-in user staring at an empty table with an Offline badge.
    await page.getByLabel("Email").fill(id.email)
    await page.getByLabel("Password").fill(id.password)
    await page.getByRole("button", { name: /^sign in$/i }).click()
    await page.waitForURL("**/people", { timeout: 20_000 })

    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })
  })
})

/**
 * Insert leads straight into the Go API using the browser's own session.
 *
 * Using the API rather than the UI keeps the test about what it is testing — the read
 * path and the realtime stream — without hard-coding a "New lead" form that does not
 * exist yet.
 */
async function seedLeads(
  page: Page,
  identity: { stamp: string },
  rows?: SeedRow[],
) {
  const { stamp } = identity
  const fallback: SeedRow[] = [
    { firstName: "Ada", lastName: "Lovelace", lifecycleStage: "qualified" },
    { firstName: "Alan", lastName: "Turing", lifecycleStage: "new" },
    { firstName: "Grace", lastName: "Hopper", lifecycleStage: "contacted" },
  ]
  const list = rows ?? fallback

  const names: string[] = []
  for (const seed of list) {
    const email = seed.email ?? `${seed.firstName.toLowerCase()}-${stamp}@seed.test`
    const res = await page.request.post(`${API}/v1/persons`, {
      headers: await authHeaders(page),
      data: { ...seed, email, source: "smoke-test" },
    })
    expect(res.ok(), `seeding ${seed.firstName}: ${res.status()}`).toBeTruthy()
    names.push(seed.firstName)
  }

  // The list is keyedset-ordered by created_at DESC, so give the invalidation a beat to
  // land before the caller asserts on rows.
  await page.waitForTimeout(600)
  return names
}

/** Mint the same JWT the app would, using the browser's session cookie. */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/api/auth/token`, { credentials: "include" })
    if (!res.ok) return null
    const body = await res.json()
    return body.token as string | null
  }, process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:3000")

  expect(token, "browser session should be able to mint an API token").toBeTruthy()
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
}