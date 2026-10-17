import { expect, test, type Page } from "@playwright/test"

/**
 * Creating, editing and deleting a lead.
 *
 * All three endpoints existed from the first commit. None of them had a button — until
 * now the only write a browser could perform was attaching a company, and the only way to
 * move a lead through the pipeline was a PATCH by hand. These tests are the proof that
 * the product is writable, not just readable.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const PASSWORD = "smoke-test-password"

function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `crud-${stamp}@test.local`, password: PASSWORD }
}

async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Crud Tester")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Crud Roofing ${id.stamp}`)
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

const leadRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name })

test.describe("lead CRUD", () => {
  test("creates a lead from the browser and it appears in the list", async ({ page }) => {
    await signUp(page)
    await expect(page.getByText("No leads yet")).toBeVisible()

    // A link, because /people/new is a route. A dialog covers the list it came from.
    await page.getByRole("link", { name: /new lead/i }).click()
    await page.waitForURL("**/people/new")

    // A name is the minimum: a lead with neither name is unfindable afterwards.
    await expect(page.getByRole("button", { name: /create lead/i })).toBeDisabled()
    await page.getByLabel("First name").fill("Nia")
    await page.getByLabel("Last name").fill("Created")
    await page.getByLabel("Email").fill("nia@created.test")
    await page.getByRole("button", { name: /create lead/i }).click()
    // Saving lands on the new record — the thing you just made is what you want to see.
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nia")

    await page.goto("/people")
    await expect(leadRow(page, "Nia Created")).toBeVisible()
    await expect(page.getByRole("cell", { name: "nia@created.test" })).toBeVisible()

    // And it reached the database, not just the cache the mutation invalidated.
    const list = await (
      await page.request.get(`${API}/v1/persons`, { headers: await authHeaders(page) })
    ).json()
    expect(list.total).toBe(1)
    expect(list.items[0].firstName).toBe("Nia")
  })

  test("a last name alone is enough", async ({ page }) => {
    await signUp(page)
    await page.getByRole("link", { name: /new lead/i }).click()
    await page.waitForURL("**/people/new")

    await page.getByLabel("Last name").fill("Mononym")
    await expect(page.getByRole("button", { name: /create lead/i })).toBeEnabled()
    await page.getByRole("button", { name: /create lead/i }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await page.goto("/people")

    await expect(leadRow(page, "Mononym")).toBeVisible()
  })

  test("edits a lead and the change persists", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await page.getByRole("button", { name: /^edit$/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("First name").fill("Ines-Marie")
    await dialog.getByLabel("Job title").fill("Site Manager")
    await dialog.getByRole("button", { name: /save changes/i }).click()

    await expect(page.getByRole("heading", { name: "Ines-Marie Drawer" })).toBeVisible()

    const personId = await currentPersonId(page)
    const person = await (
      await page.request.get(`${API}/v1/persons/${personId}`, {
        headers: await authHeaders(page),
      })
    ).json()
    expect(person.firstName).toBe("Ines-Marie")
    expect(person.jobTitle).toBe("Site Manager")
  })

  test("moving the stage writes a stage change to the timeline", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await page.getByRole("button", { name: /^edit$/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Stage").click()
    await page.getByRole("option", { name: "Qualified", exact: true }).click()
    await dialog.getByRole("button", { name: /save changes/i }).click()

    // The whole point of the stage_change logging: doing the obvious thing in the UI is
    // what produces the history a rep reads later.
    await expect(page.getByText("Stage change")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Qualified").first()).toBeVisible()
  })

  test("clearing a field removes it rather than blanking it", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await page.getByRole("button", { name: /^edit$/i }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByLabel("Email")).toHaveValue(/ines-/)
    await dialog.getByLabel("Email").fill("")
    await dialog.getByRole("button", { name: /save changes/i }).click()

    // Wait for the dialog to close. RecordDialog only closes on success, so this is both
    // the completion signal and a failure check — without it the GET below races the PATCH
    // and reads the record as it was before the save. It failed in CI at 10ms of API
    // latency what the local 1ms hid.
    await expect(dialog).toHaveCount(0)

    const person = await (
      await page.request.get(`${API}/v1/persons/${await currentPersonId(page)}`, {
        headers: await authHeaders(page),
      })
    ).json()
    // Absent, not "". The SQL's NULLIF stores a real NULL, which is what the read path
    // renders as "—". Storing "" would be indistinguishable from a lead with no email.
    expect(person.email ?? null).toBeNull()
  })

  test("deletes a lead and it leaves the list", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)
    await seedLead(page, id.stamp, "Someone", "Else")

    await expect(leadRow(page, "Ines Drawer")).toBeVisible()

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    // Delete moved behind the record's overflow menu. It used to be a peer button beside
    // Edit, which put the most destructive control one misclick from the most common one
    // and rendered it in a pale pink that read as the secondary action.
    await page.getByRole("button", { name: /more actions/i }).click()
    await page.getByRole("menuitem", { name: /delete lead/i }).click()

    // The confirm has to say what actually happens. It is a soft delete, not a shredder.
    await expect(page.getByText(/nothing is destroyed/i)).toBeVisible()
    await page.getByRole("button", { name: /delete lead/i }).click()

    // A deleted record has nothing left to show, so it navigates back to the list.
    await page.waitForURL("**/people")
    await expect(leadRow(page, "Ines Drawer")).toHaveCount(0)
    await expect(leadRow(page, "Someone Else")).toBeVisible()
  })
})

async function seedLead(
  page: Page,
  stamp: string,
  firstName = "Ines",
  lastName = "Drawer",
) {
  const res = await page.request.post(`${API}/v1/persons`, {
    headers: await authHeaders(page),
    data: {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}-${stamp}@crud.test`,
    },
  })
  expect(res.ok(), `seeding ${firstName}: ${res.status()}`).toBeTruthy()
  await page.waitForTimeout(600)
}

async function currentPersonId(page: Page): Promise<string> {
  const list = await (
    await page.request.get(`${API}/v1/persons`, { headers: await authHeaders(page) })
  ).json()
  return list.items[0].id as string
}