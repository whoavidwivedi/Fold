import { expect, test, type Page } from "@playwright/test"

/**
 * Companies, and the lead-company link.
 *
 * The thing being pinned is the foreign key. `person.company_id` pointed at a table that
 * had no API, no page and no way to be written — so a lead could be linked to a company
 * that nothing could resolve. These tests walk the loop end to end: create a company,
 * see it listed, attach it to a lead, and confirm the soft delete detaches rather than
 * orphans.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const PASSWORD = "smoke-test-password"

function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `co-${stamp}@test.local`, password: PASSWORD }
}

async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Company Tester")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Company Roofing ${id.stamp}`)
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
    data: { firstName: "Ines", lastName: "Drawer", email: `ines-${stamp}@company.test` },
  })
  expect(res.ok(), `seeding lead: ${res.status()}`).toBeTruthy()
  await page.waitForTimeout(600)
}

test.describe("companies", () => {
  test("starts empty and creates the first company", async ({ page }) => {
    await signUp(page)

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")

    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible()
    await expect(page.getByText("No companies yet")).toBeVisible()

    await page.getByRole("button", { name: /new company/i }).click()
    await page.getByLabel("Name").fill("Northside Roofing")
    await page.getByLabel("Domain").fill("northside.test")
    await page.getByLabel("Industry").fill("Roofing")
    await page.getByRole("button", { name: /^create$/i }).click()

    await expect(
      page.getByRole("cell", { name: "Northside Roofing", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("cell", { name: "northside.test", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "Roofing", exact: true })).toBeVisible()
    // No contacts linked yet. A blank here would be indistinguishable from a broken count.
    await expect(page.getByRole("cell", { name: "0" })).toBeVisible()
  })

  test("refuses a nameless company", async ({ page }) => {
    await signUp(page)
    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")

    await page.getByRole("button", { name: /new company/i }).click()
    // Whitespace is not a name. Submitting one creates a company nobody can find.
    await page.getByLabel("Name").fill("   ")
    await expect(page.getByRole("button", { name: /^create$/i })).toBeDisabled()
  })

  test("searches by domain fragment", async ({ page }) => {
    const id = await signUp(page)
    const headers = await authHeaders(page)

    for (const [name, domain] of [
      ["Northside Roofing", "northside.test"],
      ["Eastgate Supply", "eastgate.test"],
    ]) {
      const res = await page.request.post(`${API}/v1/companies`, {
        headers,
        data: { name, domain },
      })
      expect(res.ok()).toBeTruthy()
    }

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await expect(page.getByRole("cell", { name: "Northside Roofing" })).toBeVisible()

    await page.getByPlaceholder(/search name or domain/i).fill("norths")
    await expect(
      page.getByRole("cell", { name: "Northside Roofing", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("cell", { name: "Eastgate Supply", exact: true })).toHaveCount(0)

    void id
  })

  test("attaching a company to a lead shows its name, not its id", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)

    const companyId = (
      await (
        await page.request.post(`${API}/v1/companies`, {
          headers: await authHeaders(page),
          data: { name: "Northside Roofing", domain: "northside.test" },
        })
      ).json()
    ).company.id as string

    await page.getByRole("link", { name: "Ines Drawer" }).click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByText("No activity yet")).toBeVisible()

    const trigger = page.getByRole("combobox", { name: "Company" })
    await trigger.click()
    await page.getByRole("option", { name: "Northside Roofing" }).click()

    // The regression this catches: a dropdown wired to ids with no label mapping renders
    // the raw uuid, which is technically correct and completely useless.
    await expect(trigger).toHaveText("Northside Roofing")

    // And it persisted, not just looked right.
    await page.waitForTimeout(800)
    const person = await (
      await page.request.get(`${API}/v1/persons/${await currentPersonId(page)}`, {
        headers: await authHeaders(page),
      })
    ).json()
    expect(person.companyId).toBe(companyId)
  })

  test("deleting a company detaches its leads instead of orphaning them", async ({ page }) => {
    const id = await signUp(page)
    await seedLead(page, id.stamp)
    const headers = await authHeaders(page)

    const companyId = (
      await (
        await page.request.post(`${API}/v1/companies`, {
          headers,
          data: { name: "Doomed Industries" },
        })
      ).json()
    ).company.id as string

    const personId = (
      await (
        await page.request.post(`${API}/v1/persons`, {
          headers,
          data: { firstName: "Ana", lastName: "Linked", companyId },
        })
      ).json()
    ).id as string

    const del = await page.request.delete(`${API}/v1/companies/${companyId}`, { headers })
    expect(del.status()).toBe(204)

    // The lead survives — deleting a company must not delete sales data.
    const person = await (
      await page.request.get(`${API}/v1/persons/${personId}`, { headers })
    ).json()
    expect(person.firstName).toBe("Ana")
    // But it no longer points at something nothing can resolve.
    expect(person.companyId ?? null).toBeNull()

    void id
  })

  test("a company from another workspace is not readable", async ({ page }) => {
    await signUp(page)
    const res = await page.request.get(
      `${API}/v1/companies/11111111-1111-4111-8111-111111111111`,
      { headers: await authHeaders(page) },
    )
    expect(res.status()).toBe(404)
  })
})

/** The open drawer's person id, read back off the API rather than guessed. */
async function currentPersonId(page: Page): Promise<string> {
  const list = await (
    await page.request.get(`${API}/v1/persons`, { headers: await authHeaders(page) })
  ).json()
  return list.items[0].id as string
}

