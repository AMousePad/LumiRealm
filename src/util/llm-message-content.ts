import type { LlmMessageDTO, LlmMessagePartDTO } from 'lumiverse-spindle-types';

export function projectLlmText(content: LlmMessageDTO['content']): string {
  if (typeof content === 'string') return content;
  return content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
}

export function mergeLlmText(
  content: LlmMessageDTO['content'],
  text: string,
): LlmMessageDTO['content'] {
  if (typeof content === 'string') return text;
  if (projectLlmText(content) === text) return content;

  const parts: LlmMessagePartDTO[] = [];
  let foundText = false;
  for (const part of content) {
    if (part.type !== 'text') {
      parts.push(part);
    } else if (!foundText) {
      if (text.length > 0) parts.push({ ...part, text });
      foundText = true;
    }
  }
  if (!foundText && text.length > 0) parts.unshift({ type: 'text', text });
  return parts;
}
