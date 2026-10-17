import { expect, test, type Page } from "@playwright/test"

import { API, authHeaders, seedLeads, signUp } from "./support"

/**
 * The people list, end to end, in a real browser.
 *
 * Every assertion here corresponds to a bug that survived curl: the API returning 401 to
 * a session with no active workspace, orval's relative URLs landing on Next, and a token
 * cache that stayed poisoned after one failed refresh.
 */

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
