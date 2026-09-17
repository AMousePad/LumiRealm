import type { HostApi, TriggerRuntimeOpts } from '../../src/interpreter/host.js';
import type { TriggerEffect, TriggerScript } from '../../src/core/schemas/triggerscript.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import { interpretTrigger } from '../../src/interpreter/trigger-interpreter.js';

export async function runTriggerEffects(
  effects: readonly TriggerEffect[],
  initial: Record<string, string> = {},
  opts: TriggerRuntimeOpts = {},
  conditions: TriggerScript['conditions'] = [],
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
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(), opts);
  await interpretTrigger({ type: 'manual', comment: '', conditions, effect: [...effects] }, runtime, console, {
    displayMode: opts.displayMode ?? false, lowLevelAccess: false, stepBudget: 1000,
  });
  await runtime.flush();
  return { runtime, saved: metadata.chat_variables as Record<string, string> };
}
