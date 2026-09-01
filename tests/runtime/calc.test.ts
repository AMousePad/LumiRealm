import { describe, expect, test } from 'bun:test';
import { calcString } from '../../src/interpreter/runtime/calc.js';

describe('calcString', () => {
  test('basic arithmetic', () => {
    expect(calcString('1 + 2')).toBe('3');
    expect(calcString('10 - 4')).toBe('6');
    expect(calcString('3 * 7')).toBe('21');
    expect(calcString('20 / 4')).toBe('5');
    expect(calcString('17 % 5')).toBe('2');
  });

  test('parentheses + precedence', () => {
    expect(calcString('(1 + 2) * 3')).toBe('9');
    expect(calcString('1 + 2 * 3')).toBe('7');
  });

  test('floats', () => {
    expect(calcString('1.5 + 2.5')).toBe('4');
    expect(calcString('0.1 + 0.2')).toMatch(/^0\.3/); // tolerant
  });

  test('rejects non-arithmetic chars → NaN', () => {
    expect(calcString('alert(1)')).toBe('NaN');
    expect(calcString('1; 2')).toBe('NaN'); // ; not allowed
    expect(calcString('a + b')).toBe('NaN');
    expect(calcString("'hello'")).toBe('NaN'); // quote not allowed
  });

  test('division by zero → NaN (Infinity is non-finite)', () => {
    expect(calcString('1 / 0')).toBe('NaN');
  });

  test('null / undefined inputs → NaN (empty string passes char gate, eval throws)', () => {
    expect(calcString(null)).toBe('NaN');
    expect(calcString(undefined)).toBe('NaN');
  });

  test('non-numeric result → NaN', () => {
    // Empty parens have no expression; Pratt parser throws → 'NaN'.
    expect(calcString('()')).toBe('NaN');
  });

  // ─── Pratt parser semantics ──────────────────────────────────────────
  // Pinned post-Prep-E (commit a474ef5 froze `globalThis.Function`, so
  // we can't fall back to `new Function('return (' + s + ')')`). The
  // parser is in `src/interpreter/runtime/calc.ts` with a verbatim JS
  // mirror in `src/core/runtime-library.ts` (LIBRARY_CODE template).

  test('** is right-associative', () => {
    // 2 ** 3 ** 2  =  2 ** (3 ** 2)  =  2 ** 9  =  512
    expect(calcString('2 ** 3 ** 2')).toBe('512');
  });

  test('unary minus binds tighter than ** (per the doc spec)', () => {
    // `-2 ** 3` parses as `(-2) ** 3 = -8`. JS itself rejects this as
    // a syntax error at the language level; we explicitly resolve it
    // (stage-pull doc says `-2 ** 3 = -8`).
    expect(calcString('-2 ** 3')).toBe('-8');
    // Negative result via unary on a higher-precedence term.
    expect(calcString('-(2 ** 3)')).toBe('-8');
  });

  test('unary plus + chained negation', () => {
    expect(calcString('+5')).toBe('5');
    expect(calcString('--5')).toBe('5');
    expect(calcString('-+-5')).toBe('5');
  });

  test('** in larger expressions', () => {
    expect(calcString('2 + 3 ** 2')).toBe('11');
    expect(calcString('(2 + 3) ** 2')).toBe('25');
  });

  test('unmatched parens → NaN', () => {
    expect(calcString('(1 + 2')).toBe('NaN'); // missing close
    expect(calcString('1 + 2)')).toBe('NaN'); // trailing close
  });

  test('whitespace is ignored across tokens', () => {
    expect(calcString('  3   *   ( 4 + 5 )  ')).toBe('27');
    expect(calcString('1+2')).toBe('3'); // no spaces also fine
  });

  test('rejects malformed numbers', () => {
    expect(calcString('1.2.3')).toBe('NaN'); // multiple dots
    expect(calcString('. + 1')).toBe('NaN');  // bare dot
  });

  test('eval-bypass attempts → NaN (no Function constructor reachable)', () => {
    // Verifies the parser is the actual evaluator — no string-eval
    // fallback can be triggered by clever input. Each below contains
    // characters our tokenizer rejects.
    expect(calcString('1 + alert(1)')).toBe('NaN');
    expect(calcString("Function('x')(1)")).toBe('NaN');
    expect(calcString('process.env.PATH')).toBe('NaN');
    expect(calcString('this[`constructor`]')).toBe('NaN');
  });
});
