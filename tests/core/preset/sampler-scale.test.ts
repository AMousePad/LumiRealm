import { expect, test } from 'bun:test';
import { translateRisuPreset } from '../../../src/core/preset/risup-translator';

test('Risu percentage samplers use provider units even below ten', () => {
  for (const temperature of [0, 1, 5, 10, 80, 100]) {
    const result = translateRisuPreset({ temperature, frequencyPenalty: 70, PresensePenalty: -30, top_p: 0.9, min_p: 0.05 });
    expect(result.preset.parameters?.samplerOverrides).toMatchObject({
      temperature: temperature / 100, frequencyPenalty: 0.7, presencePenalty: -0.3, topP: 0.9, minP: 0.05,
    });
  }
});

test('unset samplers stay unset and native probability units are preserved', () => {
  expect(translateRisuPreset({ temperature: -1000, frequencyPenalty: -1000, PresensePenalty: -1000 }).preset.parameters?.samplerOverrides)
    .toMatchObject({ temperature: null, frequencyPenalty: null, presencePenalty: null });
  expect(translateRisuPreset({ top_p: 2, min_p: 3 }).preset.parameters?.samplerOverrides)
    .toMatchObject({ topP: 2, minP: 3 });
});
