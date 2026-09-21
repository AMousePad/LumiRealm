import { describe, expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { parseDisplayCaller } from '../../src/display/caller-parser.js';
import { createLuaTemplateParser } from '../../src/interpreter/runtime/template.js';

const input = { template: '', phase: 'display' as const, reparseMacroResults: false,
  chatId: '', userName: 'User', charName: 'Character', character: {}, chat: {}, variables: {} };
const names = ['tonumber', 'unicodeencode', 'fromhex', 'tohex', 'crypt', 'metadata'];
const values: readonly (readonly [string, string])[] = [
  ['{{tonumber::}}', ''],
  ['{{tonumber::-12.3x}}', '12.3'],
  ['{{tonumber::{{upper::}}}}', ''],
  ['{{unicodeencode::}}', 'NaN'],
  ['{{unicode_encode::A}}', '65'],
  ['{{unicodeencode::AB::1}}', '66'],
  ['{{unicodeencode::A::4}}', 'NaN'],
  ['{{fromhex::}}', 'NaN'],
  ['{{fromhex::FF}}', '255'],
  ['{{tohex::}}', 'NaN'],
  ['{{tohex::255}}', 'ff'],
  ['{{crypt::}}', ''],
  ['{{crypt::A}}', '\u8041'],
  ['{{caesar::A::0}}', 'A'],
  ['{{encrypt::A::}}', '\u8041'],
  ['{{decrypt::A::NaN}}', '\u8041'],
  ['{{metadata::}}', 'Error:  is not a valid metadata key.'],
  ['{{metadata::imateapot}}', '🫖'],
  ['{{metadata::unknown}}', 'Error: unknown is not a valid metadata key.'],
  ['{{#func f}}{{tonumber}}{{/func}}{{call::f}}', '{{tonumber}}'],
];
const callers = {
  pipeline: (template: string) => runPipeline({ ...input, template }),
  display: (template: string) => parseDisplayCaller({ ...input, template }, { touched: new Set(), volatile: false }),
  lua: createLuaTemplateParser(() => ({ ...input, commit: false }), () => 'null'),
};

describe('omitted scalar arguments', () => {
  for (const [caller, evaluate] of Object.entries(callers)) {
    for (const name of [...names, 'unicode_encode', 'crypto', 'caesar', 'encrypt', 'decrypt']) {
      for (const spelling of [name, ' _' + name.toUpperCase().split('').join('_') + ' ']) {
        test(`${caller}: omitted ${spelling}`, () => {
          const template = `{{${spelling}}}`;
          expect(evaluate(template)).toBe(name === 'fromhex' || name === 'tohex' ? 'NaN' : template);
        });
      }
    }
    for (const [template, expected] of values) test(`${caller}: ${template}`, () => {
      expect(evaluate(template)).toBe(expected);
    });
  }
});
