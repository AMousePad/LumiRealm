import { describe, expect, test } from 'bun:test';
import { samplersToWire } from '../../src/util/samplers-wire.js';
import type { AuxSamplerOverrides } from '../../src/state/settings-store.js';

const ALL_NULL: AuxSamplerOverrides = {
  temperature: null, maxTokens: null, contextSize: null,
  topP: null, minP: null, topK: null,
  frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
};

describe('samplersToWire', () => {
  test('null/undefined input → null', () => {
    expect(samplersToWire(null)).toBe(null);
    expect(samplersToWire(undefined)).toBe(null);
  });

  test('all-null → null (every sampler unset → omit `parameters` from WS)', () => {
    expect(samplersToWire(ALL_NULL)).toBe(null);
  });

  test('camelCase → snake_case mapping', () => {
    expect(samplersToWire({ ...ALL_NULL, temperature: 0.7 })).toEqual({ temperature: 0.7 });
    expect(samplersToWire({ ...ALL_NULL, maxTokens: 4096 })).toEqual({ max_tokens: 4096 });
    expect(samplersToWire({ ...ALL_NULL, contextSize: 8192 })).toEqual({ max_context_length: 8192 });
    expect(samplersToWire({ ...ALL_NULL, topP: 0.9 })).toEqual({ top_p: 0.9 });
    expect(samplersToWire({ ...ALL_NULL, minP: 0.05 })).toEqual({ min_p: 0.05 });
    expect(samplersToWire({ ...ALL_NULL, topK: 40 })).toEqual({ top_k: 40 });
    expect(samplersToWire({ ...ALL_NULL, frequencyPenalty: 0.5 })).toEqual({ frequency_penalty: 0.5 });
    expect(samplersToWire({ ...ALL_NULL, presencePenalty: 0.3 })).toEqual({ presence_penalty: 0.3 });
    expect(samplersToWire({ ...ALL_NULL, repetitionPenalty: 1.1 })).toEqual({ repetition_penalty: 1.1 });
  });

  test('mixed set + null fields → only set fields appear', () => {
    const r = samplersToWire({
      ...ALL_NULL,
      temperature: 0.8,
      topP: 0.95,
      frequencyPenalty: 0.4,
    });
    expect(r).toEqual({
      temperature: 0.8,
      top_p: 0.95,
      frequency_penalty: 0.4,
    });
  });

  test('zero values preserved (not treated as null)', () => {
    expect(samplersToWire({ ...ALL_NULL, temperature: 0 })).toEqual({ temperature: 0 });
    expect(samplersToWire({ ...ALL_NULL, frequencyPenalty: 0 })).toEqual({ frequency_penalty: 0 });
  });

  test('all 9 fields set → all 9 wire keys present', () => {
    const r = samplersToWire({
      temperature: 0.7,
      maxTokens: 1024,
      contextSize: 4096,
      topP: 0.9,
      minP: 0.05,
      topK: 50,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      repetitionPenalty: 1.05,
    });
    expect(r).toEqual({
      temperature: 0.7,
      max_tokens: 1024,
      max_context_length: 4096,
      top_p: 0.9,
      min_p: 0.05,
      top_k: 50,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      repetition_penalty: 1.05,
    });
  });
});
