// Adapts Lumi's getMessages() to the chat shape Risu cards expect at trigger time.

import type { HostMessage } from './host.js';

export interface RisuChatView {
  readonly messages: HostMessage[];
  readonly adjustments: readonly string[];
  // Content of the stripped leading greeting, Risu's `char.firstMessage`
  // fallback for getCharacterLastMessage / getFirstMessage.
  readonly greeting?: string;
  readonly greetingIndex?: number;
}

export interface BuildRisuChatViewInput {
  readonly messages: readonly HostMessage[];
}

export function buildRisuChatView(input: BuildRisuChatViewInput): RisuChatView {
  const messages: HostMessage[] = input.messages.map((m) => ({ ...m }));
  const adjustments: string[] = [];

  // Lumi commit 2b1ae51 stages an empty assistant before GENERATION_STARTED.
  // Strip trailing empty assistants so chatLen-1 targets the user message, not the placeholder.
  let stripped = 0;
  while (messages.length > 0) {
    const last = messages[messages.length - 1]!;
    if (last.role === 'assistant' && (!last.content || last.content === '')) {
      messages.pop();
      stripped++;
    } else {
      break;
    }
  }
  if (stripped > 0) adjustments.push(`stripped:${stripped}-trailing-empty-assistant`);

  // Risu's `chat.message[]` excludes the greeting, so the Lua chat API must
  // too: a greeting-included getChatLength is off-by-one vs Risu while
  // meta.index stays Risu-frame, shifting card `meta.index - getChatLength()`
  // position math by one. Same leading-non-user drop the backend cache uses.
  let greeting: string | undefined;
  let greetingIndex: number | undefined;
  if (messages.length > 0 && messages[0]!.role !== 'user') {
    greeting = messages[0]!.content;
    greetingIndex = messages[0]!.greetingIndex;
    messages.shift();
    adjustments.push('stripped:1-leading-greeting');
  }

  return greeting !== undefined
    ? {
        messages,
        adjustments,
        greeting,
        ...(greetingIndex !== undefined ? { greetingIndex } : {}),
      }
    : { messages, adjustments };
}
