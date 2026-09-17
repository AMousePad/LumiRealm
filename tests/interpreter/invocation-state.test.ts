import { expect, test } from 'bun:test';
import type { TriggerScript, TriggerEffect } from '../../src/core/schemas/triggerscript.js';
import type { HostApi, HostMessage, InjectOpts } from '../../src/interpreter/host.js';
import { dispatchByManualName, dispatchBinding, prepareTriggers, registerManualTriggers, makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { makeRisuTriggerRuntime, withDispatchContext } from '../../src/interpreter/runtime.js';
import { initializeInvocation, type TriggerInvocationState } from '../../src/interpreter/runtime/invocation.js';
import { basicTriggerContext } from '../helpers/trigger-runtime.js';

const set = (name: string, value: string, valueType = 'value'): TriggerEffect => ({ type: 'v2SetVar', var: name, value, valueType, operator: '=', indent: 0 });
const call: TriggerEffect = { type: 'v2RunTrigger', target: 'child', indent: 0 };
const abort: TriggerEffect = { type: 'v2MakeArrayVar', var: '[]', indent: 0 };
const stop: TriggerEffect = { type: 'v2StopTrigger', indent: 0 };
const modify: TriggerEffect = { type: 'v2ModifyChat', index: '0', indexType: 'value', value: 'changed', valueType: 'value', indent: 0 };
const read: TriggerEffect = { type: 'v2GetLastMessage', outputVar: 'message', indent: 0 };
const trigger = (comment: string, effect: TriggerEffect[], type: TriggerScript['type'] = 'manual'): TriggerScript => ({ type, comment, effect, conditions: [] });

async function run(sources: TriggerScript[], initial: Record<string, string> = {}, binding: 'manual' | 'output' | 'start' = 'manual', onError: ((error: unknown) => void) | null = error => { throw error; }) {
  const metadata: Record<string, unknown> = { chat_variables: { ...initial } };
  const messages: HostMessage[] = [{ id: 'message', role: 'user', content: 'original' }];
  const mutations: string[] = [];
  const injections: { content: string; opts?: InjectOpts }[] = [];
  const api: HostApi = {
    chat: {
      getMessages: async () => structuredClone(messages),
      getMetadata: async key => structuredClone(metadata[key]),
      setMetadata: async (key, value) => { metadata[key] = structuredClone(value); },
      editMessage: async (id, content) => {
        mutations.push('edit');
        const index = messages.findIndex(message => message.id === id);
        messages[index] = { ...messages[index]!, content };
      },
      deleteMessage: async id => { mutations.push('delete'); messages.splice(messages.findIndex(message => message.id === id), 1); },
      sendMessage: async (content, options) => {
        mutations.push('send');
        const id = 'added-' + mutations.length;
        messages.push({ id, content, role: options?.role ?? 'assistant' });
        return { id };
      },
      inject: async (_id, content, opts) => { injections.push({ content, ...(opts ? { opts } : {}) }); },
    },
    characters: { get: async () => ({ id: 'character' }), update: async () => {} },
  };
  const compiledTriggers = prepareTriggers({ triggers: sources } as never, 'character');
  const scriptNS = makeDispatcherScriptNS();
  registerManualTriggers(scriptNS, compiledTriggers, api);
  const context = { api, compiledTriggers, scriptNS, data: {}, opts: {} };
  const flags = { stopSending: false, varsFlushed: false };
  await withDispatchContext({ templateContext: basicTriggerContext }, async () => {
    if (binding === 'manual') await dispatchByManualName(context, 'outer', onError ?? undefined, flags);
    else Object.assign(flags, await dispatchBinding(context, binding, onError ?? undefined));
  });
  return { saved: metadata.chat_variables, messages, mutations, injections, flags };
}

test('successful children propagate stop sending and updated messages to their parent', async () => {
  const result = await run([
    trigger('outer', [call, read]),
    trigger('child', [modify, { type: 'v2StopPromptSending', indent: 0 }]),
  ]);
  expect(result.saved).toEqual({ message: 'changed' });
  expect(result.flags.stopSending).toBe(true);
  expect(result.messages[0]?.content).toBe('changed');
});

test('aborted children retain their saved writes but return no message or stop changes', async () => {
  const result = await run([
    trigger('outer', [call, read, set('observed', 'value', 'var')]),
    trigger('child', [set('value', 'child'), modify, { type: 'v2StopPromptSending', indent: 0 }, abort]),
  ], { value: 'parent' });
  expect(result.saved).toEqual({ value: 'parent', message: 'original', observed: 'parent' });
  expect(result.flags.stopSending).toBe(false);
  expect(result.mutations).toEqual([]);
});

test('a parent can observe an aborted child through CBS before caller adoption restores its own chat', async () => {
  const result = await run([
    trigger('outer', [call, set('observed', '{{getvar::value}}')]),
    trigger('child', [set('value', 'child'), abort]),
  ], { value: 'parent' });
  expect(result.saved).toEqual({ value: 'parent', observed: 'child' });
});

test('successful caller adoption restores parent variables even without a later write', async () => {
  const result = await run([trigger('outer', [call]), trigger('child', [set('value', 'child'), abort])], { value: 'parent' });
  expect(result.saved).toEqual({ value: 'parent' });
});

test('an aborted outer invocation preserves earlier saved writes while discarding staged messages', async () => {
  const result = await run([
    trigger('outer', [call, abort]), trigger('child', [set('value', 'child'), modify, abort]),
  ], { value: 'parent' });
  expect(result.saved).toEqual({ value: 'child' });
  expect(result.mutations).toEqual([]);
});

test('Lua message mutations inside an aborted invocation are also discarded', async () => {
  const result = await run([trigger('outer', [
    set('saved', 'yes'),
    { type: 'triggerlua', code: 'function onButtonClick(id) setChat(id, 0, "lua") end' },
    abort,
  ])]);
  expect(result.saved).toEqual({ saved: 'yes' });
  expect(result.messages[0]?.content).toBe('original');
  expect(result.mutations).toEqual([]);
});

test('staged additions and later edits commit once with host-assigned IDs', async () => {
  const result = await run([
    trigger('outer', [call, { ...modify, index: '1', value: 'edited' }, read]),
    trigger('child', [{ type: 'impersonate', role: 'char', value: 'new' }]),
  ]);
  expect(result.saved).toEqual({ message: 'edited' });
  expect(result.messages).toEqual([
    { id: 'message', role: 'user', content: 'original' },
    { id: 'added-1', role: 'assistant', content: 'edited' },
  ]);
  expect(result.mutations).toEqual(['send']);
});

test('an outer abort discards its stop-sending result', async () => {
  const result = await run([trigger('outer', [{ type: 'v2StopPromptSending', indent: 0 }, abort])]);
  expect(result.flags.stopSending).toBe(false);
});

test('child cuts preserve a newly leading assistant as a real message', async () => {
  const result = await run([
    trigger('outer', [call, read]),
    trigger('child', [
      { type: 'impersonate', role: 'char', value: 'retained' },
      { type: 'v2CutChat', start: '1', startType: 'value', end: '2', endType: 'value', indent: 0 },
    ]),
  ]);
  expect(result.saved).toEqual({ message: 'retained' });
  expect(result.messages).toEqual([{ id: 'added-2', role: 'assistant', content: 'retained' }]);
  expect(result.mutations).toEqual(['delete', 'send']);
});

for (const binding of ['manual', 'output'] as const) {
  test(`${binding} invocation abort skips siblings while stop-trigger permits them`, async () => {
    const aborted = await run([trigger('outer', [modify, abort], binding), trigger('outer', [set('after', 'yes')], binding)], {}, binding);
    expect(aborted.saved).toEqual({});
    expect(aborted.mutations).toEqual([]);
    const stopped = await run([trigger('outer', [modify, stop, set('skipped', 'no')], binding), trigger('outer', [read], binding)], {}, binding);
    expect(stopped.saved).toEqual({ message: 'changed' });
    expect(stopped.messages[0]?.content).toBe('changed');
  });
}

const prompt = (value: string, location = 'start'): TriggerEffect => ({ type: 'v2SystemPrompt', value, valueType: 'value', location, indent: 0 });
const invalidRegex: TriggerEffect = { type: 'v2ExtractRegex', value: 'text', valueType: 'value', regex: '[', regexType: 'value', flags: '', flagsType: 'value', result: '$&', resultType: 'value', outputVar: 'result', indent: 0 };

test('start prompts accumulate across siblings and children in effect order', async () => {
  const result = await run([
    trigger('outer', [prompt('before'), call, prompt('after'), prompt('tail', 'promptend')], 'start'),
    trigger('outer', [prompt('sibling'), prompt('', 'historyend')], 'start'),
    trigger('child', [{ type: 'systemprompt', value: 'child', location: 'start' }]),
  ], {}, 'start');
  expect(result.injections).toEqual([
    { content: 'before\n\nchild\n\nafter\n\nsibling\n\n', opts: { mode: 'context', position: 'start', role: 'system' } },
    { content: '\n\n', opts: { mode: 'context', position: 'historyend', role: 'system' } },
    { content: 'tail\n\n', opts: { mode: 'context', position: 'promptend', role: 'system' } },
  ]);
});

test('aborted children retain prompt additions in their shared accumulator', async () => {
  const result = await run([
    trigger('outer', [prompt('before'), call, prompt('after')], 'start'),
    trigger('child', [prompt('child'), abort]),
  ], {}, 'start');
  expect(result.injections.map(injection => injection.content)).toEqual(['before\n\nchild\n\nafter\n\n']);
});

for (const end of [abort, { type: 'v2StopPromptSending', indent: 0 }] as TriggerEffect[]) {
  test(`a start invocation ending with ${end.type} does not inject prompts`, async () => {
    const result = await run([trigger('outer', [prompt('discarded'), end], 'start')], {}, 'start');
    expect(result.injections).toEqual([]);
  });
}

for (const binding of ['manual', 'output'] as const) {
  test(`${binding} caller does not consume system prompts`, async () => {
    const result = await run([trigger('outer', [prompt('unused'), call], binding), trigger('child', [prompt('child')])], {}, binding);
    expect(result.injections).toEqual([]);
  });
}

for (const binding of ['manual', 'output', 'start'] as const) {
  for (const nested of [false, true]) {
    test(`${binding} reported ${nested ? 'child' : 'direct'} error aborts without adopting chat or running siblings`, async () => {
      const errors: unknown[] = [];
      const effects: TriggerEffect[] = [set('saved', 'child'), prompt('discarded'), modify, { type: 'v2StopPromptSending', indent: 0 }, invalidRegex];
      const result = await run([
        trigger('outer', nested ? [call, set('afterParent', 'no')] : effects, binding),
        trigger('outer', [set('afterSibling', 'no')], binding),
        ...(nested ? [trigger('child', effects)] : []),
      ], {}, binding, error => { errors.push(error); });
      expect(errors).toHaveLength(1);
      expect(result.saved).toEqual({ saved: 'child' });
      expect(result.messages[0]?.content).toBe('original');
      expect(result.mutations).toEqual([]);
      expect(result.flags.stopSending).toBe(false);
      expect(result.injections).toEqual([]);
    });
  }
}

test('manual errors propagate when no error reporter is supplied', async () => {
  await expect(run([trigger('outer', [invalidRegex])], {}, 'manual', null)).rejects.toThrow();
});


test('standalone invocation initialization does not copy the message baseline', () => {
  let copiedRows = 0;
  const message = new Proxy({ id: 'message', role: 'user', content: 'original' }, {
    ownKeys: target => { copiedRows++; return Reflect.ownKeys(target); },
  });
  const state: TriggerInvocationState = { stopSending: false, varsCache: {}, messagesCache: [message] };
  initializeInvocation(state, { chat: {} } as HostApi);
  expect(copiedRows).toBe(0);
});

test('standalone real writes before and between child calls keep the host baseline current', async () => {
  const messages: HostMessage[] = [{ id: 'message', role: 'user', content: 'original' }];
  const edits: string[] = [];
  const api: HostApi = {
    chat: {
      getMessages: async () => structuredClone(messages),
      getMetadata: async () => ({}),
      setMetadata: async () => {},
      editMessage: async (_id, content) => {
        edits.push(content);
        messages[0] = { ...messages[0]!, content };
      },
      deleteMessage: async () => { throw new Error('Unexpected deletion'); },
      sendMessage: async () => { throw new Error('Unexpected send'); },
      inject: async () => { throw new Error('Unexpected injection'); },
    },
    characters: { get: async () => ({ id: 'character' }), update: async () => {} },
  };
  const scriptNS = makeDispatcherScriptNS();
  registerManualTriggers(scriptNS, prepareTriggers({ triggers: [trigger('child', [modify])] } as never, 'character'), api);
  const runtime = await makeRisuTriggerRuntime(api, {}, scriptNS);
  await runtime.modifyChat(0, 'first');
  await runtime.runTrigger('child');
  await runtime.modifyChat(0, 'second');
  await runtime.runTrigger('child');
  await runtime.flush();
  expect(edits).toEqual(['first', 'changed', 'second', 'changed']);
  expect(messages[0]?.content).toBe('changed');
});
