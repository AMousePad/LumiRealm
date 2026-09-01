import { describe, test, expect } from 'bun:test';
import {
  buildDispatchSeams,
  type BuildDispatchSeamsArgs,
} from '../../src/state/dispatch-seams.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';

const NOOP_REMEMBER = (_chatId: string, _msgId: string, _content: string): void => { void _chatId; void _msgId; void _content; };
const NOOP_STATE_CHANGED = (): void => { /* no-op */ };
const NOOP_RESOLVE = async (text: string): Promise<string> => text;

function baseArgs(overrides?: Partial<BuildDispatchSeamsArgs>): BuildDispatchSeamsArgs {
  return {
    chatId: 'chat-1',
    binding: 'start',
    settings: DEFAULT_SETTINGS,
    rememberOurWrite: NOOP_REMEMBER,
    stateChanged: NOOP_STATE_CHANGED,
    auxDebugCapture: undefined,
    resolveTemplate: NOOP_RESOLVE,
    ...overrides,
  };
}

describe('buildDispatchSeams', () => {
  test('default settings: every settings field copied verbatim', () => {
    const seams = buildDispatchSeams(baseArgs());
    expect(seams.auxConnectionId).toBe(DEFAULT_SETTINGS.auxConnectionId);
    expect(seams.auxModelOverride).toBe(DEFAULT_SETTINGS.auxModelOverride);
    expect(seams.auxSamplers).toBe(DEFAULT_SETTINGS.auxSamplers);
    expect(seams.submodelConnectionId).toBe(DEFAULT_SETTINGS.submodelConnectionId);
    expect(seams.submodelModelOverride).toBe(DEFAULT_SETTINGS.submodelModelOverride);
    expect(seams.submodelSamplers).toBe(DEFAULT_SETTINGS.submodelSamplers);
  });

  test('passes through chatId / binding / callbacks', () => {
    const remember = (_c: string, _m: string, _ct: string): void => { void _c; void _m; void _ct; };
    const stateChanged = (): void => { /* */ };
    const resolveTemplate = async (text: string): Promise<string> => `RESOLVED:${text}`;
    const seams = buildDispatchSeams(baseArgs({
      chatId: 'chat-7',
      binding: 'output',
      rememberOurWrite: remember,
      stateChanged,
      resolveTemplate,
    }));
    expect(seams.chatId).toBe('chat-7');
    expect(seams.binding).toBe('output');
    expect(seams.rememberOurWrite).toBe(remember);
    expect(seams.stateChanged).toBe(stateChanged);
    expect(seams.resolveTemplate).toBe(resolveTemplate);
  });

  test('omits auxDebugCapture key when callback is undefined', () => {
    const seams = buildDispatchSeams(baseArgs({ auxDebugCapture: undefined }));
    expect('auxDebugCapture' in seams).toBe(false);
  });

  test('includes auxDebugCapture key when callback is provided', () => {
    const cb = (_event: never): void => { void _event; };
    const seams = buildDispatchSeams(baseArgs({ auxDebugCapture: cb as never }));
    expect('auxDebugCapture' in seams).toBe(true);
    expect(seams.auxDebugCapture).toBe(cb as never);
  });

  test('settings with populated connection IDs round-trip exactly', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'conn-aux-1',
      auxModelOverride: 'model-aux-1',
      submodelConnectionId: 'conn-sub-1',
      submodelModelOverride: 'model-sub-1',
    };
    const seams = buildDispatchSeams(baseArgs({ settings }));
    expect(seams.auxConnectionId).toBe('conn-aux-1');
    expect(seams.auxModelOverride).toBe('model-aux-1');
    expect(seams.submodelConnectionId).toBe('conn-sub-1');
    expect(seams.submodelModelOverride).toBe('model-sub-1');
  });

  test('settings with null connection IDs preserve null (not coerced to undefined)', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: null,
      auxModelOverride: null,
      submodelConnectionId: null,
      submodelModelOverride: null,
    };
    const seams = buildDispatchSeams(baseArgs({ settings }));
    expect(seams.auxConnectionId).toBeNull();
    expect(seams.auxModelOverride).toBeNull();
    expect(seams.submodelConnectionId).toBeNull();
    expect(seams.submodelModelOverride).toBeNull();
  });

  test('all 9 aux sampler fields round-trip when populated', () => {
    const auxSamplers = {
      temperature: 0.7,
      maxTokens: 4096,
      contextSize: 8192,
      topP: 0.9,
      minP: 0.05,
      topK: 40,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      repetitionPenalty: 1.05,
    };
    const seams = buildDispatchSeams(baseArgs({
      settings: { ...DEFAULT_SETTINGS, auxSamplers },
    }));
    expect(seams.auxSamplers).toEqual(auxSamplers);
  });

  test('all 9 submodel sampler fields round-trip when populated', () => {
    const submodelSamplers = {
      temperature: 0.5,
      maxTokens: 2048,
      contextSize: 4096,
      topP: 0.85,
      minP: 0.03,
      topK: 20,
      frequencyPenalty: null,
      presencePenalty: null,
      repetitionPenalty: 1.1,
    };
    const seams = buildDispatchSeams(baseArgs({
      settings: { ...DEFAULT_SETTINGS, submodelSamplers },
    }));
    expect(seams.submodelSamplers).toEqual(submodelSamplers);
  });

  test('mixed-null sampler bag preserves nulls per-field', () => {
    const auxSamplers = {
      temperature: 0.7,
      maxTokens: null,
      contextSize: 8192,
      topP: null,
      minP: null,
      topK: 40,
      frequencyPenalty: null,
      presencePenalty: null,
      repetitionPenalty: null,
    };
    const seams = buildDispatchSeams(baseArgs({
      settings: { ...DEFAULT_SETTINGS, auxSamplers },
    }));
    expect(seams.auxSamplers).toEqual(auxSamplers);
  });

  test('parity: produces same shape as inline construction (Pattern A withDispatchContext)', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'conn-aux',
      submodelConnectionId: 'conn-sub',
    };
    const remember = NOOP_REMEMBER;
    const stateChanged = NOOP_STATE_CHANGED;
    const resolveTemplate = NOOP_RESOLVE;

    const inline = {
      chatId: 'chat-1',
      rememberOurWrite: remember,
      binding: 'start',
      stateChanged,
      auxConnectionId: settings.auxConnectionId,
      auxModelOverride: settings.auxModelOverride,
      auxSamplers: settings.auxSamplers,
      submodelConnectionId: settings.submodelConnectionId,
      submodelModelOverride: settings.submodelModelOverride,
      submodelSamplers: settings.submodelSamplers,
      auxPrefillCompat: settings.auxPrefillCompat,
      submodelPrefillCompat: settings.submodelPrefillCompat,
      resolveTemplate,
    };

    const helper = buildDispatchSeams({
      chatId: 'chat-1',
      binding: 'start',
      settings,
      rememberOurWrite: remember,
      stateChanged,
      auxDebugCapture: undefined,
      resolveTemplate,
    });

    expect(helper).toEqual(inline);
  });

  test('parity: produces same shape as inline construction (Pattern B with auxDebugCapture)', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      auxConnectionId: 'conn-aux',
      auxModelOverride: 'model-aux',
    };
    const cb = (_event: never): void => { void _event; };
    const remember = NOOP_REMEMBER;
    const stateChanged = NOOP_STATE_CHANGED;
    const resolveTemplate = NOOP_RESOLVE;

    const inline = {
      chatId: 'chat-2',
      rememberOurWrite: remember,
      binding: 'manual',
      stateChanged,
      auxConnectionId: settings.auxConnectionId,
      auxModelOverride: settings.auxModelOverride,
      auxSamplers: settings.auxSamplers,
      submodelConnectionId: settings.submodelConnectionId,
      submodelModelOverride: settings.submodelModelOverride,
      submodelSamplers: settings.submodelSamplers,
      auxPrefillCompat: settings.auxPrefillCompat,
      submodelPrefillCompat: settings.submodelPrefillCompat,
      auxDebugCapture: cb,
      resolveTemplate,
    };

    const helper = buildDispatchSeams({
      chatId: 'chat-2',
      binding: 'manual',
      settings,
      rememberOurWrite: remember,
      stateChanged,
      auxDebugCapture: cb as never,
      resolveTemplate,
    });

    expect(helper).toEqual(inline as never);
  });

  test('returned seams object is fresh (does not alias settings.auxSamplers reference)', () => {
    const seams1 = buildDispatchSeams(baseArgs());
    const seams2 = buildDispatchSeams(baseArgs());
    expect(seams1).not.toBe(seams2);
    expect(seams1.auxSamplers).toBe(DEFAULT_SETTINGS.auxSamplers);
  });

  test('different bindings ride through independently', () => {
    for (const binding of ['start', 'request', 'output', 'display', 'manual', 'input']) {
      const seams = buildDispatchSeams(baseArgs({ binding }));
      expect(seams.binding).toBe(binding);
    }
  });
});
