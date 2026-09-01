/**
 * Coverage for three pure state stores that were previously untested:
 * `variables-state.ts`, `defaults-cache.ts`, `settings-store.ts`.
 *
 * Each is small and isolated; this batch ensures their semantic
 * contracts (signature dedup, character-vs-chat scoping, sampler
 * normalization, schema migration) are pinned so future refactors
 * don't silently break the var-update / panel-render / aux-model
 * paths that depend on them.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { VariableStateStore } from '../../src/state/variables-state.js';
import {
  setActiveScriptstateDefaults,
  clearActiveScriptstateDefaults,
  getActiveScriptstateDefaults,
  getScriptstateDefaultsByCharacter,
  resetAllScriptstateDefaults,
} from '../../src/interpreter/defaults-cache.js';
import {
  isStoredSettings,
  normalizeSamplers,
  normalizeSettingsPatch,
  mergeSettings,
  DEFAULT_SETTINGS,
  type RisuCompatSettings,
} from '../../src/state/settings-store.js';

// ─── VariableStateStore ─────────────────────────────────────────────────

describe('VariableStateStore: applySnapshot dedup + seq', () => {
  test('first snapshot for a chat: changed=true, seq=1', () => {
    const s = new VariableStateStore();
    const r = s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    expect(r.changed).toBe(true);
    expect(r.entry.seq).toBe(1);
    expect(r.entry.scopes.local).toEqual({ a: '1' });
  });

  test('identical snapshot: changed=false, seq unchanged', () => {
    const s = new VariableStateStore();
    s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    const r = s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    expect(r.changed).toBe(false);
    expect(r.entry.seq).toBe(1);
  });

  test('signature is order-insensitive for equivalent maps', () => {
    const s = new VariableStateStore();
    s.applySnapshot('c-1', { local: { b: '2', a: '1' }, global: {}, chat: {} }, {});
    const r = s.applySnapshot('c-1', { local: { a: '1', b: '2' }, global: {}, chat: {} }, {});
    expect(r.changed).toBe(false); // same content, different insertion order
  });

  test('any value change triggers a new snapshot', () => {
    const s = new VariableStateStore();
    s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    const r = s.applySnapshot('c-1', { local: { a: '2' }, global: {}, chat: {} }, {});
    expect(r.changed).toBe(true);
    expect(r.entry.seq).toBe(2);
  });

  test('defaults change is also detected', () => {
    const s = new VariableStateStore();
    s.applySnapshot('c-1', { local: {}, global: {}, chat: {} }, { phase: 'A' });
    const r = s.applySnapshot('c-1', { local: {}, global: {}, chat: {} }, { phase: 'B' });
    expect(r.changed).toBe(true);
    expect(r.entry.seq).toBe(2);
  });

  test('per-chat scoping: chat-A snapshot doesn t affect chat-B sequence', () => {
    const s = new VariableStateStore();
    s.applySnapshot('A', { local: { a: '1' }, global: {}, chat: {} }, {});
    s.applySnapshot('A', { local: { a: '2' }, global: {}, chat: {} }, {});
    const rB = s.applySnapshot('B', { local: { x: 'y' }, global: {}, chat: {} }, {});
    expect(rB.entry.seq).toBe(1); // chat B's first push
    expect(s.current('A')!.seq).toBe(2);
  });

  test('current() returns last entry; null for unknown chat', () => {
    const s = new VariableStateStore();
    expect(s.current('unknown')).toBeNull();
    s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    expect(s.current('c-1')!.scopes.local).toEqual({ a: '1' });
  });

  test('clearChat drops state', () => {
    const s = new VariableStateStore();
    s.applySnapshot('c-1', { local: { a: '1' }, global: {}, chat: {} }, {});
    s.clearChat('c-1');
    expect(s.current('c-1')).toBeNull();
  });

  test('reset wipes all state', () => {
    const s = new VariableStateStore();
    s.applySnapshot('A', { local: {}, global: {}, chat: {} }, {});
    s.applySnapshot('B', { local: {}, global: {}, chat: {} }, {});
    s.reset();
    expect(s.current('A')).toBeNull();
    expect(s.current('B')).toBeNull();
  });

  test('snapshot data is COPIED (mutating input post-apply does not change stored state)', () => {
    const s = new VariableStateStore();
    const local = { a: '1' };
    s.applySnapshot('c-1', { local, global: {}, chat: {} }, {});
    local['a'] = 'mutated';
    expect(s.current('c-1')!.scopes.local).toEqual({ a: '1' });
  });
});

// ─── defaults-cache ─────────────────────────────────────────────────────

describe('defaults-cache: setActiveScriptstateDefaults + lookups', () => {
  beforeEach(() => resetAllScriptstateDefaults());

  test('lookup via chatId returns the active character s defaults', () => {
    setActiveScriptstateDefaults('chat-1', 'char-1', { phase: 'A', icon: 'a.png' });
    expect(getActiveScriptstateDefaults('chat-1')).toEqual({ phase: 'A', icon: 'a.png' });
  });

  test('lookup via characterId returns the same data', () => {
    setActiveScriptstateDefaults('chat-1', 'char-1', { phase: 'A' });
    expect(getScriptstateDefaultsByCharacter('char-1')).toEqual({ phase: 'A' });
  });

  test('null/empty chatId returns null cleanly', () => {
    expect(getActiveScriptstateDefaults(null)).toBeNull();
    expect(getActiveScriptstateDefaults(undefined)).toBeNull();
    expect(getActiveScriptstateDefaults('')).toBeNull();
  });

  test('unknown chatId returns null', () => {
    expect(getActiveScriptstateDefaults('never-seen')).toBeNull();
  });

  test('character-level: two chats on the same character share defaults via the byCharacter index', () => {
    setActiveScriptstateDefaults('chat-A', 'char-1', { phase: 'A' });
    setActiveScriptstateDefaults('chat-B', 'char-1', { phase: 'B' });
    // Both chats resolve via the byCharacter map, which got the LAST
    // write (overwrite). Per the comment in defaults-cache.ts this is
    // intentional: defaults are character-level, not chat-level. Last
    // import wins.
    expect(getActiveScriptstateDefaults('chat-A')).toEqual({ phase: 'B' });
    expect(getActiveScriptstateDefaults('chat-B')).toEqual({ phase: 'B' });
    expect(getScriptstateDefaultsByCharacter('char-1')).toEqual({ phase: 'B' });
  });

  test('clearActiveScriptstateDefaults drops chat→character binding only', () => {
    setActiveScriptstateDefaults('chat-1', 'char-1', { phase: 'A' });
    clearActiveScriptstateDefaults('chat-1');
    // chat lookup misses
    expect(getActiveScriptstateDefaults('chat-1')).toBeNull();
    // character lookup still works (other chats may need it)
    expect(getScriptstateDefaultsByCharacter('char-1')).toEqual({ phase: 'A' });
  });

  test('resetAll clears both indexes', () => {
    setActiveScriptstateDefaults('chat-1', 'char-1', { phase: 'A' });
    resetAllScriptstateDefaults();
    expect(getActiveScriptstateDefaults('chat-1')).toBeNull();
    expect(getScriptstateDefaultsByCharacter('char-1')).toBeNull();
  });
});

// ─── settings-store ─────────────────────────────────────────────────────

describe('settings-store: schema validation + sampler normalization', () => {
  test('isStoredSettings accepts a valid stored shape', () => {
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: 'uuid-1',
      auxModelOverride: 'gpt-test',
      auxSamplers: {},
    })).toBe(true);
  });

  test('isStoredSettings accepts null connection / model (use default)', () => {
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: null,
      auxModelOverride: null,
      auxSamplers: {},
    })).toBe(true);
  });

  test('isStoredSettings rejects wrong schema_version', () => {
    expect(isStoredSettings({ schema_version: 2 })).toBe(false);
    expect(isStoredSettings({ schema_version: '1' })).toBe(false);
    expect(isStoredSettings({})).toBe(false);
  });

  test('isStoredSettings rejects non-object', () => {
    expect(isStoredSettings(null)).toBe(false);
    expect(isStoredSettings('a')).toBe(false);
    expect(isStoredSettings(42)).toBe(false);
  });

  test('isStoredSettings rejects mistyped fields', () => {
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: 42, // not string|null
      auxModelOverride: null,
    })).toBe(false);
  });

  test('normalizeSamplers preserves valid numbers', () => {
    expect(normalizeSamplers({ temperature: 0.7, maxTokens: 4096 })).toEqual({
      temperature: 0.7,
      maxTokens: 4096,
      contextSize: null,
      topP: null,
      minP: null,
      topK: null,
      frequencyPenalty: null,
      presencePenalty: null,
      repetitionPenalty: null,
    });
  });

  test('normalizeSamplers rejects strings, NaN, Infinity', () => {
    const r = normalizeSamplers({
      temperature: '0.7' as unknown as number,
      maxTokens: NaN,
      topP: Infinity,
      minP: -Infinity,
      topK: undefined,
    });
    expect(r.temperature).toBeNull();
    expect(r.maxTokens).toBeNull();
    expect(r.topP).toBeNull();
    expect(r.minP).toBeNull();
    expect(r.topK).toBeNull();
  });

  test('normalizeSamplers handles non-object input', () => {
    expect(normalizeSamplers(null)).toEqual({
      temperature: null, maxTokens: null, contextSize: null,
      topP: null, minP: null, topK: null,
      frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
    });
    expect(normalizeSamplers('not an object')).toEqual({
      temperature: null, maxTokens: null, contextSize: null,
      topP: null, minP: null, topK: null,
      frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
    });
  });

  test('normalizeSettingsPatch trims string values, collapses empty to null', () => {
    expect(normalizeSettingsPatch({ auxConnectionId: '  uuid-1  ' })).toEqual({
      auxConnectionId: 'uuid-1',
    });
    expect(normalizeSettingsPatch({ auxConnectionId: '   ' })).toEqual({
      auxConnectionId: null,
    });
    expect(normalizeSettingsPatch({ auxConnectionId: null })).toEqual({
      auxConnectionId: null,
    });
  });

  test('normalizeSettingsPatch drops unknown fields silently', () => {
    expect(normalizeSettingsPatch({
      auxConnectionId: 'a',
      malicious_key: 'should not appear',
      __proto__: { polluted: true },
    } as Record<string, unknown>)).toEqual({ auxConnectionId: 'a' });
  });

  test('mergeSettings overlays patch on top of base, preserves schema_version', () => {
    const base: RisuCompatSettings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'old',
    };
    const merged = mergeSettings(base, { auxConnectionId: 'new' });
    expect(merged.auxConnectionId).toBe('new');
    expect(merged.schema_version).toBe(1);
    expect(merged.auxSamplers).toEqual(DEFAULT_SETTINGS.auxSamplers);
  });

  test('mergeSettings preserves unset fields from base', () => {
    const base: RisuCompatSettings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'keep-me',
      auxModelOverride: 'also-keep',
    };
    const merged = mergeSettings(base, { auxSamplers: {
      ...DEFAULT_SETTINGS.auxSamplers,
      temperature: 0.5,
    } });
    expect(merged.auxConnectionId).toBe('keep-me');
    expect(merged.auxModelOverride).toBe('also-keep');
    expect(merged.auxSamplers.temperature).toBe(0.5);
  });
});

// ─── settings-store: submodel routing (Phase 5) ──────────────────────────
//
// V2-effect `runLLM(model='submodel')` routes through an independent
// connection slot — separate from `axLLMMain`'s aux connection. Risu has
// these as two distinct user settings (axmodel + submodel); we mirror.
// Empty submodel fields fall back to aux at runtime, but the stored
// settings shape keeps them as independent slots.

describe('settings-store: submodel routing fields (Phase 5)', () => {
  test('DEFAULT_SETTINGS includes submodel fields, all null/inherit', () => {
    expect(DEFAULT_SETTINGS.submodelConnectionId).toBeNull();
    expect(DEFAULT_SETTINGS.submodelModelOverride).toBeNull();
    expect(DEFAULT_SETTINGS.submodelSamplers).toEqual(DEFAULT_SETTINGS.auxSamplers);
  });

  test('isStoredSettings accepts shape with submodel fields populated', () => {
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: 'aux-uuid',
      auxModelOverride: 'gpt-4',
      submodelConnectionId: 'sub-uuid',
      submodelModelOverride: 'gpt-3.5-turbo',
    })).toBe(true);
  });

  test('isStoredSettings accepts old shape WITHOUT submodel fields (forward-compat)', () => {
    // Pre-Phase-5 setting files persisted to userStorage will not have
    // these keys. The loader must accept them and fill in defaults.
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: 'aux-uuid',
      auxModelOverride: null,
    })).toBe(true);
  });

  test('isStoredSettings rejects mistyped submodel fields', () => {
    expect(isStoredSettings({
      schema_version: 1,
      auxConnectionId: null,
      auxModelOverride: null,
      submodelConnectionId: 42, // wrong type
    })).toBe(false);
  });

  test('normalizeSettingsPatch handles submodelConnectionId trim + empty→null', () => {
    expect(normalizeSettingsPatch({ submodelConnectionId: '  uuid-123  ' }))
      .toEqual({ submodelConnectionId: 'uuid-123' });
    expect(normalizeSettingsPatch({ submodelConnectionId: '   ' }))
      .toEqual({ submodelConnectionId: null });
    expect(normalizeSettingsPatch({ submodelConnectionId: null }))
      .toEqual({ submodelConnectionId: null });
  });

  test('normalizeSettingsPatch handles submodelModelOverride same way', () => {
    expect(normalizeSettingsPatch({ submodelModelOverride: '  gpt-4  ' }))
      .toEqual({ submodelModelOverride: 'gpt-4' });
    expect(normalizeSettingsPatch({ submodelModelOverride: '' }))
      .toEqual({ submodelModelOverride: null });
  });

  test('normalizeSettingsPatch normalizes submodelSamplers via the same sampler validator', () => {
    const out = normalizeSettingsPatch({
      submodelSamplers: { temperature: 0.7, maxTokens: 'invalid' as unknown },
    });
    expect(out.submodelSamplers?.temperature).toBe(0.7);
    expect(out.submodelSamplers?.maxTokens).toBeNull(); // string dropped per normalizeSamplers
  });

  test('mergeSettings: aux + submodel are independent', () => {
    const base: RisuCompatSettings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'aux-1',
      submodelConnectionId: 'sub-1',
    };
    // Update aux only — submodel preserved.
    const m1 = mergeSettings(base, { auxConnectionId: 'aux-2' });
    expect(m1.auxConnectionId).toBe('aux-2');
    expect(m1.submodelConnectionId).toBe('sub-1');
    // Update submodel only — aux preserved.
    const m2 = mergeSettings(base, { submodelConnectionId: 'sub-2' });
    expect(m2.auxConnectionId).toBe('aux-1');
    expect(m2.submodelConnectionId).toBe('sub-2');
  });
});

describe('settings-store: translateEnabled', () => {
  test('DEFAULT_SETTINGS sets translateEnabled to true', () => {
    expect(DEFAULT_SETTINGS.translateEnabled).toBe(true);
  });

  test('normalizeSettingsPatch coerces translateEnabled to boolean', () => {
    expect(normalizeSettingsPatch({ translateEnabled: false })).toEqual({ translateEnabled: false });
    expect(normalizeSettingsPatch({ translateEnabled: true })).toEqual({ translateEnabled: true });
    expect(normalizeSettingsPatch({ translateEnabled: 1 as unknown as boolean })).toEqual({ translateEnabled: true });
    expect(normalizeSettingsPatch({ translateEnabled: 0 as unknown as boolean })).toEqual({ translateEnabled: false });
  });

  test('normalizeSettingsPatch omits the field when not present', () => {
    expect(normalizeSettingsPatch({})).toEqual({});
  });
});
