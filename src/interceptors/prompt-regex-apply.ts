declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import type { RunPipelineInput, PipelinePhase } from '../interpreter/evaluator/pipeline.js';
import { runPipeline } from '../interpreter/evaluator/pipeline.js';
import { applyRegexScriptsCore, type RegexCoreScript } from '../display/regex-core.js';
import { getActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { imageUrlFromId } from '../interpreter/image-cache.js';
import { getDecoratorBuffers as readDecoratorBuffers } from '../interpreter/decorator-buffers.js';
import { getActiveLorebook } from '../state/lorebook-cache.js';
import { getCachedMessages } from '../interpreter/messages-cache.js';
import { getRegexScriptsApi } from '../adapters/spindle-extras.js';
import type { LlmMessage } from '../adapters/spindle-extras.js';
import type { RisuCompatSettings } from '../state/settings-store.js';
import { toRisuFirstMessageIndex } from '../interpreter/greeting-index.js';

export const PROMPT_REGEX_PHASE: PipelinePhase = 'commit';

export interface PromptRegexApplyDeps {
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly getCachedSettingsSync: (userId: string | undefined) => RisuCompatSettings;
  readonly modulesByNamespaceFromCard: (
    card: StoredRisuCard,
  ) => Readonly<Record<string, readonly string[]>> | null;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
    readonly debug: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export type PrebuiltPipelineInput = Omit<RunPipelineInput, 'template'>;

async function fetchMessages(
  chatId: string,
  log: PromptRegexApplyDeps['log'],
  errMsg: PromptRegexApplyDeps['errMsg'],
): Promise<readonly {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  greetingIndex?: number;
}[]> {
  try {
    const msgs = await spindle.chat.getMessages(chatId);
    return msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ...(typeof m.extra?.greeting_index === 'number'
        ? { greetingIndex: m.extra.greeting_index }
        : {}),
    }));
  } catch (err) {
    log.error(`prompt-regex fetchMessages chat=${chatId} failed: ${errMsg(err)}`);
    return [];
  }
}

export async function buildBackendPipelineInput(
  chatId: string,
  characterId: string,
  userId: string,
  deps: PromptRegexApplyDeps,
  personaId?: string,
): Promise<PrebuiltPipelineInput> {
  const { log, errMsg } = deps;
  const personaFetch =
    personaId !== undefined
      ? spindle.personas.get(personaId, userId).catch(() => null)
      : spindle.personas.getActive(userId).catch(() => null);
  const [chat, character, messages, persona] = await Promise.all([
    spindle.chats.get(chatId, userId),
    spindle.characters.get(characterId, userId),
    fetchMessages(chatId, log, errMsg),
    personaFetch,
  ]);

  const metadata = (chat?.metadata ?? {}) as {
    macro_variables?: {
      local?: Record<string, string>;
      global?: Record<string, string>;
    };
    chat_variables?: Record<string, string>;
    activeGreetingIndex?: number;
  };
  const mv = metadata.macro_variables ?? {};
  const chatVars = metadata.chat_variables;

  const lastMessageId = messages.length === 0 ? -1 : messages.length - 1;
  const assistantTail = [...messages].reverse().find((m) => m.role === 'assistant');
  const userTail = [...messages].reverse().find((m) => m.role === 'user');
  const assetIndexes = getActiveAssetIndexes(chatId);
  const activeCard = deps.activeCardByChat.get(chatId)?.card;
  const scriptstateDefaults = activeCard?.risuPayload.scriptstate_defaults;
  const screenDims = getScreenDims(userId);
  const cachedMessages = getCachedMessages(chatId);
  const activeLore = getActiveLorebook(chatId);
  const selectedGreeting =
    messages.length > 0 && messages[0]!.role !== 'user'
      ? messages[0]!.content
      : undefined;

  const charImageUrl = imageUrlFromId(
    (character as { image_id?: unknown } | null | undefined)?.image_id as string | null | undefined,
  );
  const personaImageUrl = imageUrlFromId(
    (persona as { image_id?: unknown } | null | undefined)?.image_id as string | null | undefined,
  );

  return {
    phase: PROMPT_REGEX_PHASE,
    suppressVarPersist: true,
    chatId,
    userId,
    characterId,
    ...(scriptstateDefaults && Object.keys(scriptstateDefaults).length > 0
      ? { scriptstateDefaults }
      : {}),
    ...(screenDims ? { screenWidth: screenDims.width, screenHeight: screenDims.height } : {}),
    userName: persona?.name ?? '',
    charName: character?.name ?? '',
    ...(persona?.description ? { personaText: persona.description } : {}),
    ...(personaImageUrl ? { personaImage: personaImageUrl } : {}),
    character: {
      description: character?.description ?? '',
      personality: character?.personality ?? '',
      scenario: character?.scenario ?? '',
      exampleDialogue: character?.mes_example ?? '',
      mainPrompt: character?.system_prompt ?? '',
      postHistoryInstructions: character?.post_history_instructions ?? '',
      creatorNotes: character?.creator_notes ?? '',
      firstMessage: character?.first_mes ?? '',
      alternateGreetings: character?.alternate_greetings ?? [],
      selectedAlternateGreetingIndex: toRisuFirstMessageIndex(
        metadata.activeGreetingIndex ?? messages[0]?.greetingIndex,
      ),
      ...(selectedGreeting !== undefined ? { selectedGreeting } : {}),
      ...(assetIndexes ? { additionalAssets: assetIndexes.assets } : {}),
      ...(assetIndexes ? { emotionImages: assetIndexes.emotions } : {}),
      ...(charImageUrl ? { image: charImageUrl } : {}),
    },
    chat: {
      messageCount: messages.length,
      lastMessageId,
      lastMessage: messages[messages.length - 1]?.content ?? '',
      lastCharMessage: assistantTail?.content ?? '',
      lastUserMessage: userTail?.content ?? '',
      ...(cachedMessages ? { messages: cachedMessages } : {}),
    },
    variables: {
      ...(mv.local ? { local: mv.local } : {}),
      ...(mv.global ? { global: mv.global } : {}),
      ...(chatVars ? { chat: chatVars } : {}),
    },
    legacyMediaFindings: deps.getCachedSettingsSync(userId).legacyMediaFindings,
    wrapIslands: false,
    lorebook: activeLore,
    ...(activeCard && deps.modulesByNamespaceFromCard(activeCard)
      ? { modulesByNamespace: deps.modulesByNamespaceFromCard(activeCard)! }
      : {}),
    ...(readDecoratorBuffers(chatId)?.positionPt
      ? { positionPt: readDecoratorBuffers(chatId)!.positionPt }
      : {}),
  };
}

