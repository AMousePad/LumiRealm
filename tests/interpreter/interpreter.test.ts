/**
 * Step 4 evidence — interpreter dispatcher end-to-end.
 *
 * The 29-test suite at `packages/core/tests/runtime.integration.test.ts` stays
 * the authoritative proof of Risu-semantic parity for emitted trigger code.
 * This file duplicates the critical subset through the extension's dispatcher
 * path — compileTriggers → AsyncFunction → TS runtime — so a regression in the
 * interpreter pipeline fails here even if the core harness is untouched.
 *
 * If you add a new opcode in core, also add it to the core integration
 * test (authoritative) and optionally mirror here. The shape is stable.
 */

import { describe, test, expect } from 'bun:test';
import type { TriggerScript } from '../../src/core/schemas/index.js';
import {
  prepareTriggers,
  dispatchBinding,
  dispatchByManualName,
  makeDispatcherScriptNS,
  registerManualTriggers,
} from '../../src/interpreter/dispatcher.js';
import type { HostApi, HostMessage, DispatchData } from '../../src/interpreter/host.js';
import type { RisuPayload } from '../../src/core/payload/index.js';

// ─── Mock HostApi ────────────────────────────────────────────────────────────

interface MockState {
  chatId: string;
  messages: HostMessage[];
  chatMetadata: Record<string, unknown>;
  injections: { id: string; content: string; opts?: unknown }[];
  characterDescs: Record<string, string>;
  emotions: string[];
}

function makeMockState(over: Partial<MockState> = {}): MockState {
  return {
    chatId: over.chatId ?? 'chat-1',
    messages: over.messages ?? [],
    chatMetadata: over.chatMetadata ?? {},
    injections: over.injections ?? [],
    characterDescs: over.characterDescs ?? {},
    emotions: over.emotions ?? [],
  };
}

function makeMockApi(state: MockState): HostApi {
  let idCounter = state.messages.length + 1;
  return {
    chat: {
      getChatId: () => state.chatId,
      async getMessages() { return state.messages.map((m) => ({ ...m })); },
      async sendMessage(content: string, opts?: { role?: string }) {
        const id = `m${idCounter++}`;
        state.messages.push({ id, content, role: opts?.role ?? 'user' });
        return { id };
      },
      async editMessage(id: string, content: string) {
        const i = state.messages.findIndex((m) => m.id === id);
        if (i >= 0) state.messages[i] = { ...state.messages[i]!, content };
      },
      async deleteMessage(id: string) {
        const i = state.messages.findIndex((m) => m.id === id);
        if (i >= 0) state.messages.splice(i, 1);
      },
      async getMetadata(key: string) { return state.chatMetadata[key]; },
      async setMetadata(key: string, value: unknown) { state.chatMetadata[key] = value; },
      async inject(id: string, content: string, opts?: unknown) {
        state.injections.push({ id, content, opts });
      },
    },
    characters: {
      async get(id: string) { return { id, description: state.characterDescs[id] ?? '' }; },
      async update(id: string, patch) {
        if (typeof patch.description === 'string') state.characterDescs[id] = patch.description;
      },
      async setExpression(name: string) { state.emotions.push(name); },
    },
    broadcast: {
      emit() { /* noop */ },
      on() { return () => {}; },
    },
    llm: { async generate() { return { content: '' }; } },
  };
}

function mkTrigger(over: Partial<TriggerScript> = {}): TriggerScript {
  return {
    comment: 'test',
    type: 'input',
    conditions: [],
    effect: [],
    ...over,
  } as TriggerScript;
}

function makePayload(triggers: readonly TriggerScript[]): RisuPayload {
  return {
    triggers,
    lua_scripts: triggers.map(() => ''),
    at_actions: [],
    background_html: null,
    virtualscript: null,
    utility_bot: false,
    scriptstate_defaults: {},
    additional_assets: [],
    emotion_images: [],
    extra: {},
    translator_version: 'test',
    risu_spec_version: 'risu-1',
    requires: { lowLevelAccess: false, hostFeatures: [], lua: false },
  };
}

async function dispatch(
  payload: RisuPayload,
  api: HostApi,
  binding: 'input' | 'output' | 'request' | 'start' | 'display',
  data: DispatchData = {},
): Promise<void> {
  const compiled = prepareTriggers(payload, 'C1');
  const scriptNS = makeDispatcherScriptNS();
  registerManualTriggers(scriptNS, compiled, api);
  await dispatchBinding({
    compiledTriggers: compiled,
    api, data, scriptNS,
    opts: { characterId: 'C1', binding },
  }, binding);
}

// ─── V1 setvar parity ────────────────────────────────────────────────────────

