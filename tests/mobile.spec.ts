import { test, expect, type Page } from "@playwright/test"

/**
 * Nothing is cut off on a phone.
 *
 * This exists because the failure it catches is silent. A company's contact table
 * rendered without the responsive guard and showed two of its three columns on a 390px
 * screen: the email column ran off the right edge and the Stage column was simply absent.
 * No error, no failed assertion, no console output — the page looked like a layout choice
 * rather than a bug, and the only way to notice was to look at it.
 *
 * So these are invariants rather than snapshots. They keep working when a column is added
 * and break the moment anything clips content the user cannot scroll to.
 */

const API = process.env.API_URL ?? "http://localhost:8080"

/** 390px: an iPhone 12/13/14, the narrowest screen most people hold. */
const PHONE = { width: 390, height: 780 }

/**
 * Elements that are clipping content with no way to reach it.
 *
 * A box qualifies when its content is wider than it is, its overflow-x is hidden or clip
 * rather than auto or scroll, and it is not ellipsising. Ellipsis is a deliberate
 * shortening — a long email on one line of a card — so it is excluded; a hard clip is not.
 *
 * min-width:0 boxes legitimately report overflow because a grid or flex child can shrink
 * them, so only boxes that actually laid out (clientWidth > 0) are considered.
 */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const s = getComputedStyle(el)
      if (/auto|scroll/.test(s.overflowX)) continue
      if (s.textOverflow === "ellipsis") continue
      if (el.clientWidth === 0) continue
      if (el.scrollWidth <= el.clientWidth + 1) continue
      // Base UI's Select keeps an aria-hidden input clipped with clip-path: inset(50%)
      // for native form submission. It reports 352px of content in a 1px box, which is
      // plumbing, not a crop.
      if (el.closest('[aria-hidden="true"]')) continue
      // `.sr-only` is the same trick: a 1px box with clip-path: inset(50%), holding
      // text that is there for a screen reader and invisible on purpose. It reports
      // real width in a 1px box, which is the definition of not-a-crop. The shadcn
      // dialog titles are sr-only, so without this every overlay fails.
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue
      bad.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}` +
          ` (${el.scrollWidth}px in ${el.clientWidth}px)`,
      )
    }
    return bad.slice(0, 6)
  })
}

/** The page must not scroll sideways at all. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  )
}

/** True when the element is shortening its own text. */
async function isTruncated(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    return el.scrollWidth > el.clientWidth + 1
  }, selector)
}

/**
 * A workspace with one company and four leads, all attached to it, so every screen below
 * has something to lay out. One seed, reused: this is about layout, and re-seeding per
 * screen would only make it slower.
 */
async function seed(page: Page) {
  const stamp = Math.random().toString(36).slice(2, 8)
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Avery Rep")
  await page.getByLabel("Work email").fill(`mobile-${stamp}@test.local`)
  await page.getByLabel("Company").fill(`Northwind Roofing ${stamp}`)
  await page.getByLabel("Password").fill("smoke-test-password")
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })

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

  // Long names and long addresses on purpose: the cases that crop.
  for (const person of [
    {
      firstName: "Maximiliana",
      lastName: "Featherstonehaugh",
      email: "maximiliana.featherstonehaugh@northside-construction.test",
      jobTitle: "Vice President of Roofing Operations",
    },
    {
      firstName: "Xiulan",
      lastName: "Vasquez-Abernathy",
      email: "xiulan.vasquez-abernathy@northside-construction.test",
    },
    {
      firstName: "Bo",
      lastName: "Okonkwo",
      email: "bo@northside.test",
    },
  ]) {
    const res = await page.request.post(`${API}/v1/persons`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        ...person,
        source: "Website form",
        lifecycleStage: "qualified",
        companyId: company.company.id,
      },
    })
    if (!res.ok()) throw new Error(`seeding failed: ${res.status()}`)
  }

  return { token, companyId: company.company.id as string }
}

test.describe("phone layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE)
  })

  test("a company shows all of its contacts, none of them cut off", async ({ page }) => {
    const { companyId } = await seed(page)

    await page.goto(`/companies/${companyId}`)
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible()

    // Every contact's email and stage are on screen, inside the card that opens the lead.
    // Before the fix this rendered as a table whose email column ran past the right edge
    // and whose Stage column was not in the viewport at all — so a test that only counted
    // rows passed while showing three names and no stage for any of them.
    await expect(
      page.getByRole("link", {
        // \s+ not .* — the card stacks these as separate lines, so the accessible name
        // carries newlines between the name, the stage and the email.
        // Capitalised, because the chip renders the display label rather than the
        // database enum. It matched `qualified` for as long as the badge printed its
        // input, which is how a raw enum reached every row on the screen.
        name: /Maximiliana Featherstonehaugh\s+Qualified\s+maximiliana\.featherstonehaugh@/,
      }),
    ).toBeVisible()

    expect(await clipped(page), "elements clipping content on a phone").toEqual([])
    expect(await scrollsSideways(page), "page scrolls sideways").toBe(false)
  })

  test("record pages show the whole name", async ({ page }) => {
    await seed(page)
    await page.goto("/people")
    await page.getByRole("link", { name: /Featherstonehaugh/ }).first().click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    // The heading is the entire reason the page exists. It showed as
    // "Maximiliana Feathers…" because it carried truncate.
    expect(await isTruncated(page, "h1"), "record name is truncated").toBe(false)
    expect(await clipped(page)).toEqual([])
  })

  test("a phone can sign out", async ({ page }) => {
    await seed(page)

    // It used to live at the bottom of the sidebar behind `hidden md:block`, so there was
    // no way to sign out on a phone at all.
    await page.getByRole("button", { name: /^Account:/ }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await page.waitForURL("**/sign-in", { timeout: 20_000 })
  })

  test("the sidebar stays put and lists stay clean", async ({ page }) => {
    await seed(page)

    for (const path of ["/people", "/companies"]) {
      await page.goto(path)
      await page.waitForTimeout(600)

      // The shell was min-h-svh with an h-svh pane under it, so the document was always
      // taller than the viewport and the top row scrolled away on its own.
      expect(await scrollsSideways(page), `${path} scrolls sideways`).toBe(false)
      expect(await clipped(page), `${path} clips content`).toEqual([])
      await expect(page.getByRole("banner").or(page.getByText("Fold", { exact: true })))
        .toBeVisible()
    }
  })

  test("a form is still submittable with the keyboard up", async ({ page }) => {
    await seed(page)

    // 780 - ~300 is roughly what is left of a 390x780 phone once the on-screen keyboard
    // is up. The edit form is ~735px tall, so this is the case that broke: the dialog grew
    // past the viewport, centred on it, and Save sat off-screen with no scroll to reach it.
    await page.setViewportSize({ width: 390, height: 500 })
    await page.goto("/people")
    await page.getByRole("link", { name: /Featherstonehaugh/ }).first().click()
    await page.getByRole("button", { name: "Edit" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    const fits = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: window.innerHeight }
    })
    expect(fits.top, "dialog top is on screen").toBeGreaterThanOrEqual(0)
    expect(fits.bottom, "dialog bottom is on screen").toBeLessThanOrEqual(fits.height)

    // And it scrolls, so everything in it is reachable.
    const scrollable = await dialog.evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight,
      overflow: getComputedStyle(el).overflowY,
    }))
    expect(
      scrollable.overflow === "auto" || scrollable.overflow === "scroll",
      "dialog scrolls when it is taller than the screen",
    ).toBe(true)

    await dialog.getByRole("button", { name: /save changes/i }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole("button", { name: /save changes/i })).toBeInViewport()
  })

  test("the most-tapped controls are big enough to hit", async ({ page }) => {
    await seed(page)
    await page.goto("/people")

    // The stage filter is tapped more than anything else on the screen and shipped at
    // h-7 — a 28px target against a 44px thumb minimum. So did "New lead".
    for (const name of ["New", "All stages"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox()
      expect(box, `"${name}" is on screen`).not.toBeNull()
      expect(box!.height, `"${name}" target height`).toBeGreaterThanOrEqual(44)
    }

    const create = await page.getByRole("link", { name: /new lead/i }).boundingBox()
    expect(create!.height, '"New lead" target height').toBeGreaterThanOrEqual(44)
  })
})
