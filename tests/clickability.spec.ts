import { expect, test, type Page } from "@playwright/test"

/**
 * If it looks clickable, the whole thing is clickable, the cursor says so, and pressing it
 * gives something back.
 *
 * Three things went wrong here that no existing test would have caught. The stretched link
 * silently did nothing, because Tailwind v4's `after:absolute` emits no ::after without
 * `after:content-['']`, so only the underlined name was a target. And the cell's
 * `overflow-hidden` clipped the ::after to that one cell, so even once it rendered it
 * covered nothing.
 *
 * The press check is here for the same reason. It is invisible in a screenshot and lives
 * entirely in a `before:` variant on a pseudo-element, so a Tailwind upgrade that drops or
 * renames `before:scale-*` removes the feedback without failing anything else.
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

  // Wait for the stream before seeding. These leads are created through the API, not
  // through the browser, so the only thing that can put them on screen is the SSE event —
  // and an event emitted before the subscription is live is simply never delivered. This
  // was the one helper of twelve without this wait, and it was the one that failed first
  // in CI: the row did not appear, and no amount of retrying on the assertion would have
  // helped, because the event had already gone.
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 })

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
    // Scope to the row, then measure the cell INSIDE it. The list is keyset-ordered by
    // created_at DESC and the seeds are created through a racing pool, so "which row is
    // first" is not stable for the first few hundred milliseconds. Measuring the email
    // cell by name alone and clicking its centre is measuring a row that can then move,
    // which is how this test intermittently opened a different lead and looked like a
    // stretched-link bug.
    const row = page.getByRole("row").filter({ hasText: `alpha-${stamp}@click.test` })
    await expect(row, "alpha's row should be on screen").toBeVisible()
    const box = await row.getByRole("cell", { name: `alpha-${stamp}@click.test` }).boundingBox()
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

  test("pressing a button presses it, and the text goes with it", async ({ page }) => {
    await signUp(page)

    // A stage chip, not "New lead": that is a link, and pressing it navigates, which
    // makes the element inert exactly when the measurement is being taken.
    const button = page.getByRole("button", { name: "Qualified", exact: true })
    // Tailwind v4 sets the standalone `translate` property, not `transform`. Reading
    // `transform` sees "none" both idle and pressed, and the test passes forever without
    // checking anything — which is exactly what happened before it read the right one.
    const translateOf = () => button.evaluate((el) => getComputedStyle(el).translate)

    expect(await translateOf(), "idle").toBe("none")

    // evaluate, not boundingBox: boundingBox waits for actionability, which would then
    // time out on the very measurement this test exists to make.
    const rect = () =>
      button.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y }
      })

    const before = await rect()
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(250)
    const pressed = await translateOf()
    const during = await rect()
    await page.mouse.up()

    // `active:translate-y-px` is the stock shadcn press. It is a translate rather than a
    // scale because a scale shrinks the label and the text moves with it.
    expect(pressed, "the button presses down on mousedown").toBe("0px 1px")

    expect(Math.round(during.x), "button x while pressed").toBe(Math.round(before.x))
    expect(Math.round(during.y) - Math.round(before.y), "button presses 1px down").toBe(1)
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