describe('interpreter — V1 setvar', () => {
  test("'=' writes to chat.metadata.chat_variables (Lumi-native rehydrated scope)", async () => {
    const t = mkTrigger({
      effect: [{ type: 'setvar', var: 'greeted', operator: '=', value: 'yes' }] as never,
    });
    const state = makeMockState();
    await dispatch(makePayload([t]), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars).toBeDefined();
    expect(vars['greeted']).toBe('yes');
  });

  test("'+=' accumulates numerically", async () => {
    const state = makeMockState({ chatMetadata: { chat_variables: { 'count': '3' } } });
    const t = mkTrigger({
      effect: [{ type: 'setvar', var: 'count', operator: '+=', value: '4' }] as never,
    });
    await dispatch(makePayload([t]), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars['count']).toBe('7');
  });

  test('impersonate as user appends a user message', async () => {
    const state = makeMockState();
    const t = mkTrigger({
      type: 'output',
      effect: [{ type: 'impersonate', role: 'user', value: 'hello!' }] as never,
    });
    await dispatch(makePayload([t]), makeMockApi(state), 'output');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.role).toBe('user');
    expect(state.messages[0]!.content).toBe('hello!');
  });
});

// ─── V2 control flow ────────────────────────────────────────────────────────

describe('interpreter — V2 control flow', () => {
  test('v2If taken branch runs; untaken does not', async () => {
    const state = makeMockState({ chatMetadata: { chat_variables: { 'mood': 'happy' } } });
    const t = mkTrigger({
      effect: [
        { type: 'v2If', indent: 0, source: 'mood', condition: '=', target: 'happy', targetType: 'value' },
        { type: 'v2SetVar', indent: 1, var: 'triggered', value: '1', valueType: 'value' },
        { type: 'v2EndIndent', indent: 0 },
      ] as never,
    });
    await dispatch(makePayload([t]), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars['triggered']).toBe('1');
  });

  test('v2If false branch skipped', async () => {
    const state = makeMockState({ chatMetadata: { chat_variables: { 'mood': 'sad' } } });
    const t = mkTrigger({
      effect: [
        { type: 'v2If', indent: 0, source: 'mood', condition: '=', target: 'happy', targetType: 'value' },
        { type: 'v2SetVar', indent: 1, var: 'triggered', value: '1', valueType: 'value' },
        { type: 'v2EndIndent', indent: 0 },
      ] as never,
    });
    await dispatch(makePayload([t]), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars?.['triggered']).toBeUndefined();
  });
});

// ─── Regression: multiple triggers + flush ───────────────────────────────────

describe('interpreter — multi-trigger flush', () => {
  test('two triggers on the same binding both fire + state aggregates', async () => {
    const state = makeMockState();
    const triggers: TriggerScript[] = [
      mkTrigger({ effect: [{ type: 'setvar', var: 'a', operator: '=', value: '1' }] as never }),
      mkTrigger({ effect: [{ type: 'setvar', var: 'b', operator: '=', value: '2' }] as never }),
    ];
    await dispatch(makePayload(triggers), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars['a']).toBe('1');
    expect(vars['b']).toBe('2');
  });
});

// ─── Payload binding-to-dispatch consistency ────────────────────────────────

describe('interpreter — dispatchBinding filters by binding', () => {
  test('MESSAGE_SENT dispatch only fires input triggers, not output', async () => {
    const state = makeMockState();
    const triggers: TriggerScript[] = [
      mkTrigger({
        type: 'input',
        effect: [{ type: 'setvar', var: 'input_ran', operator: '=', value: '1' }] as never,
      }),
      mkTrigger({
        type: 'output',
        effect: [{ type: 'setvar', var: 'output_ran', operator: '=', value: '1' }] as never,
      }),
    ];
    await dispatch(makePayload(triggers), makeMockApi(state), 'input');
    const vars = ((state.chatMetadata['chat_variables'] ?? {}) as Record<string, string>);
    expect(vars['input_ran']).toBe('1');
    expect(vars?.['output_ran']).toBeUndefined();
  });
});

describe('interpreter — manual invocation mode', () => {
  test('display-declared comment trigger persists when invoked manually', async () => {
    const trigger = mkTrigger({
      comment: 'wiki',
      type: 'display',
      effect: [
        {
          type: 'v2SetVar',
          operator: '=',
          var: 'bahasa',
          value: '6',
          valueType: 'value',
          indent: 0,
        },
      ] as never,
    });
    const state = makeMockState({
      chatMetadata: { chat_variables: { bahasa: '1' } },
    });
    const api = makeMockApi(state);
    const compiled = prepareTriggers(makePayload([trigger]), 'C1');
    const scriptNS = makeDispatcherScriptNS();

    const fired = await dispatchByManualName(
      {
        compiledTriggers: compiled,
        api,
        data: { characterId: 'C1' },
        scriptNS,
        opts: { characterId: 'C1', binding: 'manual' },
      },
      'wiki',
    );

    expect(fired).toBe(1);
    const vars = state.chatMetadata['chat_variables'] as Record<string, string>;
    expect(vars['bahasa']).toBe('6');
  });
});
