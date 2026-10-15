import { test } from "@playwright/test"

// Writes PNGs and asserts nothing, so it is opt-in: VISUAL_REVIEW=1 bunx playwright test
// tests/visual-review.spec.ts
//
// It earned its place. Every crop and overlap fixed in this file was found by looking at
// these images, not by a failing assertion — an assertion has to know what correct looks
// like before anyone notices when it stops looking that way.
test.skip(
  !process.env.VISUAL_REVIEW,
  "set VISUAL_REVIEW=1 to capture screenshots for review",
)

/**
 * Screenshot sweep for visual review. Not a test — it writes PNGs and asserts nothing.
 *
 * Run it, then look at the images. Every crop, overflow and misalignment in the product
 * was found by looking rather than by an assertion, because an assertion has to know what
 * correct looks like before anyone notices when it stops looking that way.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const OUT = "/tmp/shots"

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 900 },
  { name: "mobile", width: 390, height: 780 },
]

async function signUp(page: import("@playwright/test").Page, stamp: string) {
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Avery Rep")
  await page.getByLabel("Work email").fill(`review-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Northwind Roofing ${stamp}`)
  await page.getByLabel("Password").fill("smoke-test-password")
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })
  await page.getByText("Live", { exact: true }).waitFor({ timeout: 20_000 })

  const token = await page.evaluate(async () => {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    return ((await res.json()) as { token: string }).token
  })

  const company = await (
    await page.request.post(`${API}/v1/companies`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        name: "Northside Roofing Company",
        domain: "northside-construction.test",
        industry: "Roofing & Exteriors",
        size: "51-200",
        location: "Denver, Colorado",
      },
    })
  ).json()

  const peopleToSeed = [
    { firstName: "Maximiliana", lastName: "Featherstonehaugh", email: "max@northside-construction.test", jobTitle: "Vice President of Roofing Operations", lifecycleStage: "new" },
    { firstName: "Bo", lastName: "Okonkwo", email: "bo@northside-construction.test", jobTitle: "Site Foreman", lifecycleStage: "contacted" },
    { firstName: "Xiulan", lastName: "Vasquez-Abernathy", email: "xiulan@northside.test", lifecycleStage: "qualified" },
    { firstName: "Jean-Luc", lastName: "Poincare", email: "jl@northside.test", lifecycleStage: "customer" },
  ]

  for (const person of peopleToSeed) {
    const res = await page.request.post(`${API}/v1/persons`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { ...person, source: "Website form", companyId: company.company.id },
    })
    if (!res.ok()) {
      throw new Error(`seeding ${person.firstName} failed: ${res.status()} ${await res.text()}`)
    }
  }

  // Some activity so the drawer has a timeline worth looking at.
  const people = await (
    await page.request.get(`${API}/v1/persons`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()
  for (const body of [
    { kind: "note", body: "Quoted three bundles of architectural shingles, underlayment and 40 linear feet of flashing. Sent Friday." },
    { kind: "call", body: "Left a voicemail with the office. Will try the mobile after the site visit." },
    { kind: "email", direction: "inbound", body: "Re: quote request — can we add the tear-off labour separately?" },
  ]) {
    await page.request.post(`${API}/v1/persons/${people.items[0].id}/activities`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: body,
    })
  }
  await page.request.patch(`${API}/v1/persons/${people.items[0].id}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { lifecycleStage: "customer" },
  })
  return token
}

for (const vp of VIEWPORTS) {
  test(`visual review — ${vp.name}`, async ({ page }) => {
    const stamp = Math.random().toString(36).slice(2, 8)
    await page.setViewportSize({ width: vp.width, height: vp.height })

    await page.goto("/sign-in")
    await page.screenshot({ path: `${OUT}/${vp.name}-signin.png`, fullPage: true })

    await signUp(page, stamp)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${vp.name}-people.png` })

    // Below md the list is cards, not a table, so there is no row to click. Picking
    // whichever exists is also a check that the responsive switch is doing its job.
    const asRow = page.getByRole("row").filter({ hasText: "Maximiliana" })
    const asCard = page.getByRole("button").filter({ hasText: "Maximiliana" })
    await (asRow.or(asCard).first().click())
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/${vp.name}-drawer.png` })

    await page.getByRole("button", { name: /^edit$/i }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${vp.name}-edit.png` })
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(400)

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/${vp.name}-companies.png` })

    const companyCell = page.getByRole("cell", { name: "Northside Roofing Company" })
    const companyCard = page.getByRole("button").filter({ hasText: "Northside Roofing Company" })
    await (companyCell.or(companyCard).first().click())
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${vp.name}-company-edit.png` })
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)

    await page.getByRole("button", { name: /switch workspace/i }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${vp.name}-switcher.png` })
  })
}