import { expect, test } from 'bun:test';
import { translateFromStoredSource } from '../../src/core/pipeline/translate.js';

const trigger = (lowLevelAccess: boolean) => ({
  type: 'output', conditions: [], lowLevelAccess,
  effect: [{ type: 'triggerlua', code: 'onOutput = function() end' }],
});

test.each([
  ['inline grant', true, false, undefined],
  ['inline denial', false, true, undefined],
  ['missing character grant', undefined, true, undefined],
  ['embedded grant overrides module denial', true, false, false],
  ['embedded denial overrides module grant', false, true, true],
  ['embedded grant overrides child denial', true, false, true],
] as const)('%s follows the character permission', (_label, access, child, moduleAccess) => {
  const source = {
    card: { spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Access fixture', extensions: { risuai: {
        lowLevelAccess: access, triggerscript: moduleAccess === undefined ? [trigger(child)] : [],
      } },
    } },
    module: moduleAccess === undefined ? null : {
      id: 'embedded', name: 'Embedded', description: '',
      lowLevelAccess: moduleAccess, trigger: [trigger(child)],
    },
  };
  const original = structuredClone(source);
  const payload = translateFromStoredSource(source, { mode: 'full', emitPackScripts: false }).risuPayload!;
  expect(payload.triggers).toHaveLength(1);
  expect((payload.triggers[0] as { lowLevelAccess: boolean }).lowLevelAccess).toBe(access === true);
  expect(payload.requires.lowLevelAccess).toBe(access === true);
  expect(source).toEqual(original);
});

test('a character access request requires consent even without triggers', () => {
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: 'Access fixture', extensions: { risuai: { lowLevelAccess: true } },
  } };
  const payload = translateFromStoredSource({ card, module: null }, { emitPackScripts: false }).risuPayload!;
  expect(payload.requires.lowLevelAccess).toBe(true);
});
