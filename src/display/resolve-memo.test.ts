import { describe, test, expect } from 'bun:test'
import { createDisplayResolveMemo } from './resolve-memo.js'

describe('display resolve memo', () => {
  test('identical keys hit the memo', () => {
    const memo = createDisplayResolveMemo()
    const key = 'hash|id1|0|0|-1'
    memo.set('c1', key, { content: 'x' })
    expect(memo.get<{ content: string }>('c1', key)?.content).toBe('x')
    expect(memo.size('c1')).toBe(1)
  })

  test('bump(chatId) invalidates only that chat', () => {
    const memo = createDisplayResolveMemo()
    memo.set('c1', 'k', 'v1')
    memo.set('c2', 'k', 'v2')
    memo.bump('c1')
    expect(memo.get('c1', 'k')).toBeUndefined()
    expect(memo.get<string>('c2', 'k')).toBe('v2')
  })

  test('bump() with no arg invalidates all chats', () => {
    const memo = createDisplayResolveMemo()
    memo.set('c1', 'k', 'v1')
    memo.bump()
    expect(memo.get('c1', 'k')).toBeUndefined()
  })

  test('memo is capped (insertion-order FIFO eviction, oldest dropped first)', () => {
    const memo = createDisplayResolveMemo({ cap: 4 })
    for (let i = 0; i < 8; i++) memo.set('c1', `k${i}`, i)
    expect(memo.size('c1')).toBeLessThanOrEqual(4)
    expect(memo.get('c1', 'k0')).toBeUndefined()
    expect(memo.get<number>('c1', 'k7')).toBe(7)
  })
})
