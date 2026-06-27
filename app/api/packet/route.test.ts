import { describe, expect, test } from 'vitest'
import { POST } from '@/app/api/packet/route'

// Exercises the thin-handler validation path only — invalid input is rejected before any
// LLM call, so these run without network or an API key.
describe('POST /api/packet validation', () => {
  test('rejects a non-JSON / empty body with 400', async () => {
    const req = new Request('http://localhost/api/packet', { method: 'POST', body: 'not json' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('rejects a body missing required fields with 400', async () => {
    const req = new Request('http://localhost/api/packet', {
      method: 'POST',
      body: JSON.stringify({ resumeText: 'only resume' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Invalid request')
  })
})
