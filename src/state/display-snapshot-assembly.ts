declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import type { CompiledTriggerEntry } from '../interpreter/dispatcher.js';
import type { DisplaySnapshot, DisplayLuaTrigger } from '../display/snapshot.js';
import type { HostMessage, HostWorldInfoEntry } from '../interpreter/host.js';
import type { Message } from '../core/cbs/index.js';
import { coerceAtActions } from '../interpreter/at-actions-runtime.js';
import { getActiveLorebook } from './lorebook-cache.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { getActiveCharacterImage, getActivePersonaImage } from '../interpreter/image-cache.js';
import { buildRisuChatView } from '../interpreter/risu-chat-view.js';
import type { RisuChatView } from '../interpreter/risu-chat-view.js';
import { toRisuFirstMessageIndex } from '../interpreter/greeting-index.js';
import type { TriggerScript } from '../core/schemas/triggerscript.js';

export interface DisplaySnapshotAssemblyDeps {
  readonly modulesByNamespaceFromCard: (
    card: StoredRisuCard,
  ) => Readonly<Record<string, readonly string[]>> | null;
  readonly legacyMediaFindings: (userId: string | undefined) => boolean;
  readonly getCompiledLibraries: (active: ActiveCard) => readonly CompiledTriggerEntry[];
}

interface LumiCharacterRaw {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  first_mes?: string;
  alternate_greetings?: readonly string[];
  world_book_ids?: readonly string[];
  image_id?: string | null;
}

function dtoToHostEntry(r: Record<string, unknown>): HostWorldInfoEntry {
  const e: Record<string, unknown> = { ...r, id: typeof r.id === 'string' ? r.id : '' };
  if (typeof r.world_book_id === 'string') e.worldBookId = r.world_book_id;
  if (Array.isArray(r.key)) e.key = r.key as readonly string[];
  else if (typeof r.key === 'string') e.key = r.key;
  if (typeof r.content === 'string') e.content = r.content;
  if (typeof r.comment === 'string') e.comment = r.comment;
  if (typeof r.order_value === 'number') e.orderValue = r.order_value;
  if (typeof r.disabled === 'boolean') e.disabled = r.disabled;
  if (typeof r.constant === 'boolean') e.constant = r.constant;
  return e as HostWorldInfoEntry;
}

async function fetchHostMessages(chatId: string): Promise<HostMessage[]> {
  try {
    const msgs = await spindle.chat.getMessages(chatId);
    return msgs.map((m) => {
      const raw = m as unknown as {
        created_at?: unknown;
        send_date?: unknown;
        name?: unknown;
      };
      const sendDate = typeof raw.send_date === 'number' ? raw.send_date : null;
      const createdAt = typeof raw.created_at === 'number' ? raw.created_at : null;
      return {
        id: m.id,
        content: typeof m.content === 'string' ? m.content : '',
        role: m.role,
        createdAt: sendDate ?? createdAt ?? 0,
        ...(typeof raw.name === 'string' && raw.name.length > 0
          ? { speaker: raw.name }
          : {}),
        ...(typeof m.extra?.greeting_index === 'number'
          ? { greetingIndex: m.extra.greeting_index }
          : {}),
      };
    });
  } catch {
    return [];
  }
}

function buildDisplayChatStateFromView(view: RisuChatView): DisplaySnapshot['chat'] {
  const messages: Message[] = view.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    createdAt: m.createdAt ?? 0,
    ...(m.speaker ? { speaker: m.speaker } : {}),
  }));
  const risuLen = messages.length;
  let lastUser = '';
  let lastChar = '';
  for (let i = risuLen - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!lastUser && m.role === 'user') lastUser = m.content;
    if (!lastChar && m.role === 'assistant') lastChar = m.content;
    if (lastUser && lastChar) break;
  }
  return {
    // Evaluator context accepts Lumi's greeting-included frame and shifts it
    // once. Preserve that frame while sourcing every field from this one view.
    messageCount: risuLen + 1,
    lastMessage: risuLen > 0 ? messages[risuLen - 1]!.content : '',
    lastUserMessage: lastUser,
    lastCharMessage: lastChar,
    lastMessageId: risuLen,
    messages,
  };
}

export function buildDisplayChatState(
  messagesHost: readonly HostMessage[],
): DisplaySnapshot['chat'] {
  return buildDisplayChatStateFromView(buildRisuChatView({ messages: messagesHost }));
}

async function fetchHostLorebook(
  bookIds: readonly string[],
  userId: string,
): Promise<HostWorldInfoEntry[]> {
  const wb = (spindle as unknown as {
    world_books?: {
      entries: {
        list: (
          id: string,
          opts?: { limit?: number; userId?: string },
        ) => Promise<{ data: readonly Record<string, unknown>[] }>;
      };
    };
  }).world_books;
  if (!wb || bookIds.length === 0) return [];
  const lists = await Promise.allSettled(
    bookIds.map((bid) => wb.entries.list(bid, { limit: 1000, userId }).then((res) => ({ bid, res }))),
  );
  const out: HostWorldInfoEntry[] = [];
  for (const r of lists) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value.res?.data)) continue;
    for (const dto of r.value.res.data) {
      const e = dtoToHostEntry(dto);
      out.push({ ...e, worldBookId: (e.worldBookId as string | undefined) || r.value.bid });
    }
  }
  out.sort((a, b) => Number(b.orderValue || 0) - Number(a.orderValue || 0));
  return out;
}

