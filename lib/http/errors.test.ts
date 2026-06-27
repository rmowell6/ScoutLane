import { afterEach, describe, expect, test, vi } from 'vitest'

// serverErrorBody reads NODE_ENV at module load, so each case imports a fresh module copy.
async function load(env: string) {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', env)
  return (await import('./errors')).serverErrorBody
}

afterEach(() => vi.unstubAllEnvs())

describe('serverErrorBody', () => {
  test('withholds the raw message in production, keeps the safe step', async () => {
    const serverErrorBody = await load('production')
    const body = serverErrorBody(new Error('connect ECONNREFUSED db.internal:5432'), 'upsert')
    expect(body.step).toBe('upsert')
    expect(body.error).toBe('Internal Server Error')
    expect(body.message).not.toContain('db.internal')
    expect(body.message).toMatch(/internal error/i)
  })

  test('echoes the raw message outside production for debugging', async () => {
    const serverErrorBody = await load('development')
    const body = serverErrorBody(new Error('boom in parseJob'), 'parseJob')
    expect(body.step).toBe('parseJob')
    expect(body.message).toBe('boom in parseJob')
  })

  test('honors a custom error label and non-Error inputs', async () => {
    const serverErrorBody = await load('development')
    const body = serverErrorBody('weird string', null, 'Extraction failed')
    expect(body).toEqual({ error: 'Extraction failed', step: null, message: 'weird string' })
  })
})
