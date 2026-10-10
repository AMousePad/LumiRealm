import { describe, expect, test } from 'bun:test';
import { transformPresetTemplate } from '../../../src/core/preset/risup-translator.js';

describe('preset nested calculations', () => {
  test.each([
    ['{{? 1 + {{? 2 * 3}}}}', '{{risuCalc::1 + {{risuCalc::2 * 3}}}}'],
    ['{{? {{? {{? 2}} + 3}} * 4}}', '{{risuCalc::{{risuCalc::{{risuCalc::2}} + 3}} * 4}}'],
    ['{{? {{getglobalvar::x}} + {{? 2}}}}', '{{risuCalc::{{risuGlobalVar::x}} + {{risuCalc::2}}}}'],
    ['{{eq::{{? 1 + {{? 2}}}}::3}}', '{{eq::{{risuCalc::1 + {{risuCalc::2}}}}::3}}'],
    ['{{? 1}} / {{? 2}}', '{{risuCalc::1}} / {{risuCalc::2}}'],
  ])('translates %s', (input, expected) => {
    expect(transformPresetTemplate(input)).toBe(expected);
    expect(transformPresetTemplate(expected)).toBe(expected);
  });

  test.each(['before {{? 123', '{{? 1 + {{? 2}}'])('preserves an unterminated calculation: %s', (input) => {
    expect(transformPresetTemplate(input)).toBe(input);
  });
});
