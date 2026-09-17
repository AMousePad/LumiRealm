import type { HostApi, TriggerRuntimeOpts } from '../../src/interpreter/host.js';
import type { TriggerEffect, TriggerScript } from '../../src/core/schemas/triggerscript.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { interpretTrigger } from '../../src/interpreter/trigger-interpreter.js';
import { compileTrigger } from '../../src/core/triggers/compile.js';

export async function runTriggerEffects(
  effects: readonly TriggerEffect[],
  initial: Record<string, string | null> = {},
  opts: TriggerRuntimeOpts = {},
  conditions: TriggerScript['conditions'] = [],
  execution: 'interpreted' | 'compiled' = 'interpreted',
) {
  const metadata: Record<string, unknown> = { chat_variables: { ...initial } };
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected host mutation'); };
  const api: HostApi = {
    chat: {
      getChatId: () => 'test-chat',
      getMessages: async () => [],
      getMetadata: async (key: string) => metadata[key],
      setMetadata: async (key: string, value: unknown) => { metadata[key] = value; },
      sendMessage: unexpected,
      editMessage: unexpected,
      deleteMessage: unexpected,
      inject: unexpected,
    },
    characters: { get: async () => ({ id: 'test-character' }), update: unexpected },
  };
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(), {
    templateContext: basicTriggerContext,
    ...opts,
  });
  const trigger: TriggerScript = { type: 'manual', comment: '', conditions, effect: [...effects] };
  const gates = {
    displayMode: opts.displayMode ?? false, lowLevelAccess: opts.lowLevelAccess ?? false, stepBudget: 1000,
  };
  if (execution === 'compiled') {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('__risu', 'console', '"use strict";\n' + compileTrigger(trigger, gates).body)(runtime, console);
  } else {
    await interpretTrigger(trigger, runtime, console, gates);
  }
  await runtime.flush();
  return { runtime, saved: metadata.chat_variables as Record<string, string | null> };
}

export async function basicTriggerContext() {
  return {
    chatId: 'test-chat', userName: 'User', charName: 'Character',
    character: {}, chat: {}, variables: {}, commit: false,
  };
}
