import { expect, test, type Page } from "@playwright/test"

/**
 * Header and body columns must line up, on both list pages.
 *
 * This started as a script that printed numbers, which is not a test. It became a test
 * when both tables were moved onto one shared shell — components/data/record-table.tsx —
 * because the shell makes drift structurally hard, and this is what catches it if the
 * shell is ever bypassed.
 *
 * Eyeballing a screenshot is how alignment bugs survive review. These compare actual
 * bounding boxes so the numbers fail when the layout breaks.
 */

const API = process.env.API_URL ?? "http://localhost:8080"

async function signUp(page: Page) {
  const stamp = Math.random().toString(36).slice(2, 8)
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Measure")
  await page.getByLabel("Work email").fill(`measure-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Measure ${stamp}`)
  await page.getByLabel("Password").fill("smoke-test-password")
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

  const token = await page.evaluate(async () => {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    return ((await res.json()) as { token: string }).token
  })
  return { token, stamp }
}

/**
 * Compare TEXT positions, not box edges.
 *
 * A header's box edge against a cell's text edge reports a phantom 8px drift equal to the
 * cell padding, which is what the first version of this file did.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("thead")
    const firstRow = document.querySelector("tbody tr")
    if (!header || !firstRow) return null

    const textLeft = (el: Element) => {
      const r = el.getBoundingClientRect()
      return Math.round(r.left + parseFloat(getComputedStyle(el).paddingLeft))
    }
    const width = (el: Element) => Math.round(el.getBoundingClientRect().width)

    const heads = [...header.querySelectorAll("th")]
    const cells = [...firstRow.querySelectorAll("td")]

    return {
      drift: heads.map((h, i) =>
        cells[i] === undefined ? null : textLeft(cells[i]) - textLeft(h),
      ),
      headWidths: heads.map(width),
      bodyWidths: cells.map(width),
      columns: heads.length,
    }
  })
}

/** The shell renders header cells as flex containers; a right-aligned column must agree. */
async function rightAlignedColumnsAlign(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("thead")
    const row = document.querySelector("tbody tr")
    if (!header || !row) return null

    const heads = [...header.querySelectorAll("th")]
    const cells = [...row.querySelectorAll("td")]

    return heads
      .map((h, i) => {
        const rightEdge = (el: Element) =>
          Math.round(el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight))
        return { head: rightEdge(h), cell: cells[i] ? rightEdge(cells[i]) : null }
      })
      .filter((_, i) => heads[i].textContent?.trim() === "Contacts")
  })
}

test.describe("column alignment", () => {
  test("leads: header columns sit above the values they name", async ({ page }) => {
    const { token, stamp } = await signUp(page)

    await page.request.post(`${API}/v1/persons`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        firstName: "Col",
        lastName: "Measure",
        email: `col-${stamp}@roofing.test`,
        lifecycleStage: "qualified",
        source: "measure",
      },
    })
    await page.waitForTimeout(1000)

    const result = await measure(page)
    expect(result, "the leads table should have rendered").not.toBeNull()
    expect(result!.columns).toBeGreaterThan(1)
    expect(result!.drift, `header drifted from values by ${result!.drift.join(", ")}px`).toEqual(
      result!.drift.map(() => 0),
    )
    expect(result!.headWidths).toEqual(result!.bodyWidths)
  })

  test("companies: header columns sit above the values they name", async ({ page }) => {
    const { token } = await signUp(page)

    await page.request.post(`${API}/v1/companies`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { name: "Acme Roofing", domain: "acme.test", industry: "Roofing" },
    })

    await page.getByRole("link", { name: "Companies" }).click()
    await page.waitForURL("**/companies")
    await expect(
      page.getByRole("cell", { name: "Acme Roofing", exact: true }),
    ).toBeVisible()
    await page.waitForTimeout(500)

    const result = await measure(page)
    expect(result, "the companies table should have rendered").not.toBeNull()
    expect(result!.drift, `header drifted from values by ${result!.drift.join(", ")}px`).toEqual(
      result!.drift.map(() => 0),
    )
    expect(result!.headWidths).toEqual(result!.bodyWidths)

    // The Contacts column is right-aligned on both sides. A header that right-aligns its
    // text without being a flex container measures differently from a cell that
    // right-aligns its content, and the two drift by that difference.
    const edges = await rightAlignedColumnsAlign(page)
    expect(edges, "the Contacts column should exist").toHaveLength(1)
    expect(edges![0].cell).toBe(edges![0].head)
  })

})