interface LumiPersonaRaw {
  name?: string;
  description?: string;
  image_id?: string | null;
}

async function fetchChatRuntimeState(
  chatId: string,
  userId: string,
): Promise<{
  readonly authorsNote: import('../display/snapshot.js').DisplayChatAuthorsNote | null;
  readonly selectedAlternateGreetingIndex?: number;
}> {
  try {
    const chat = await spindle.chats.get(chatId, userId) as { metadata?: Record<string, unknown> } | null;
    const metadata = chat?.metadata;
    const an = metadata?.authors_note;
    const selectedAlternateGreetingIndex =
      typeof metadata?.activeGreetingIndex === 'number'
        ? toRisuFirstMessageIndex(metadata.activeGreetingIndex)
        : undefined;
    if (!an || typeof an !== 'object') {
      return {
        authorsNote: null,
        ...(selectedAlternateGreetingIndex !== undefined
          ? { selectedAlternateGreetingIndex }
          : {}),
      };
    }
    const o = an as { content?: unknown; depth?: unknown; role?: unknown; position?: unknown };
    return {
      authorsNote: {
        content: typeof o.content === 'string' ? o.content : '',
        ...(typeof o.depth === 'number' ? { depth: o.depth } : {}),
        ...(typeof o.role === 'string' ? { role: o.role } : {}),
        ...(typeof o.position === 'number' ? { position: o.position } : {}),
      },
      ...(selectedAlternateGreetingIndex !== undefined
        ? { selectedAlternateGreetingIndex }
        : {}),
    };
  } catch {
    return { authorsNote: null };
  }
}

export async function assembleDisplaySnapshot(
  deps: DisplaySnapshotAssemblyDeps,
  active: ActiveCard,
  chatId: string,
  userId: string,
  vars: { local: Record<string, string>; global: Record<string, string>; chat: Record<string, string> },
): Promise<DisplaySnapshot> {
  const characterId = active.card.character_id;
  const [charRaw, personaRaw] = await Promise.all([
    spindle.characters.get(characterId, userId).catch(() => null) as Promise<LumiCharacterRaw | null>,
    spindle.personas.getActive(userId).catch(() => null) as Promise<LumiPersonaRaw | null>,
  ]);
  const ch = charRaw ?? {};
  const persona = personaRaw ?? {};

  const bookIds = Array.isArray(ch.world_book_ids) ? ch.world_book_ids : [];
  const [messagesHost, lorebookHost, chatRuntimeState] = await Promise.all([
    fetchHostMessages(chatId),
    fetchHostLorebook(bookIds, userId),
    fetchChatRuntimeState(chatId, userId),
  ]);

  const chatView = buildRisuChatView({ messages: messagesHost });
  const chatState = buildDisplayChatStateFromView(chatView);

  const triggers = active.card.risuPayload.triggers as readonly TriggerScript[];
  const luaScripts = active.card.risuPayload.lua_scripts;
  const hasEditDisplayLua = triggers.some((t) => t.effect?.[0]?.type === 'triggerlua');
  const hasEditAtActions = (active.card.risuPayload.at_actions as ReadonlyArray<unknown>).length > 0;
  const luaTriggers: DisplayLuaTrigger[] = triggers.map((t, i) => ({
    source: t,
    luaCode: luaScripts[i] ?? '',
  }));

  const dims = getScreenDims(userId);

  return {
    chatId,
    characterId,
    userName: persona.name ?? '',
    charName: ch.name ?? '',
    personaText: persona.description ?? '',
    personaImage: getActivePersonaImage(userId) ?? '',
    personaImageId: persona.image_id ?? null,
    chatAuthorsNote: chatRuntimeState.authorsNote,
    character: {
      description: ch.description ?? '',
      personality: ch.personality ?? '',
      scenario: ch.scenario ?? '',
      exampleDialogue: ch.mes_example ?? '',
      mainPrompt: ch.system_prompt ?? '',
      postHistoryInstructions: ch.post_history_instructions ?? '',
      creatorNotes: ch.creator_notes ?? '',
      jailbreakPrompt: '',
      globalNote: '',
      authorsNote: '',
      firstMessage: ch.first_mes ?? '',
      alternateGreetings: ch.alternate_greetings ?? [],
      selectedAlternateGreetingIndex:
        chatRuntimeState.selectedAlternateGreetingIndex
        ?? toRisuFirstMessageIndex(chatView.greetingIndex),
      ...(chatView.greeting !== undefined
        ? { selectedGreeting: chatView.greeting }
        : {}),
      additionalAssets: active.card.asset_index,
      emotionImages: active.card.emotion_index,
      image: getActiveCharacterImage(chatId) ?? '',
      imageId: ch.image_id ?? null,
    },
    chat: chatState,
    vars: { local: { ...vars.local }, global: { ...vars.global }, chat: { ...vars.chat } },
    scriptstateDefaults: active.card.risuPayload.scriptstate_defaults,
    screenWidth: dims?.width ?? 0,
    screenHeight: dims?.height ?? 0,
    legacyMediaFindings: deps.legacyMediaFindings(userId),
    modulesByNamespace: deps.modulesByNamespaceFromCard(active.card) ?? {},
    compiledLibraries: deps.getCompiledLibraries(active),
    lorebook: getActiveLorebook(chatId),
    hasEditDisplayLua,
    hasEditAtActions,
    luaTriggers,
    messagesHost,
    lorebookHost,
    atActions: coerceAtActions(active.card.risuPayload.at_actions as readonly unknown[]),
  };
}
