import { describe, expect, test } from 'bun:test';
import { runTriggerEffects } from '../helpers/trigger-runtime.js';

describe('Risu Lua getState decoding', () => {
  for (const [name, raw, expected] of [
    ['malformed JSON', 'invalid json', 'error:string'],
    ['empty raw text', '', 'error:string'],
    ['missing state', undefined, 'null'],
    ['JSON null', 'null', 'null'],
    ['false', 'false', 'false'],
    ['zero', '0', '0'],
    ['empty JSON string', '""', '""'],
    ['array', '[1,2]', '[1,2]'],
    ['object', '{"enabled":false}', '{"enabled":false}'],
  ] as const) {
    test(name, async () => {
      const { saved } = await runTriggerEffects([{
        type: 'triggerlua', code: `function onStart(id)
          local ok, value = pcall(getState, id, 'value')
          setChatVar(id, 'result', ok and json.encode(value) or ('error:' .. type(value)))
        end`,
      }], raw === undefined ? {} : { __value: raw }, { binding: 'start' });
      expect(saved.result).toBe(expected);
    });
  }

  test('setState and getState preserve false and zero in structured state', async () => {
    const { saved } = await runTriggerEffects([{
      type: 'triggerlua', code: `function onStart(id)
        setState(id, 'value', {enabled = false, count = 0, label = ''})
        setChatVar(id, 'result', json.encode(getState(id, 'value')))
      end`,
    }], {}, { binding: 'start' });
    expect(JSON.parse(saved.result!)).toEqual({ enabled: false, count: 0, label: '' });
  });
});
