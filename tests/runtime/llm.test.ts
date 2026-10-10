import { describe, expect, test } from 'bun:test';
import { runLLM, parseLuaPromptArg, type SubmodelRouting } from '../../src/interpreter/runtime/llm.js';
import type { HostApi } from '../../src/interpreter/host.js';

const NO_ROUTING: SubmodelRouting = {
  submodelConnectionId: null,
  submodelModelOverride: null,
  submodelParamsWire: null,
};

function makeApi(generateFn?: (req: unknown) => Promise<{ content: string }>): HostApi {
  return {
    chat: {} as HostApi['chat'],
    characters: {} as HostApi['characters'],
    llm: generateFn ? { generate: generateFn as never } : undefined,
  } as unknown as HostApi;
}

describe('runLLM', () => {
  test('no api.llm → returns "Error: api.llm not available"', async () => {
    const out = await runLLM(makeApi(), NO_ROUTING, 'hi', 'model');
    expect(out).toBe('Error: api.llm not available');
  });

  test('passes single user-role message in default channel', async () => {
    let captured: unknown;
    const api = makeApi(async (req) => { captured = req; return { content: 'reply' }; });
    const out = await runLLM(api, NO_ROUTING, 'hello', 'model');
    expect(out).toBe('reply');
    expect((captured as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'hello' }]);
    // Default channel: no submodel routing applied
    expect((captured as Record<string, unknown>).connectionId).toBeUndefined();
    expect((captured as Record<string, unknown>).model).toBeUndefined();
  });

  test('submodel channel with routing applies connectionId/model/parameters', async () => {
    let captured: unknown;
    const api = makeApi(async (req) => { captured = req; return { content: 'sub-reply' }; });
    const routing: SubmodelRouting = {
      submodelConnectionId: 'conn-x',
      submodelModelOverride: 'gpt-9',
      submodelParamsWire: { temperature: 0.5 },
    };
    const out = await runLLM(api, routing, 'q', 'submodel');
    expect(out).toBe('sub-reply');
    expect(captured).toEqual({
      messages: [{ role: 'user', content: 'q' }],
      connectionId: 'conn-x',
      model: 'gpt-9',
      parameters: { temperature: 0.5 },
    });
  });

  test('submodel channel with empty routing → no overrides spread (preserves preset semantics)', async () => {
    let captured: unknown;
    const api = makeApi(async (req) => { captured = req; return { content: '' }; });
    await runLLM(api, NO_ROUTING, 'q', 'submodel');
    expect(captured).toEqual({ messages: [{ role: 'user', content: 'q' }] });
  });

  test('non-submodel keyword → primary channel (no routing applied)', async () => {
    let captured: unknown;
    const api = makeApi(async (req) => { captured = req; return { content: '' }; });
    const routing: SubmodelRouting = {
      submodelConnectionId: 'conn-x',
      submodelModelOverride: 'gpt-9',
      submodelParamsWire: { temperature: 0.5 },
    };
    await runLLM(api, routing, 'q', 'model');
    expect(captured).toEqual({ messages: [{ role: 'user', content: 'q' }] });
  });

  test('thrown error → "Error: <message>"', async () => {
    const api = makeApi(async () => { throw new Error('upstream-fail'); });
    const out = await runLLM(api, NO_ROUTING, 'hi', 'model');
    expect(out).toBe('Error: upstream-fail');
  });

  test('non-Error throw stringified', async () => {
    const api = makeApi(async () => { throw 'plain-string-err'; });
    const out = await runLLM(api, NO_ROUTING, 'hi', 'model');
    expect(out).toBe('Error: plain-string-err');
  });
});

describe('parseLuaPromptArg', () => {
  test('JSON-encoded string → single user message', () => {
    const r = parseLuaPromptArg(JSON.stringify('hello'));
    expect(r).toEqual([{ role: 'user', content: 'hello' }]);
  });

  test('JSON-encoded array → role-coerced messages', () => {
    const r = parseLuaPromptArg(JSON.stringify([
      { role: 'system', content: 'sys' },
      { role: 'user',   content: 'q' },
      { role: 'assistant', content: 'a' },
    ]));
    expect(r).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user',   content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  test('array entries with missing role default to user', () => {
    const r = parseLuaPromptArg(JSON.stringify([
      { content: 'no-role' },
      { role: 'user', content: 'has-role' },
    ]));
    expect(r[0]?.role).toBe('user');
    expect(r[1]?.role).toBe('user');
  });

  test('array entries with missing content default to empty string', () => {
    const r = parseLuaPromptArg(JSON.stringify([
      { role: 'user' },
    ]));
    expect(r[0]?.content).toBe('');
  });

  test('non-string non-array (object) → JSON-stringified single user message', () => {
    const r = parseLuaPromptArg(JSON.stringify({ random: 'shape' }));
    expect(r).toEqual([{ role: 'user', content: '{"random":"shape"}' }]);
  });

  test('invalid JSON → wraps the original string as a user message', () => {
    const r = parseLuaPromptArg('not-json{');
    expect(r).toEqual([{ role: 'user', content: 'not-json{' }]);
  });

  test('coerces non-string input via toStr', () => {
    // Number 42 → toStr → '42' → JSON.parse('42') = number 42 (parsed)
    // → not string, not array → JSON.stringify(42) = '42'
    const r = parseLuaPromptArg(42);
    expect(r).toEqual([{ role: 'user', content: '42' }]);
  });
});
