import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import type { CompiledTriggerEntry } from '../interpreter/dispatcher.js';
import type { DisplaySnapshot, DisplayLuaTrigger } from '../display/snapshot.js';
import type { RuntimeConfig } from '../frontend-lua/state-contract.js';
import type { HostMessage } from '../interpreter/host.js';
import type { Message } from '../core/cbs/index.js';
import type { TriggerScript } from '../core/schemas/triggerscript.js';
import { coerceAtActions } from '../interpreter/at-actions-runtime.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { buildRisuChatView, type RisuChatView } from '../interpreter/risu-chat-view.js';

export interface RuntimeConfigDeps {
  readonly modulesByNamespaceFromCard: (card: StoredRisuCard) => Readonly<Record<string, readonly string[]>> | null;
  readonly legacyMediaFindings: (userId: string | undefined) => boolean;
  readonly getCompiledLibraries: (active: ActiveCard) => readonly CompiledTriggerEntry[];
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

export function assembleRuntimeConfig(deps: RuntimeConfigDeps, active: ActiveCard, chatId: string, userId: string): RuntimeConfig {
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
    characterId: active.card.character_id,
    character: {
      jailbreakPrompt: '', globalNote: '', authorsNote: '',
      additionalAssets: active.card.asset_index,
      emotionImages: active.card.emotion_index,
    },
    scriptstateDefaults: active.card.risuPayload.scriptstate_defaults,
    screenWidth: dims?.width ?? 0,
    screenHeight: dims?.height ?? 0,
    legacyMediaFindings: deps.legacyMediaFindings(userId),
    modulesByNamespace: deps.modulesByNamespaceFromCard(active.card) ?? {},
    compiledLibraries: deps.getCompiledLibraries(active),
    hasEditDisplayLua,
    hasEditAtActions,
    luaTriggers,
    atActions: coerceAtActions(active.card.risuPayload.at_actions as readonly unknown[]),
  };
}
