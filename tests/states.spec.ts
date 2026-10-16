import { expect, test, type Page } from "@playwright/test"

/**
 * A state you cannot see is not a state.
 *
 * Every one of these was measured, not eyeballed, and every one was a real defect:
 *
 *   - Hovering a nav item painted it identically to the active one, so the app could not
 *     tell you where you were. Both were `bg-sidebar-accent`.
 *   - A table row's hover was `bg-muted/50` over a white background — about three percent
 *     of luminance, which is not a visible state.
 *   - Half the tab order fell back to the browser's default focus ring while the rest used
 *     the design system's, and the design system's was `ring-ring/50`, faint enough to read
 *     as none at all.
 *
 * They are asserted here because all three regress silently: the classes still apply, the
 * component still renders, and nothing throws.
 */

const API = process.env.API_URL ?? "http://localhost:8080"

async function signIn(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill("demo@fold.test")
  await page.getByLabel("Password").fill("seed-password-123")
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/people", { timeout: 30_000 })
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600)
}

test.describe("state visibility", () => {
  test("the active nav item is not the same as a hovered one", async ({ page }) => {
    await signIn(page)

    const paint = (name: string) =>
      page
        .getByRole("link", { name, exact: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor)

    const active = await paint("Leads")

    await page.getByRole("link", { name: "Companies", exact: true }).hover()
    await page.waitForTimeout(250)
    const hovered = await paint("Companies")

    expect(hovered, "a hovered nav item must differ from the active one").not.toBe(active)

    // And the active one says so structurally, not only by a shade of grey: a keyboard
    // user's first Tab lands here and this is the only cue they get.
    const before = await page
      .getByRole("link", { name: "Leads", exact: true })
      .evaluate((el) => getComputedStyle(el, "::before").content)
    expect(before, "the active nav item should carry an indicator").not.toBe("none")
  })

  test("hovering a row is visible", async ({ page }) => {
    await signIn(page)

    const row = page.getByRole("row").nth(1)
    const rest = await row.evaluate((el) => getComputedStyle(el).backgroundColor)

    await row.hover()
    await page.waitForTimeout(250)
    const hovered = await row.evaluate((el) => getComputedStyle(el).backgroundColor)

    expect(hovered, "a hovered row must differ from an idle one").not.toBe(rest)

    // "differs" is not "visible". bg-muted/50 over white is about three percent of
    // luminance: it satisfies the assertion above and shows nothing. An opaque colour has
    // no slash-alpha component; a wash does.
    expect(hovered, "row hover should be a real fill, not a faint wash").not.toMatch(
      /\/\s*[\d.]+\s*\)/,
    )
  })

  test("every element in the tab order shows where it is", async ({ page }) => {
    await signIn(page)

    const unlit = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("a, button, input, [tabindex]")].map(
        (el) => getComputedStyle(el).boxShadow,
      ),
    )

    // Real key presses. A programmatic .focus() does not trigger :focus-visible, so a
    // test built on it asserts nothing about what a keyboard user sees.
    const unseen: string[] = []

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab")
      await page.waitForTimeout(90)

      const seen = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const focused = getComputedStyle(el).boxShadow
        const index = [...document.querySelectorAll<HTMLElement>("a, button, input, [tabindex]")].indexOf(el)
        return { index, changed: focused, visible: el.matches(":focus-visible") }
      })

      if (seen && seen.visible && seen.changed === unlit[seen.index]) {
        unseen.push(`${seen.index}`)
      }
    }

    expect(unseen, "tab stops that paint nothing new when focused").toEqual([])
  })

  test("a state layer does not un-position a virtualized row", async ({ page }) => {
    await signIn(page)

    // `t-state-layer` sets position:relative because its ::after needs a containing
    // block. The leads list's rows are `absolute` because the virtualizer positions them
    // with translateY, and relative would win in a Tailwind upgrade's source order and
    // stack every row on top of the first one — silently, with no error and a list that
    // still looks plausible at a glance.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].slice(0, 3).map((el) => ({
        position: getComputedStyle(el).position,
        top: Math.round(el.getBoundingClientRect().top),
      })),
    )

    expect(rows.length, "the list should have rendered rows").toBeGreaterThan(2)
    for (const row of rows) {
      expect(row.position, "a virtualized row must stay absolutely positioned").toBe(
        "absolute",
      )
    }
    expect(
      new Set(rows.map((r) => r.top)).size,
      "rows must not be stacked on the same line",
    ).toBe(rows.length)
  })

  test("a focused record name can be found", async ({ page }) => {
    await signIn(page)

    // Tab until focus lands inside the table body.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab")
      const inTable = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.closest("tbody") != null,
      )
      if (inTable) break
    }

    const lit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { shadow: getComputedStyle(el).boxShadow, visible: el.matches(":focus-visible") }
    })

    expect(lit.visible, "the row link should match :focus-visible on keyboard focus").toBe(true)
    expect(lit.shadow, "a focused record name must paint something").not.toBe("none")
    void API
  })
})