function placementForRole(role: 'system' | 'user' | 'assistant'): string {
  if (role === 'user') return 'user_input';
  if (role === 'assistant') return 'ai_output';
  return 'world_info';
}

export async function applyPromptRegexToArray(
  messages: LlmMessage[],
  prebuilt: PrebuiltPipelineInput,
  scripts: readonly RegexCoreScript[],
): Promise<{ changed: boolean }> {
  if (scripts.length === 0) return { changed: false };

  // Build the depth frame from genuine chat-history turns only
  const hasHistoryFlag = messages.some(
    (m) => (m as { __isChatHistory?: boolean }).__isChatHistory === true,
  );
  const isHistory = (m: LlmMessage): boolean =>
    hasHistoryFlag
      ? (m as { __isChatHistory?: boolean }).__isChatHistory === true
      : m.role !== 'system';

  const historyIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] && isHistory(messages[i]!)) historyIndices.push(i);
  }
  const depthByIndex = new Map<number, number>();
  // Per-message Risu chat index: history turns are 0-based in chat-history order
  // (Risu's editprocess loop `index`, index.svelte.ts:817-818). Non-history blocks
  // (system / WI / preset depth injections) have no message context → -1.
  //
  // GREETING FRAME-SHIFT (message-index-frames.md): the host tags the greeting as
  // chat-history (it's message[0], __isChatHistory), so it's historyIndices[0]. Risu
  // EXCLUDES the greeting from chat.message[] and processes it at chatID=-1
  // (index.svelte.ts:789), with the first REAL turn at index 0 (:816-818). So the
  // Risu index is the history position MINUS 1 (greeting pos 0 → -1, first real → 0),
  // matching the editInput path's `userIdx - 1 // Risu chat index excludes greeting`
  // (lumi-hooks.ts). The evaluator clamps at -1 (context.ts).
  const risuIndexByArrayIndex = new Map<number, number>();
  for (let pos = 0; pos < historyIndices.length; pos++) {
    depthByIndex.set(historyIndices[pos]!, historyIndices.length - 1 - pos);
    risuIndexByArrayIndex.set(historyIndices[pos]!, pos - 1);
  }

  // Per-message macro frame: Risu resolves {{chatindex}}/{{role}} per message
  // (cbs.ts:418 matcherArg.chatID, cbs.ts:671-684 cbsConditions.chatRole). A single
  // fixed evalTemplate would stamp the last message's index/role on every message.
  // Only genuine chat-history messages get a role override (Risu's editprocess sees
  // only 'user'/'char'); non-history blocks (system/WI/preset depth) carry no message
  // context → index -1, role unset → {{role}} resolves "null" (Risu chatID=-1 path),
  // not a blanket "char".
  const evalTemplateFor =
    (msgIndex: number, role: 'user' | 'assistant' | undefined) =>
    (text: string): string =>
      runPipeline({
        ...prebuilt,
        currentMessageIndexOverride: msgIndex,
        ...(role !== undefined ? { currentMessageRoleOverride: role } : {}),
        template: text,
      });

  let changed = false;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const placement = placementForRole(msg.role);
    const depth = depthByIndex.get(i);
    const risuIdx = risuIndexByArrayIndex.has(i) ? risuIndexByArrayIndex.get(i)! : -1;
    // Role override only for REAL history turns (risuIdx >= 0), where Risu threads
    // cbsConditions.chatRole = msg.role. The greeting (risuIdx -1, Risu chatID=-1, no
    // chatRole) and non-history blocks carry no role → {{role}} resolves "null".
    const evalTemplate = evalTemplateFor(
      risuIdx,
      risuIdx >= 0 && msg.role !== 'system' ? msg.role : undefined,
    );

    if (typeof msg.content === 'string') {
      const next = applyRegexScriptsCore(msg.content, scripts, { placement, depth, evalTemplate, reResolveAfterRule: true });
      if (next !== msg.content) {
        messages[i] = { ...msg, content: next };
        changed = true;
      }
    } else if (Array.isArray((msg as { content?: unknown }).content)) {
      const parts = (msg as unknown as { content: readonly unknown[] }).content;
      let partsChanged = false;
      const nextParts = parts.map((rawPart) => {
        const part = rawPart as { type?: unknown; text?: unknown };
        if (part?.type === 'text' && typeof part.text === 'string') {
          const next = applyRegexScriptsCore(part.text, scripts, { placement, depth, evalTemplate, reResolveAfterRule: true });
          if (next !== part.text) {
            partsChanged = true;
            return { ...part, text: next };
          }
        }
        return rawPart;
      });
      if (partsChanged) {
        messages[i] = { ...(msg as object), content: nextParts } as unknown as LlmMessage;
        changed = true;
      }
    }
  }

  return { changed };
}

