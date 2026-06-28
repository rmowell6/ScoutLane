import { expect, test } from '@playwright/test'

// M0 happy path: the deployed skeleton boots and its core surfaces respond.
test.describe('M0 skeleton', () => {
  test('GET /api/health reports ok plus pool readiness', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    // Readiness field is always present; `pool` is null when the job store isn't configured
    // (e.g. CI without Supabase secrets), or { live, lastIngestAt } when it is.
    expect(json).toHaveProperty('pool')
  })

  test('home page loads through the middleware', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBe(true)
    // The default App Router shell renders a body without crashing the proxy middleware.
    await expect(page.locator('body')).toBeVisible()
  })
})
