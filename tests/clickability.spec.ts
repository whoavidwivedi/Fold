import { expect, test, type Page } from "@playwright/test"

/**
 * If it looks clickable, the whole thing is clickable and the cursor says so.
 *
 * Two things went wrong here that no existing test would have caught. The stretched link
 * silently did nothing, because Tailwind v4's `after:absolute` emits no ::after without
 * `after:content-['']`, so only the underlined name was a target. And the cell's
 * `overflow-hidden` clipped the ::after to that one cell, so even once it rendered it
 * covered nothing.
 */

const API = process.env.API_URL ?? "http://localhost:8080"
const PASSWORD = "smoke-test-password"

async function signUp(page: Page) {
  const stamp = Math.random().toString(36).slice(2, 8)
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Click Tester")
  await page.getByLabel("Work email").fill(`click-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Click Roofing ${stamp}`)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })

  const token = await page.evaluate(async () => {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    return ((await res.json()) as { token: string }).token
  })

  for (const [first, last] of [
    ["Alpha", "Row"],
    ["Bravo", "Row"],
  ]) {
    const res = await page.request.post(`${API}/v1/persons`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { firstName: first, lastName: last, email: `${first}-${stamp}@click.test` },
    })
    expect(res.ok()).toBeTruthy()
  }
  // Wait for the row, not for the clock. This is the first test in the file, so it is
  // also the first to touch a freshly started server, where the initial render plus
  // hydration can outlast any fixed sleep. In CI that is the difference between a green
  // run and a 30s timeout on boundingBox, with every later test passing — which reads as
  // a flake rather than a harness that was guessing.
  await expect(
    page.getByRole("link", { name: `Alpha Row`, exact: true }),
  ).toBeVisible()
  return stamp
}

test.describe("clickability", () => {
  test("the whole lead row opens the record, not just the name", async ({ page }) => {
    const stamp = await signUp(page)

    // A raw mouse click on the email cell — the opposite end of the row from the name.
    // Not locator.click(): Playwright's actionability check demands the hit target be the
    // element you named, and here that is the stretched link in another cell. A real
    // user's click does not care where the anchor's box is.
    const box = await page
      .getByRole("cell", { name: `alpha-${stamp}@click.test` })
      .boundingBox()
    expect(box, "the email cell should be on screen").not.toBeNull()

    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Alpha Row/)
  })

  test("the name is still a real link, not a click handler", async ({ page }) => {
    await signUp(page)
    const link = page.getByRole("link", { name: "Alpha Row" }).first()

    // Middle-click and "open in new tab" only work on a real anchor. A row with an
    // onClick would lose both, and its href would be unassertable.
    await expect(link).toHaveAttribute("href", /\/people\/[0-9a-f-]{36}$/)
  })

  test("anything clickable shows a pointer, and disabled things do not", async ({ page }) => {
    await signUp(page)

    const cursors = await page.evaluate(() => {
      const afterOf = (sel: string) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el, "::after").cursor : "MISSING"
      }
      const of = (sel: string) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).cursor : "MISSING"
      }
      const disabled = [...document.querySelectorAll("button")].find((b) => b.disabled)

      return {
        link: of("tbody a"),
        // The stretched ::after is the real hit area, so that is where the pointer goes.
        stretchedArea: afterOf("tbody a"),
        button: of('button[data-slot="button"]'),
        disabled: disabled ? getComputedStyle(disabled).cursor : "none-found",
      }
    })

    expect(cursors.link).toBe("pointer")
    expect(cursors.stretchedArea, "the whole row should show a pointer").toBe("pointer")
    expect(cursors.button).toBe("pointer")
    // A disabled control must not invite a click.
    expect(cursors.disabled).not.toBe("pointer")
  })
})
