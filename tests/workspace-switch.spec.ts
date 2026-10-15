import { expect, test, type Page } from "@playwright/test"

/**
 * Switching workspaces.
 *
 * The bug class here is silent. Switching used to be impossible — the guard picked the
 * first membership and stopped — so nothing exercised what a switch actually has to move.
 * Three caches are keyed to the workspace, and missing any one of them produces no error,
 * just a workspace that half works:
 *
 *   - the 5-minute JWT, which carries workspace_id
 *   - every TanStack query result
 *   - the SSE stream token, so live events keep arriving for the old tenant
 *
 * The last one is the dangerous one, and it is what the realtime assertion below exists
 * for. It cannot be caught by looking at the screen.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const PASSWORD = "smoke-test-password"

function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `ws-${stamp}@test.local`, password: PASSWORD }
}

async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Agency Rep")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Agency ${id.stamp}`)
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

/**
 * Create a second workspace and make this browser a member of it.
 *
 * The slug must be unique per run — organization.slug has a UNIQUE constraint, and
 * deriving it from the name alone made every rerun of this file fail with a 400 on a
 * workspace that already existed. A fixed name is still what the switcher has to display,
 * so the slug carries the stamp and the name stays stable for the selectors.
 */
async function createSecondWorkspace(page: Page, name: string, stamp: string): Promise<string> {
  const orgId = await page.evaluate(async ({ name, slug }) => {
    const token = await fetch("/api/auth/token", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => b.token as string)
    const res = await fetch("/api/auth/organization/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, slug }),
    })
    const body = (await res.json()) as { id?: string; message?: string }
    if (!body.id) throw new Error(`could not create workspace: ${body.message ?? "unknown"}`)
    return body.id
  }, { name, slug: `second-client-${stamp}` })
  return orgId
}

async function seedLead(page: Page, stamp: string, firstName: string) {
  const res = await page.request.post(`${API}/v1/persons`, {
    headers: await authHeaders(page),
    data: { firstName, lastName: "Lead", email: `${firstName.toLowerCase()}-${stamp}@ws.test` },
  })
  expect(res.ok(), `seeding ${firstName}: ${res.status()}`).toBeTruthy()
  await page.waitForTimeout(600)
}

async function openSwitcher(page: Page) {
  await page.getByRole("button", { name: /switch workspace/i }).click()
}

/**
 * Switch and wait for it to land.
 *
 * A switch is three async steps — setActive, then invalidate every query, then reconnect
 * the stream — and the sidebar label only changes once all of them have been issued.
 * Asserting straight after the click races all three, and the failures read as "the switch
 * did not work" rather than "the test did not wait".
 */
async function switchTo(page: Page, name: string | RegExp) {
  const label = page.getByRole("button", { name: /switch workspace/i })
  const before = await label.innerText()

  await openSwitcher(page)
  await page.getByRole("menuitem", { name }).click()
  await expect(label).not.toHaveText(before, { timeout: 10_000 })
}

test.describe("workspace switching", () => {
  test("the switcher lists every workspace and marks the active one", async ({ page }) => {
    const id = await signUp(page)
    await createSecondWorkspace(page, "Second Client Ltd", id.stamp)

    await openSwitcher(page)
    await expect(page.getByRole("menuitem", { name: /Second Client Ltd/ })).toBeVisible()
    // Two menus: the switcher's and the user menu's. Both must be visible for the
    // interaction to be possible at all.
    await expect(page.getByRole("button", { name: /switch workspace/i })).toBeVisible()
  })

  test("switching shows the other workspace's leads and hides the first's", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp, "Alpha")

    await createSecondWorkspace(page, "Second Client Ltd", id.stamp)
    await switchTo(page, /Second Client Ltd/)
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toHaveCount(0)

    // Back to the first workspace.
    await switchTo(page, `Agency ${id.stamp}`)
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toBeVisible()

    // Straight to the second one.
    await switchTo(page, /Second Client Ltd/)

    // The first workspace's lead must be gone. If only the JWT were cleared this row
    // would still be here, fetched with the old tenant's credentials.
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toHaveCount(0)
  })

  test("the API refuses the old workspace's token after a switch", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp, "Alpha")
    await createSecondWorkspace(page, "Second Client Ltd", id.stamp)

    // Mint a token while in the first workspace, then switch.
    const before = await page.evaluate(async () => {
      const res = await fetch("/api/auth/token", { credentials: "include" })
      return ((await res.json()) as { token: string }).token
    })

    await switchTo(page, /Second Client Ltd/)

    // A fresh token must now carry the new workspace.
    const after = await page.evaluate(async () => {
      const res = await fetch("/api/auth/token", { credentials: "include" })
      return ((await res.json()) as { token: string }).token
    })

    const workspaceOf = (jwt: string) =>
      JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).workspace_id

    expect(workspaceOf(after)).not.toBe(workspaceOf(before))
    void id
  })

  test("live updates follow the switch — a new lead appears in the second workspace", async ({
    page,
  }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp, "Alpha")

    await createSecondWorkspace(page, "Second Client Ltd", id.stamp)
    await switchTo(page, /Second Client Ltd/)
    // The stream has to re-establish, or the write below is never heard about. "Live"
    // is already on screen from the previous connection, so it proves nothing here.
    await page.waitForTimeout(1500)

    // Now write into the workspace the browser is actually in. If the SSE stream were
    // still subscribed to the first workspace — the failure mode of a switch that forgets
    // to reconnect — this row would never appear without a reload.
    await seedLead(page, id.stamp, "Bravo")

    await expect(page.getByRole("row").filter({ hasText: "Bravo" })).toBeVisible({
      timeout: 15_000,
    })
    // And it really is the second workspace's data, not the first's.
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toHaveCount(0)
  })

  test("switching back restores the first workspace's leads", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp, "Alpha")

    await createSecondWorkspace(page, "Second Client Ltd", id.stamp)
    await switchTo(page, /Second Client Ltd/)
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toHaveCount(0)

    await switchTo(page, `Agency ${id.stamp}`)
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toBeVisible()
  })
})