import { test, expect } from "@playwright/test"

/**
 * Measures header column positions against body column positions.
 *
 * Eyeballing a screenshot is how alignment bugs survive review. This compares actual
 * bounding boxes so the numbers move when the layout breaks.
 */
test("measure column alignment", async ({ page }) => {
  const stamp = Math.random().toString(36).slice(2, 8)

  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Measure")
  await page.getByLabel("Work email").fill(`measure-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Measure ${stamp}`)
  await page.getByLabel("Password").fill("smoke-test-password")
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people")
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

  const token = await page.evaluate(async () => {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    return (await res.json()).token as string
  })
  await page.request.post("http://localhost:8080/v1/persons", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      firstName: "Col",
      lastName: "Measure",
      email: `col-${stamp}@roofing.test`,
      lifecycleStage: "qualified",
      source: "measure",
    },
  })
  await page.waitForTimeout(1200)

  const report = await page.evaluate(() => {
    const header = document.querySelector("thead")
    const firstRow = document.querySelector("tbody tr")
    if (!header || !firstRow) return { error: "missing header or row" }

    const heads = [...header.querySelectorAll("th")].map((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        text: (el.textContent ?? "").trim(),
        left: Math.round(r.left),
        width: Math.round(r.width),
        padLeft: cs.paddingLeft,
        padRight: cs.paddingRight,
      }
    })

    const cells = [...firstRow.querySelectorAll("td")].map((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        padLeft: cs.paddingLeft,
        padRight: cs.paddingRight,
      }
    })

    // Compare TEXT positions on both sides. Comparing a header's box edge against a
    // cell's text edge reports a phantom 8px drift equal to the cell padding — which is
    // what the first version of this file did.
    const textLeft = (el: Element) => {
      const r = el.getBoundingClientRect()
      return Math.round(r.left + parseFloat(getComputedStyle(el).paddingLeft))
    }

    const headText = [...header.querySelectorAll("th")].map(textLeft)
    const cellText = [...firstRow.querySelectorAll("td")].map(textLeft)

    const container = document.querySelector("thead")?.parentElement?.parentElement
    return {
      heads,
      cells,
      drift: headText.map((h, i) => (cellText[i] === undefined ? null : cellText[i] - h)),
      scrollWidth: container?.scrollWidth ?? null,
      clientWidth: container?.clientWidth ?? null,
    }
  })

  console.log(JSON.stringify(report, null, 2))
})