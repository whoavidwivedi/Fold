import { expect, type Page } from "@playwright/test"

export const API = process.env.API_URL ?? "http://localhost:8080"

const PASSWORD = "smoke-test-password"

/**
 * A fresh identity per call.
 *
 * Module-level constants looked tidy and were wrong: five tests shared one email, so
 * only the first sign-up could succeed and the rest failed on "user already exists".
 * Each test needs its own account, and its own workspace.
 */
export function newIdentity() {
  const stamp = Math.random().toString(36).slice(2, 8)
  return { stamp, email: `smoke-${stamp}@test.local`, password: PASSWORD }
}

/**
 * Sign up through the real form, not the API.
 *
 * Driving the UI is the whole point: it exercises the exact calls the browser makes,
 * including any that curl would happily forge differently.
 */
export async function signUp(page: Page) {
  const id = newIdentity()
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill("Smoke Tester")
  await page.getByLabel("Work email").fill(id.email)
  await page.getByLabel("Company").fill(`Smoke Roofing ${id.stamp}`)
  await page.getByLabel("Password").fill(id.password)
  await page.getByRole("button", { name: /create workspace/i }).click()
  await page.waitForURL("**/people", { timeout: 20_000 })
  return id
}

/** Mint the same JWT the app would, using the browser's session cookie. */
export async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/api/auth/token`, { credentials: "include" })
    if (!res.ok) return null
    const body = await res.json()
    return body.token as string | null
  }, process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:3000")

  expect(token, "browser session should be able to mint an API token").toBeTruthy()
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
}

/** A lead to seed. Stage and source default; everything else is the caller's business. */
export type SeedRow = {
  firstName: string
  lastName: string
  email?: string
  lifecycleStage?: string
}

/** Seed leads and return their first names, in insertion order. */
export async function seedLeads(
  page: Page,
  identity: { stamp: string },
  rows?: SeedRow[],
) {
  const { stamp } = identity
  const fallback: SeedRow[] = [
    { firstName: "Ada", lastName: "Lovelace", lifecycleStage: "qualified" },
    { firstName: "Alan", lastName: "Turing", lifecycleStage: "new" },
    { firstName: "Grace", lastName: "Hopper", lifecycleStage: "contacted" },
  ]
  const list = rows ?? fallback

  const names: string[] = []
  for (const seed of list) {
    const email = seed.email ?? `${seed.firstName.toLowerCase()}-${stamp}@seed.test`
    const res = await page.request.post(`${API}/v1/persons`, {
      headers: await authHeaders(page),
      data: { ...seed, email, source: "smoke-test" },
    })
    expect(res.ok(), `seeding ${seed.firstName}: ${res.status()}`).toBeTruthy()
    names.push(seed.firstName)
  }

  // The list is keyedset-ordered by created_at DESC, so give the invalidation a beat to
  // land before the caller asserts on rows.
  await page.waitForTimeout(600)
  return names
}
