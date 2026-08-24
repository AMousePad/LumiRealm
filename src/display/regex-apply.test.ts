import { describe, test, expect } from 'bun:test'
import { compileRegex, collectMatches } from './regex-apply.js'

describe('compileRegex cache', () => {
  test('returns the same shared instance for identical pattern+flags', () => {
    const a = compileRegex('a+b', 'g')
    const b = compileRegex('a+b', 'g')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  test('distinct flags yield distinct instances', () => {
    const g = compileRegex('a+', 'g')
    const plain = compileRegex('a+', '')
    expect(g).not.toBe(plain)
    expect(g?.global).toBe(true)
    expect(plain?.global).toBe(false)
  })

  test('invalid patterns return null and the null is cached', () => {
    const a = compileRegex('([', 'g')
    const b = compileRegex('([', 'g')
    expect(a).toBeNull()
    expect(b).toBeNull()
  })
})

describe('collectMatches on shared cached instances', () => {
  test('repeated runs on one global regex give identical results and restore lastIndex', () => {
    const regex = compileRegex('\\d+', 'g')!
    const first = collectMatches('a1b22c333', regex)
    expect(regex.lastIndex).toBe(0)
    const second = collectMatches('a1b22c333', regex)
    expect(first).toEqual(second)
    expect(first.map((m) => m.fullMatch)).toEqual(['1', '22', '333'])
    expect(regex.lastIndex).toBe(0)
  })

  test('non-global regex yields at most one match', () => {
    const regex = compileRegex('\\d', '')!
    const matches = collectMatches('a1b2', regex)
    expect(matches.length).toBe(1)
    expect(matches[0]!.fullMatch).toBe('1')
  })

  test('preserves capture groups and named groups', () => {
    const regex = compileRegex('(?<word>\\w)=(\\d)', '')!
    const matches = collectMatches('x=5', regex)
    expect(matches[0]!.groups).toEqual(['x', '5'])
    expect(matches[0]!.namedGroups).toEqual({ word: 'x' })
  })
})
