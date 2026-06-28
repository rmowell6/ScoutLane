import { describe, expect, test } from 'vitest'
import * as ingestAll from './route'
import * as ingest from '../ingest/route'

// Regression guard for the cron-method bug: Vercel Cron invokes the scheduled path with an HTTP GET
// (and auto-attaches `Authorization: Bearer $CRON_SECRET`). A POST-only route returns 405 *before*
// the handler runs, so the daily refresh — and the prune/doc-sweep it triggers — silently never run.
describe('ingest route method exports', () => {
  test('ingest-all exports GET (the method Vercel Cron actually sends)', () => {
    expect(typeof ingestAll.GET).toBe('function')
  })

  test('ingest-all GET and POST share one handler so manual POST runs keep working', () => {
    expect(ingestAll.POST).toBe(ingestAll.GET)
  })

  test('manual ingest sibling is likewise GET-callable', () => {
    expect(typeof ingest.GET).toBe('function')
    expect(ingest.POST).toBe(ingest.GET)
  })
})