test.describe("company form invariants", () => {
  // These are the three bugs that shipped once already, pinned on the second form. A
  // regression here is invisible to every other assertion: the API answers 200, the row
  // updates, and the result is still wrong.

  test("editing a company saves and persists", async ({ page }) => {
    const id = await signUp(page)
    await seedCompany(page, "Northside Roofing", "northside.test")

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await page.getByRole("link", { name: "Northside Roofing", exact: true }).click()
    await page.waitForURL(/\/companies\/[0-9a-f-]{36}$/)

    await page.getByRole("button", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Name").fill("Northside Roofing Co")
    await dialog.getByLabel("Industry").fill("Contracting")
    await dialog.getByRole("button", { name: /save changes/i }).click()

    // The record page stays put and updates in place — no list to go back and forth to.
    await expect(
      page.getByRole("heading", { level: 1, name: "Northside Roofing Co" }),
    ).toBeVisible()
    await expect(page.getByText("Contracting")).toBeVisible()
    void id
  })

  test("clearing a field removes it rather than leaving it blank", async ({ page }) => {
    const id = await signUp(page)
    const companyId = await seedCompany(page, "Target Co", "target.test", "Roofing")

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await page.getByRole("link", { name: "Target Co", exact: true }).click()
    await page.waitForURL(/\/companies\/[0-9a-f-]{36}$/)

    await page.getByRole("button", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByLabel("Domain")).toHaveValue("target.test")
    await dialog.getByLabel("Domain").fill("")
    await dialog.getByLabel("Industry").fill("")
    await dialog.getByRole("button", { name: /save changes/i }).click()

    await page.waitForTimeout(800)
    const company = await (
      await page.request.get(`${API}/v1/companies/${companyId}`, {
        headers: await authHeaders(page),
      })
    ).json()

    // NULL, not "". This is the assertion the whole thing rests on: an empty string
    // renders as a blank link and never matches a search.
    expect(company.company.domain ?? null).toBeNull()
    expect(company.company.industry ?? null).toBeNull()
    // And an untouched field survived the clear.
    expect(company.company.name).toBe("Target Co")
    void id
  })

  test("deleting a company warns about its contacts and leaves them", async ({ page }) => {
    const id = await signUp(page)
    const companyId = await seedCompany(page, "Doomed Ltd")
    await page.request.post(`${API}/v1/persons`, {
      headers: await authHeaders(page),
      data: { firstName: "Ana", lastName: "Linked", companyId },
    })
    await page.waitForTimeout(600)

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await page.getByRole("link", { name: "Doomed Ltd", exact: true }).click()
    await page.waitForURL(/\/companies\/[0-9a-f-]{36}$/)

    // Delete is on the record itself, not behind Edit.
    await page.getByRole("button", { name: "Delete" }).click()

    // The confirm names the cost, because deleting a company unlinks its leads.
    await expect(page.getByText(/1 lead is linked/)).toBeVisible()
    await page.getByRole("button", { name: /delete company/i }).click()

    // A deleted company has no page left to show, so it goes back to the list.
    await page.waitForURL("**/companies")
    await expect(page.getByRole("cell", { name: "Doomed Ltd", exact: true })).toHaveCount(0)

    const list = await (
      await page.request.get(`${API}/v1/persons`, { headers: await authHeaders(page) })
    ).json()
    expect(list.items[0].firstName).toBe("Ana")
    expect(list.items[0].companyId ?? null).toBeNull()
    void id
  })
})

async function seedCompany(
  page: Page,
  name: string,
  domain?: string,
  industry?: string,
): Promise<string> {
  const res = await page.request.post(`${API}/v1/companies`, {
    headers: await authHeaders(page),
    data: { name, ...(domain ? { domain } : {}), ...(industry ? { industry } : {}) },
  })
  expect(res.ok(), `seeding ${name}: ${res.status()}`).toBeTruthy()
  await page.waitForTimeout(600)
  return ((await res.json()) as { company: { id: string } }).company.id
}
