import { expect, test, type Page } from "@playwright/test"

/**
 * The lead record page: /people/{id}.
 *
 * The behaviour under test is the one thing curl cannot reach — that a log written
 * through the API appears on an open record without a reload, which is the realtime path
 * plus the TanStack invalidation doing its job.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const PASSWORD = "smoke-test-password"

function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `drawer-${stamp}@test.local`, password: PASSWORD }
}

async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Drawer Tester")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Drawer Roofing ${id.stamp}`)
  await page.getByLabel("Password").fill(id.password)
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })
  return id
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/api/auth/token`, { credentials: "include" })
    if (!res.ok) return null
    return ((await res.json()) as { token: string }).token
  }, process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:3000")

  expect(token, "browser session should be able to mint an API token").toBeTruthy()
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
}

async function seedLead(page: Page, stamp: string) {
  const res = await page.request.post(`${API}/v1/persons`, {
    headers: await authHeaders(page),
    data: { firstName: "Ines", lastName: "Drawer", email: `ines-${stamp}@drawer.test` },
  })
  expect(res.ok(), `seeding lead: ${res.status()}`).toBeTruthy()
  const { id } = (await res.json()) as { id: string }
  await page.waitForTimeout(600)
  return id
}

test.describe("lead record", () => {
  test("opens a lead at its own URL and shows an empty timeline", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    await expect(page.getByRole("heading", { level: 1, name: "Ines Drawer" })).toBeVisible()
    await expect(page.getByText("No activity yet")).toBeVisible()
  })

  test("logs a note and shows it in the timeline", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByText("No activity yet")).toBeVisible()

    await page.getByPlaceholder("Add a note").fill("Quoted three bundles of shingles.")
    await page.getByRole("button", { name: /log note/i }).click()

    await expect(page.getByText("Quoted three bundles of shingles.")).toBeVisible()
    // The empty state must give way to the feed, not sit above it.
    await expect(page.getByText("No activity yet")).toHaveCount(0)
  })

  test("a call logs without needing a direction", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    await page.getByRole("button", { name: "Call" }).click()
    await page.getByPlaceholder("What was said?").fill("Left voicemail, three attempts.")
    await page.getByRole("button", { name: /log call/i }).click()

    await expect(page.getByText("Left voicemail, three attempts.")).toBeVisible()
  })

  test("an email exposes direction and records it", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    // Direction is hidden until the kind is email — it is meaningless elsewhere.
    await expect(page.getByRole("button", { name: "Inbound" })).toHaveCount(0)

    await page.getByRole("button", { name: "Email" }).click()
    await expect(page.getByRole("button", { name: "Inbound" })).toBeVisible()

    await page.getByRole("button", { name: "Inbound" }).click()
    await page.getByPlaceholder("Subject or summary").fill("Re: quote request")
    await page.getByRole("button", { name: /log email/i }).click()

    await expect(page.getByText("Re: quote request")).toBeVisible()

    // Scoped to the timeline. Once the entry is written, "Inbound" appears twice — the
    // composer's direction toggle and the recorded row — so an unscoped getByText is a
    // strict-mode violation. It only bit in CI because a sheet covered the feed while the
    // composer was open; the page shows both at once.
    const feed = page.getByRole("list")
    await expect(feed.getByText("Inbound")).toBeVisible()
  })

  test("an empty note cannot be submitted", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    // Whitespace is not a note. Submitting an empty one writes a row nobody can read.
    await page.getByPlaceholder("Add a note").fill("   ")
    await expect(page.getByRole("button", { name: /log note/i })).toBeDisabled()
  })

  test("a stage change lands in the timeline, but a no-op edit does not", async ({ page }) => {
    const id = await signUp(page)
    const personId = await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByText("No activity yet")).toBeVisible()

    // A stage move is the most important thing that happens to a lead. If PATCH does not
    // write an activity, the feed silently omits every qualification decision.
    await page.request.patch(`${API}/v1/persons/${personId}`, {
      headers: await authHeaders(page),
      data: { lifecycleStage: "customer" },
    })
    await expect(page.getByText("Stage change")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("new").first()).toBeVisible()
    await expect(page.getByText("customer").first()).toBeVisible()

    // Re-sending the same stage is not a change, and a non-stage edit is not a stage
    // change. Neither may add a row, or the feed fills with noise and stops being read.
    await page.request.patch(`${API}/v1/persons/${personId}`, {
      headers: await authHeaders(page),
      data: { lifecycleStage: "customer" },
    })
    await page.request.patch(`${API}/v1/persons/${personId}`, {
      headers: await authHeaders(page),
      data: { jobTitle: "Regional Manager" },
    })
    await page.waitForTimeout(1200)
    await expect(page.getByText("Stage change")).toHaveCount(1)
  })

  test("a record that does not exist says so instead of rendering an empty shell", async ({
    page,
  }) => {
    await signUp(page)
    // A stale link, or a record deleted in another tab. The page must not hang on a
    // spinner or crash — it has nothing to show and says why.
    await page.goto("/people/11111111-1111-4111-8111-111111111111")
    await expect(page.getByText("This lead is not here")).toBeVisible({ timeout: 15_000 })
  })

  test("the browser back button returns to the list", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { level: 1, name: "Ines Drawer" })).toBeVisible()

    // The drawer could not do this, which was half the reason for the route.
    await page.goBack()
    await page.waitForURL("**/people")
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible()
  })

  test("an activity logged elsewhere appears without a reload", async ({ page }) => {
    const id = await signUp(page)
    // The same id the drawer will be opened on. Logging against a different record with
    // the same name would test nothing.
    const personId = await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByText("No activity yet")).toBeVisible()

    // Written straight through the API rather than the form, standing in for a
    // teammate. The open drawer must pick it up over SSE — the assertion curl cannot
    // make.
    await page.request.post(`${API}/v1/persons/${personId}/activities`, {
      headers: await authHeaders(page),
      data: { kind: "call", body: "Called from the field crew." },
    })

    await expect(page.getByText("Called from the field crew.")).toBeVisible({ timeout: 15_000 })
  })
})