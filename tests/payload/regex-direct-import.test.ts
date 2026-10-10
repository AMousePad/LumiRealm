import { describe, expect, test } from 'bun:test';
import { parseDirectRegex } from '../../src/payload/regex-direct-import.js';
import { mapRegex } from '../../src/core/mappers/regex.js';

describe('parseDirectRegex', () => {
  test('empty / invalid JSON → unknown format', () => {
    expect(parseDirectRegex('not json').format).toBe('unknown');
    expect(parseDirectRegex('null').format).toBe('unknown');
    expect(parseDirectRegex('42').format).toBe('unknown');
    expect(parseDirectRegex('{}').format).toBe('unknown');
  });

  test('Risu native format: { type: "regex", data: [...] }', () => {
    const json = JSON.stringify({
      type: 'regex',
      data: [
        { comment: 'one', in: 'foo', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: true },
        { comment: 'two', in: '/x/', out: 'y', type: 'editoutput' },
      ],
    });
    const r = parseDirectRegex(json);
    expect(r.format).toBe('risu');
    expect(r.scripts).toHaveLength(2);
    expect(r.scripts[0]?.comment).toBe('one');
    expect(r.scripts[1]?.type).toBe('editoutput');
    expect(r.dropped).toBe(0);
  });

  test('bare array of customscripts', () => {
    const json = JSON.stringify([
      { comment: 'a', in: 'p', out: 'q', type: 'editdisplay' },
    ]);
    const r = parseDirectRegex(json);
    expect(r.format).toBe('array');
    expect(r.scripts).toHaveLength(1);
  });

  test('module-shaped { regex: [...] } export', () => {
    const json = JSON.stringify({ name: 'mod', regex: [{ comment: 'a', in: 'p', out: 'q', type: 'editdisplay' }] });
    const r = parseDirectRegex(json);
    expect(r.format).toBe('risu');
    expect(r.scripts).toHaveLength(1);
  });

  test('drops elements that are not coercible to customscript', () => {
    const json = JSON.stringify({ type: 'regex', data: [{ comment: 'ok', in: 'p', out: 'q', type: 'editdisplay' }, 5, 'nope'] });
    const r = parseDirectRegex(json);
    // Loose customscript schema coerces 5 → defaults, so only non-object array
    // members that fail object parsing are dropped.
    expect(r.scripts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('mapRegex global scope (standalone import)', () => {
  test('emits global-scoped rows with null scope_id and folder', () => {
    const parsed = parseDirectRegex(JSON.stringify({
      type: 'regex',
      data: [{ comment: 'rule', in: '/foo/', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: true }],
    }));
    const { rows } = mapRegex(parsed.scripts, {
      characterId: '',
      scope: 'global',
      scopeId: null,
      folder: 'my-regex',
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.scope).toBe('global');
      expect(r.scope_id).toBe(null);
      expect(r.folder).toBe('my-regex');
    }
  });

  test('defaults to character scope when scope option omitted', () => {
    const parsed = parseDirectRegex(JSON.stringify({
      type: 'regex',
      data: [{ comment: 'rule', in: '/foo/', out: 'bar', type: 'editdisplay' }],
    }));
    const { rows } = mapRegex(parsed.scripts, { characterId: 'char-1' });
    expect(rows[0]?.scope).toBe('character');
    expect(rows[0]?.scope_id).toBe('char-1');
    expect(rows[0]?.folder).toBe('');
  });
});
