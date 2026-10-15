import { test, expect } from "@playwright/test"

/**
 * Screenshot the people table so layout regressions are visible in a diff rather than
 * discovered by eye. Not an assertion test — this one writes files and always passes.
 */
test("capture people table", async ({ page }) => {
  const stamp = Math.random().toString(36).slice(2, 8)

  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Layout Check")
  await page.getByLabel("Work email").fill(`layout-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Layout ${stamp}`)
  await page.getByLabel("Password").fill("smoke-test-password")
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people")
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

  const token = await page.evaluate(async () => {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    return (await res.json()).token as string
  })

  for (const [fn, ln, st] of [
    ["Priya", "Raman", "qualified"],
    ["Tomas", "Novak", "contacted"],
    ["Aisha", "Bello", "new"],
    ["Diego", "Fernandez", "customer"],
  ] as const) {
    await page.request.post("http://localhost:8080/v1/persons", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        firstName: fn,
        lastName: ln,
        email: `${fn.toLowerCase()}-${stamp}@roofing.test`,
        lifecycleStage: st,
        source: "layout-check",
      },
    })
  }

  await page.waitForTimeout(1200)

  await page.screenshot({ path: "test-results/table-desktop.png", fullPage: false })
  await page.setViewportSize({ width: 420, height: 900 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: "test-results/table-mobile.png", fullPage: false })
})