interface RawRegexRow {
  scope?: unknown;
  scope_id?: unknown;
  disabled?: unknown;
  target?: unknown;
  find_regex?: unknown;
  replace_string?: unknown;
  flags?: unknown;
  substitute_macros?: unknown;
  placement?: unknown;
  min_depth?: unknown;
  max_depth?: unknown;
  trim_strings?: unknown;
}

function rowToPromptScript(r: unknown): RegexCoreScript | null {
  const row = r as RawRegexRow;
  const target = row.target;
  const isPrompt = Array.isArray(target) ? target.includes('prompt') : target === 'prompt';
  if (!isPrompt) return null;
  if (typeof row.find_regex !== 'string') return null;
  const mode = row.substitute_macros;
  return {
    find_regex: row.find_regex,
    replace_string: typeof row.replace_string === 'string' ? row.replace_string : '',
    flags: typeof row.flags === 'string' ? row.flags : 'g',
    substitute_macros: mode === 'escaped' || mode === 'after' || mode === 'raw' ? mode : 'none',
    placement: Array.isArray(row.placement) ? (row.placement as string[]) : [],
    target: 'prompt',
    min_depth: typeof row.min_depth === 'number' ? row.min_depth : null,
    max_depth: typeof row.max_depth === 'number' ? row.max_depth : null,
    trim_strings: Array.isArray(row.trim_strings) ? (row.trim_strings as string[]) : [],
    disabled: false,
  };
}

async function listPromptRegexScope(
  regexApi: NonNullable<ReturnType<typeof getRegexScriptsApi>>,
  userId: string,
  scope: 'global' | 'character' | 'chat',
  scopeId: string | undefined,
): Promise<RegexCoreScript[]> {
  const PAGE_SIZE = 200;
  const out: RegexCoreScript[] = [];
  let offset = 0;
  while (true) {
    const page = await regexApi.list({
      userId,
      limit: PAGE_SIZE,
      offset,
      scope,
      ...(scopeId !== undefined ? { scopeId } : {}),
      target: 'prompt',
    });
    if (!Array.isArray(page.data) || page.data.length === 0) break;
    for (const r of page.data) {
      const row = r as RawRegexRow;
      if (row.scope !== scope) continue;
      if (scopeId !== undefined && row.scope_id !== scopeId) continue;
      if (row.disabled === true) continue;
      const mapped = rowToPromptScript(r);
      if (mapped) out.push(mapped);
    }
    offset += page.data.length;
    if (typeof page.total === 'number' && offset >= page.total) break;
  }
  return out;
}

export async function listLivePromptRegexScripts(
  characterId: string,
  chatId: string,
  userId: string,
): Promise<readonly RegexCoreScript[]> {
  const regexApi = getRegexScriptsApi();
  if (!regexApi?.list) {
    throw new Error('spindle.regex_scripts.list is not available on this host');
  }

  if (regexApi.getActive) {
    const rows = await regexApi.getActive({ target: 'prompt', characterId, chatId, userId });
    const out: RegexCoreScript[] = [];
    for (const r of rows) {
      const mapped = rowToPromptScript(r);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  return [
    ...(await listPromptRegexScope(regexApi, userId, 'global', undefined)),
    ...(await listPromptRegexScope(regexApi, userId, 'character', characterId)),
    ...(await listPromptRegexScope(regexApi, userId, 'chat', chatId)),
  ];
}
