import type { TriggerScript } from '../core/schemas/triggerscript.js';
import type { LlmMessage } from '../adapters/spindle-extras.js';
import { mergeLlmText, projectLlmText } from '../util/llm-message-content.js';
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
  readonly templateContext?: import('./runtime/template.js').TriggerTemplateContext;
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
      ...(opts.templateContext ? { templateContext: opts.templateContext } : {}),
      requestData: messages.map(({ role, content }) => ({
        role,
        content: projectLlmText(content),
      })),
    },
  );

  try {
    for (const trigger of triggers) {
      const result = await interpretTrigger(trigger, runtime, quietConsole, {
        displayMode: true,
        lowLevelAccess: Boolean(trigger.lowLevelAccess),
      });
      if (result === 'abort') return messages.slice();
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
      content: mergeLlmText(message.content, state[index]!.content),
    }));
  } finally {
    await runtime.flush();
  }
}
