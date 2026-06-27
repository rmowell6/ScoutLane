import { expect, test } from '@playwright/test'

// M0 happy path: the deployed skeleton boots and its core surfaces respond.
test.describe('M0 skeleton', () => {
  test('GET /api/health returns { ok: true }', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('home page loads through the middleware', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBe(true)
    // The default App Router shell renders a body without crashing the proxy middleware.
    await expect(page.locator('body')).toBeVisible()
  })
})
