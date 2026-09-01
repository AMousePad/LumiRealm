import { describe, expect, test } from 'bun:test';
import { parseDirectLorebook } from '../../src/payload/lorebook-direct-import.js';

describe('parseDirectLorebook', () => {
  test('empty / invalid JSON → unknown format, no entries', () => {
    const a = parseDirectLorebook('not json');
    expect(a.format).toBe('unknown');
    expect(a.entries).toHaveLength(0);
    const b = parseDirectLorebook('null');
    expect(b.format).toBe('unknown');
    const c = parseDirectLorebook('[]');
    expect(c.format).toBe('unknown');
  });

  test('Risu native format: { type: "risu", ver: 1, data: [...] }', () => {
    const json = JSON.stringify({
      type: 'risu',
      ver: 1,
      data: [
        { key: 'foo', content: 'bar', comment: 'one', alwaysActive: true, selective: false, mode: 'normal', insertorder: 0 },
        { key: 'baz', content: 'qux', comment: 'two', alwaysActive: false, selective: true, mode: 'normal', insertorder: 0 },
      ],
    });
    const r = parseDirectLorebook(json);
    expect(r.format).toBe('risu');
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]?.comment).toBe('one');
    expect(r.entries[0]?.alwaysActive).toBe(true);
    expect(r.entries[1]?.selective).toBe(true);
    expect(r.dropped).toBe(0);
  });

  test('Risu native: drops null entries', () => {
    const json = JSON.stringify({
      type: 'risu',
      ver: 1,
      data: [
        { key: 'foo', content: 'bar', comment: 'one', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0 },
        null,
        'not an object',
      ],
    });
    const r = parseDirectLorebook(json);
    expect(r.format).toBe('risu');
    expect(r.entries).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  test('CCSv3 format: { entries: { ... } } with `keys` array', () => {
    const json = JSON.stringify({
      entries: {
        '0': {
          keys: ['hello', 'world'],
          comment: 'greeting',
          content: 'A greeting entry',
          order: 100,
          constant: false,
          selective: false,
        },
        '1': {
          keys: ['secret'],
          name: 'fallback name field',
          entry: 'fallback content field',
          priority: 50,
          forceActivation: true,
          secondary_keys: ['secret2', 'secret3'],
          selective: true,
        },
      },
    });
    const r = parseDirectLorebook(json);
    expect(r.format).toBe('ccsv3');
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]?.key).toBe('hello, world');
    expect(r.entries[0]?.comment).toBe('greeting');
    expect(r.entries[0]?.content).toBe('A greeting entry');
    expect(r.entries[0]?.insertorder).toBe(100);
    expect(r.entries[0]?.alwaysActive).toBe(false);

    // Fallback fields: name → comment, entry → content, priority → insertorder, forceActivation → alwaysActive
    expect(r.entries[1]?.comment).toBe('fallback name field');
    expect(r.entries[1]?.content).toBe('fallback content field');
    expect(r.entries[1]?.insertorder).toBe(50);
    expect(r.entries[1]?.alwaysActive).toBe(true);
    expect(r.entries[1]?.secondkey).toBe('secret2, secret3');
    expect(r.entries[1]?.selective).toBe(true);
  });

  test('CCSv3 with `keywords` (deeper-fallback) instead of keys', () => {
    const json = JSON.stringify({
      entries: { '0': { keywords: ['kw1', 'kw2'], comment: 'k', content: 'c' } },
    });
    const r = parseDirectLorebook(json);
    expect(r.entries[0]?.key).toBe('kw1, kw2');
  });

  test('CCSv3 contextConfig.budgetPriority wins when no order/priority set', () => {
    const json = JSON.stringify({
      entries: { '0': { keys: ['k'], content: 'c', contextConfig: { budgetPriority: 42 } } },
    });
    const r = parseDirectLorebook(json);
    expect(r.entries[0]?.insertorder).toBe(42);
  });

  test('shape that matches neither → unknown, no entries', () => {
    const json = JSON.stringify({ random: 'data' });
    const r = parseDirectLorebook(json);
    expect(r.format).toBe('unknown');
    expect(r.entries).toHaveLength(0);
  });

  test('CCSv3 entries with bad inner shapes counted in dropped', () => {
    const json = JSON.stringify({
      entries: {
        '0': { keys: ['ok'], content: 'real' },
        '1': null,
        '2': 'also bad',
        '3': { keys: ['ok2'], content: 'real2' },
      },
    });
    const r = parseDirectLorebook(json);
    expect(r.entries).toHaveLength(2);
    expect(r.dropped).toBe(2);
  });
});
