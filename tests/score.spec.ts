import { expect, test, type Page } from "@playwright/test"

import { API, authHeaders, seedLeads, signUp } from "./support"

/** Scope to a row: the Lead cell renders "Sora Vance" and the Email cell an address, so a
 * bare getByRole("cell") matches both and Playwright refuses to guess. */
const row = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name })

/**
 * The score was three columns every handler read and nothing wrote, so a 20k-row list
 * rendered a column of nothing. Two things this has to get right, and both are PATCH
 * semantics rather than score semantics:
 *
 * 1. It round-trips — set a score, reload, it is still there.
 * 2. Sending nothing leaves it alone. A blank input has to be omitted, not sent as 0,
 *    because `COALESCE(sqlc.narg(score), score)` reads NULL as "leave alone" and 0 as
 *    "you just erased this". The same trap that let a PATCH overwrite a lead's name.
 */
test.describe("lead score", () => {
  test("round-trips and blank leaves it alone", async ({ page }) => {
    const id = await signUp(page)
    const names = await seedLeads(page, id, [{ firstName: "Sora", lastName: "Vance" }])
    const name = names[0]

    await page.goto("/people")
    await page.getByRole("link", { name }).first().click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)

    const open = async () => {
      await page.getByRole("button", { name: /^edit$/i }).click()
      await page.getByLabel("Total").waitFor()
    }
    const save = async () => {
      await page.getByRole("button", { name: /save changes/i }).click()
      await page.getByRole("button", { name: /^edit$/i }).waitFor()
    }

    await open()
    await page.getByLabel("Total").fill("82")
    await page.getByLabel("Fit").fill("90")
    await page.getByLabel("Intent").fill("70")
    await save()

    // Assert on the list, which is where a score is read. The record page does not show
    // it yet — a number that only exists in a column you have to scroll back to is a
    // number nobody looks at.
    const recordUrl = page.url()

    await page.goto("/people")
    await expect(row(page, name).getByRole("cell", { name: "82" })).toBeVisible()

    // Save again with the field blank. If blank were sent as 0 the score would go back
    // to a dash, which is the whole bug: a rep who clears a field to re-enter it later
    // would silently erase the score.
    await page.getByRole("link", { name }).first().click()
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/)
    await open()
    await expect(page.getByLabel("Total")).toHaveValue("82")
    await page.getByLabel("Total").fill("")
    await save()

    await page.goto("/people")
    await expect(row(page, name).getByRole("cell", { name: "82" })).toBeVisible()

    // And it is really in the database, not just the cache the mutation invalidated.
    // The id is read HERE, while the browser is still on the record — by the time this
    // point runs the URL is /people, and the GET below 404s on a list URL's last segment.
    const personId = recordUrl.split("/").pop()
    const detail = await (
      await page.request.get(`${API}/v1/persons/${personId}`, { headers: await authHeaders(page) })
    ).json()
    expect(detail.score).toBe(82)
    expect(detail.scoreFit).toBe(90)
    expect(detail.scoreIntent).toBe(70)
  })

  test("shows a dash when there is no score, and the number once there is", async ({ page }) => {
    const id = await signUp(page)
    const names = await seedLeads(page, id)
    await page.goto("/people")

    // The list renders `—` for 0 rather than 0, so an unscored lead does not look like
    // a lead that was scored zero. The two are different facts and the column has to
    // keep them apart.
    for (const name of names) {
      await expect(row(page, name).getByRole("cell", { name: "—" })).toBeVisible()
    }
  })
})
