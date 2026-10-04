import type { LlmMessageDTO } from 'lumiverse-spindle-types';
import { isFromEnd, type RisuChatRange } from '../core/preset/risup-translator.js';

const isChatRange = (range: unknown): range is RisuChatRange => {
  const { start, end } = (range ?? {}) as Partial<RisuChatRange>;
  return (start === null || isFromEnd(start)) && (end === 0 || isFromEnd(end));
};

// Keeps the chat-history turns inside any chat slice of the imported Risu preset, indexing the history
// the way Risu's sendChat 'chat' case indexes its chat list. Hosts without preset metadata send undefined.
export function applyRisuChatRanges(messages: LlmMessageDTO[], presetMetadata: unknown): LlmMessageDTO[] {
  const ranges = (presetMetadata as { chatRanges?: unknown } | null | undefined)?.chatRanges;
  if (ranges === undefined) return messages;
  if (!Array.isArray(ranges) || !ranges.every(isChatRange)) {
    throw new TypeError(`Invalid LumiRealm preset chatRanges: ${JSON.stringify(ranges)}`);
  }
  const total = messages.filter((message) => message.__isChatHistory).length;
  let index = -1;
  return messages.filter((message) => {
    if (!message.__isChatHistory) return true;
    index++;
    return ranges.some((range) => (range.start === null || index >= total + range.start) && index < total + range.end);
  });
}
