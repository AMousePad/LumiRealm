import { expect, test } from 'bun:test';
import { prepareTriggerSources, triggerMatchesBinding } from '../../src/interpreter/dispatcher.js';
import { analyzeTriggers } from '../../src/core/mappers/triggers.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import { EMITTERS } from '../helpers/trigger-compiler/opcodes/index.js';

const trigger = (type: TriggerScript['type'], comment = 'same name'): TriggerScript => ({
  type, comment, conditions: [], effect: [],
});

test('preparation keeps ordered source references and unique names without generated code', () => {
  const sources = [trigger('manual'), trigger('input'), trigger('display', '')];
  const entries = prepareTriggerSources(sources, 'character');
  expect(entries.map(entry => entry.name)).toEqual([
    'risu-manual-same_name', 'risu-trigger-input-same_name_2', 'risu-trigger-display-display_2',
  ]);
  entries.forEach((entry, index) => {
    expect(entry.source).toBe(sources[index]!);
    expect(entry).not.toHaveProperty('code');
    expect(entry.rtOpts.characterId).toBe('character');
  });
  expect(entries[0]!.type).toBe('library');
  expect(entries[2]!.rtOpts.displayMode).toBe(true);
});

test('a skipped invalid binding cannot shift the next trigger source', () => {
  const invalid = { ...trigger('manual'), type: 'invalid' } as unknown as TriggerScript;
  const valid = trigger('output', 'valid');
  const entries = prepareTriggerSources([invalid, valid], 'character');
  expect(entries).toHaveLength(1);
  expect(entries[0]!.source).toBe(valid);
  expect(triggerMatchesBinding(entries[0]!, 'output')).toBe(true);
  expect(analyzeTriggers([invalid, valid]).issues).toHaveLength(1);
});

test('diagnostics retain all compiled opcode support and count unknown effects', () => {
  for (const type of Object.keys(EMITTERS)) {
    expect(analyzeTriggers([{ ...trigger('manual'), effect: [{ type }] }]).opcodeUnimplemented).toEqual({});
  }
  const result = analyzeTriggers([{ ...trigger('manual'), effect: [
    { type: 'unknownEffect' }, { type: 'unknownEffect' }, { type: 'triggerlua', code: '' },
  ] }]);
  expect(result).toMatchObject({ count: 1, luaCount: 1, opcodeUnimplemented: { unknownEffect: 2 } });
});
