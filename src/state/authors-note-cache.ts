declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// Chat author's note for the prompt-engine `{{authornote}}` slot. The note lives
// in chat metadata, so every slot is a host round trip; prompts can hold several.
// Same discipline as the toggle preference cache: a short window bounds what
// LumiRealm cannot observe (a host-UI edit raises no extension event), and
// LumiRealm's own author's-note writer drops the entry immediately.

const AUTHORS_NOTE_CACHE_TTL_MS = 2000;
const notesByChat = new Map<string, { at: number; value: string }>();

/** Drop the memoized author's note for one chat, or for every chat. */
export function invalidateAuthorsNoteCache(chatId?: string): void {
  if (chatId === undefined) notesByChat.clear();
  else notesByChat.delete(chatId);
}

/**
 * Reads `metadata.authors_note.content`, the surface the host's own author's-note
 * injection and LumiRealm's chat readers use. A chat without a note, or a chat
 * the host cannot resolve, reads as the empty string. Failures propagate so the
 * caller can log them, and a failed read is never memoized.
 */
export async function readChatAuthorsNote(chatId: string, userId: string): Promise<string> {
  const hit = notesByChat.get(chatId);
  if (hit && Date.now() - hit.at < AUTHORS_NOTE_CACHE_TTL_MS) return hit.value;
  const chat = (await spindle.chats.get(chatId, userId || undefined)) as {
    metadata?: Record<string, unknown>;
  } | null;
  const note = chat?.metadata?.['authors_note'];
  const raw = note && typeof note === 'object' ? (note as { content?: unknown }).content : '';
  const value = typeof raw === 'string' ? raw : '';
  notesByChat.set(chatId, { at: Date.now(), value });
  return value;
}
