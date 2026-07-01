import { describe, expect, test } from 'vitest'
import { chunk, mapWithConcurrency } from './concurrency'

describe('mapWithConcurrency', () => {
  test('never runs more than `limit` workers at once', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 30 }, (_, i) => i)
    await mapWithConcurrency(items, 10, async (n) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n
    })
    // 30 items, cap 10 -> the pool tops out at exactly 10 in flight.
    expect(maxActive).toBe(10)
  })

  test('preserves input order even when workers finish out of order', async () => {
    const items = [0, 1, 2, 3, 4, 5]
    const out = await mapWithConcurrency(items, 3, async (n) => {
      // Later items finish sooner, so completion order != input order.
      await new Promise((r) => setTimeout(r, (items.length - n) * 3))
      return n * 10
    })
    expect(out).toEqual([0, 10, 20, 30, 40, 50])
  })

  test('runs every item exactly once', async () => {
    const seen: number[] = []
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n)
      return n
    })
    expect(out).toEqual([1, 2, 3, 4, 5])
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  test('handles an empty list without spinning a worker', async () => {
    expect(await mapWithConcurrency([], 10, async () => 1)).toEqual([])
  })

  test('a rejecting worker rejects the whole call (Promise.all semantics)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})

describe('chunk', () => {
  test('splits into fixed-size batches with a smaller final batch', () => {
    const items = Array.from({ length: 1200 }, (_, i) => i)
    const batches = chunk(items, 500)
    expect(batches.map((b) => b.length)).toEqual([500, 500, 200])
    expect(batches.flat()).toEqual(items) // no row lost or reordered
  })

  test('one exact batch when the size matches the length', () => {
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]])
  })

  test('empty input yields no batches', () => {
    expect(chunk([], 500)).toEqual([])
  })

  test('a non-positive size collapses to a single batch (never spins)', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]])
  })
})
