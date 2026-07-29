import type { TriggerScript } from '../core/schemas/triggerscript.js';
import type { LlmMessage } from '../adapters/spindle-extras.js';
import { makeDispatcherScriptNS } from './dispatcher.js';
import type { HostApi } from './host.js';
import { selectRestrictedTriggers } from './restricted-trigger.js';
import { makeRisuTriggerRuntime } from './runtime.js';
import {
  interpretTrigger,
  type InterpConsole,
} from './trigger-interpreter.js';

const quietConsole: InterpConsole = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
};

export interface RequestTriggerChainOptions {
  readonly api: HostApi;
  readonly chatId: string;
  readonly characterId: string;
  readonly characterName?: string;
  readonly userName?: string;
  readonly triggers: readonly TriggerScript[];
}

export async function runRequestTriggerChain(
  messages: readonly LlmMessage[],
  opts: RequestTriggerChainOptions,
): Promise<LlmMessage[]> {
  const triggers = selectRestrictedTriggers(opts.triggers, 'request');
  if (triggers.length === 0) return messages.slice();

  const runtime = await makeRisuTriggerRuntime(
    opts.api,
    {
      characterId: opts.characterId,
      characterName: opts.characterName ?? '',
      userName: opts.userName ?? '',
    },
    makeDispatcherScriptNS(),
    {
      chatId: opts.chatId,
      characterId: opts.characterId,
      binding: 'request',
      displayMode: true,
      requestData: messages.map(({ role, content }) => ({ role, content })),
    },
  );

  try {
    for (const trigger of triggers) {
      await interpretTrigger(trigger, runtime, quietConsole, {
        displayMode: true,
        lowLevelAccess: Boolean(trigger.lowLevelAccess),
      });
    }

    const state = runtime.getRequestStateMessages();
    if (state.length !== messages.length) {
      throw new Error(
        `request trigger changed message count: ${messages.length} -> ${state.length}`,
      );
    }
    return messages.map((message, index) => ({
      ...message,
      role: state[index]!.role as LlmMessage['role'],
      content: state[index]!.content,
    }));
  } finally {
    await runtime.flush();
  }
}
