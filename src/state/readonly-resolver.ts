declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import { runPipeline } from '../interpreter/evaluator/pipeline.js';
import { buildEvaluatorContext, type BuildEvaluatorCtxInput } from '../interpreter/evaluator/context.js';
import { evaluate } from '../interpreter/evaluator/scanner.js';
import { stripSetvarSpans, hasSetvarFamily } from '../interpreter/evaluator/strip-setvar.js';
import { getActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { imageUrlFromId } from '../interpreter/image-cache.js';
import { getDecoratorBuffers as readDecoratorBuffers } from '../interpreter/decorator-buffers.js';
import { buildRisuChatView } from '../interpreter/risu-chat-view.js';
import { toRisuFirstMessageIndex } from '../interpreter/greeting-index.js';
import type { Message } from '../core/cbs/index.js';
import type { RisuCompatSettings } from '../state/settings-store.js';

export interface ChatMessage {
  readonly id: string;
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: number;
  readonly speaker?: string;
  readonly greetingIndex?: number;
}

export interface ReadonlyResolverDeps {
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

export interface ReadonlyResolver {
  readonly resolve: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean; rmVar?: boolean },
  ) => Promise<string>;
  readonly resolveMany: (
    templates: readonly string[],
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean; rmVar?: boolean },
  ) => Promise<readonly string[]>;
  readonly resolveInWorker: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string,
    cbsContext?: boolean,
    rmVar?: boolean,
  ) => Promise<string>;
  readonly fetchMessages: (chatId: string) => Promise<readonly ChatMessage[]>;
  // Risu runCurrentChatFunction parity: execute + strip the setvar family from
  // stored message text, returning the stripped rows + accumulated var writes.
  readonly stripMessageSetvars: (
    chatId: string,
    characterId: string,
    userId: string,
  ) => Promise<{
    readonly changed: ReadonlyArray<{ readonly id: string; readonly content: string }>;
    readonly varWrites: ReadonlyArray<readonly [string, string | null]>;
  }>;
}

export function createReadonlyResolver(deps: ReadonlyResolverDeps): ReadonlyResolver {
  const { log, errMsg, activeCardByChat } = deps;

  async function fetchMessages(chatId: string): Promise<readonly ChatMessage[]> {
    try {
      const msgs = await spindle.chat.getMessages(chatId);
      return msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.send_date ?? m.created_at ?? 0,
        ...(m.name ? { speaker: m.name } : {}),
        ...(typeof m.extra?.greeting_index === 'number'
          ? { greetingIndex: m.extra.greeting_index }
          : {}),
      }));
    } catch (err) {
      log.error(`fetchChatMessages chat=${chatId} failed: ${errMsg(err)}`);
      return [];
    }
  }

  // Shared context input for both resolveInWorker and the runVar strip pass.
  async function buildCtxInput(
    chatId: string,
    characterId: string,
    userId: string,
    messages: readonly ChatMessage[],
    cbsContext: boolean,
  ): Promise<Omit<BuildEvaluatorCtxInput, 'commit'>> {
    const [chat, character, persona] = await Promise.all([
      spindle.chats.get(chatId, userId),
      spindle.characters.get(characterId, userId),
      spindle.personas.getActive(userId).catch(() => null),
    ]);

    const metadata = (chat?.metadata ?? {}) as {
      macro_variables?: {
        local?: Record<string, string>;
        global?: Record<string, string>;
        chat?: Record<string, string>;
      };
      chat_variables?: Record<string, string>;
      activeGreetingIndex?: number;
    };
    const mv = metadata.macro_variables ?? {};
    const chatVars = metadata.chat_variables;

    const view = buildRisuChatView({ messages });
    const risuMessages: Message[] = view.messages.map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      createdAt: m.createdAt ?? 0,
      ...(m.speaker ? { speaker: m.speaker } : {}),
    }));
    const lastMessageId = risuMessages.length - 1;
    const assistantTail = [...risuMessages].reverse().find((m) => m.role === 'assistant');
    const userTail = [...risuMessages].reverse().find((m) => m.role === 'user');
    const assetIndexes = getActiveAssetIndexes(chatId);
    const activeCard = activeCardByChat.get(chatId)?.card;
    const scriptstateDefaults = activeCard?.risuPayload.scriptstate_defaults;
    const screenDims = getScreenDims(userId);

    const charImageUrl = imageUrlFromId(
      (character as { image_id?: unknown } | null | undefined)?.image_id as string | null | undefined,
    );
    const personaImageUrl = imageUrlFromId(
      (persona as { image_id?: unknown } | null | undefined)?.image_id as string | null | undefined,
    );

    return {
      chatId,
      ...(userId !== undefined ? { userId } : {}),
      characterId,
      ...(cbsContext ? { cbsContext: true, currentMessageIndexOverride: -1 } : {}),
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
          metadata.activeGreetingIndex ?? view.greetingIndex,
        ),
        ...(view.greeting !== undefined
          ? { selectedGreeting: view.greeting }
          : {}),
        ...(assetIndexes ? { additionalAssets: assetIndexes.assets } : {}),
        ...(assetIndexes ? { emotionImages: assetIndexes.emotions } : {}),
        ...(charImageUrl ? { image: charImageUrl } : {}),
      },
      chat: {
        // The evaluator accepts Lumi's greeting-included count and shifts it
        // once; the full array itself is already in Risu's greeting-free frame.
        messageCount: risuMessages.length + 1,
        lastMessageId,
        lastMessage: risuMessages[risuMessages.length - 1]?.content ?? '',
        lastCharMessage: assistantTail?.content ?? '',
        lastUserMessage: userTail?.content ?? '',
        messages: risuMessages,
      },
      variables: {
        ...(mv.local ? { local: mv.local } : {}),
        ...(mv.global ? { global: mv.global } : {}),
        ...(chatVars ? { chat: chatVars } : {}),
      },
      legacyMediaFindings: deps.getCachedSettingsSync(userId).legacyMediaFindings,
      ...(activeCard && deps.modulesByNamespaceFromCard(activeCard) ? { modulesByNamespace: deps.modulesByNamespaceFromCard(activeCard)! } : {}),
      ...(readDecoratorBuffers(chatId)?.positionPt
        ? { positionPt: readDecoratorBuffers(chatId)!.positionPt }
        : {}),
    };
  }

  async function resolveInWorker(
    template: string,
    chatId: string,
    characterId: string,
    userId: string,
    cbsContext = false,
    rmVar = false,
  ): Promise<string> {
    const messages = await fetchMessages(chatId);
    const ctxInput = await buildCtxInput(chatId, characterId, userId, messages, cbsContext);
    return runPipeline({
      ...ctxInput,
      template,
      phase: 'display',
      ...(rmVar ? { rmVar: true } : {}),
    });
  }

  async function resolveMany(
    templates: readonly string[],
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean; rmVar?: boolean },
  ): Promise<readonly string[]> {
    if (templates.length === 0) return [];
    if (userId === undefined) {
      log.warn(`resolveReadonlyMany: userId not captured chat=${chatId}, returning templates verbatim`);
      return [...templates];
    }

    const t0 = Date.now();
    try {
      const messages = await fetchMessages(chatId);
      const ctxInput = await buildCtxInput(
        chatId,
        characterId,
        userId,
        messages,
        opts?.cbsContext === true,
      );
      const resolved = templates.map((template) =>
        runPipeline({
          ...ctxInput,
          template,
          phase: 'display',
          ...(opts?.rmVar === true ? { rmVar: true } : {}),
        }),
      );
      log.debug(
        `resolveReadonlyMany: DONE chat=${chatId} entries=${templates.length} ` +
          `elapsed=${Date.now() - t0}ms`,
      );
      return resolved;
    } catch (err) {
      log.error(
        `resolveReadonlyMany: worker-eval threw chat=${chatId}: ${(err as Error).message}. ` +
          `Returning templates verbatim (no Lumi-native fallback).`,
      );
      return [...templates];
    }
  }

  async function stripMessageSetvars(
    chatId: string,
    characterId: string,
    userId: string,
  ): Promise<{
    changed: ReadonlyArray<{ id: string; content: string }>;
    varWrites: ReadonlyArray<readonly [string, string | null]>;
  }> {
    const all = await fetchMessages(chatId);
    const messages = buildRisuChatView({ messages: all }).messages;
    if (!messages.some((m) => hasSetvarFamily(m.content))) {
      return { changed: [], varWrites: [] };
    }
    const varWrites = new Map<string, string | null>();
    const ctxInput = await buildCtxInput(chatId, characterId, userId, all, false);
    // One ctx shared across every message so the per-chat overlay accumulates
    // (message A's setvar visible to message B's addvar), matching Risu's pass.
    const ctx = buildEvaluatorContext({
      ...ctxInput,
      commit: true,
      runVar: true,
      localVarSink: (name, value) => { varWrites.set(name, value); },
    });
    const changed: Array<{ id: string; content: string }> = [];
    for (const m of messages) {
      const res = stripSetvarSpans(m.content, (span) => evaluate(span, ctx));
      if (res.changed) changed.push({ id: m.id, content: res.text });
    }
    return { changed, varWrites: [...varWrites] };
  }

  async function resolve(
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean; rmVar?: boolean },
  ): Promise<string> {
    const cbsContext = opts?.cbsContext === true;
    const rmVar = opts?.rmVar === true;
    const t0 = Date.now();
    log.debug(
      `resolveReadonly: START chat=${chatId} char=${characterId} userId=${userId ?? '<none>'} cbs=${cbsContext} template_len=${template.length} ` +
        `template[0..200]=${JSON.stringify(template.slice(0, 200))}`,
    );
    // Our in-worker evaluator is the only resolver: Lumi's native engine cannot
    // parse raw Risu CBS. Operator-scoped Spindle calls reject without a userId,
    // so pre-capture we return the template verbatim rather than mis-resolve.
    if (userId === undefined) {
      log.warn(`resolveReadonly: userId not captured chat=${chatId}, returning template verbatim`);
      return template;
    }
    try {
      const out = await resolveInWorker(template, chatId, characterId, userId, cbsContext, rmVar);
      log.debug(
        `resolveReadonly: DONE chat=${chatId} elapsed=${Date.now() - t0}ms out_len=${out.length} ` +
          `out[0..200]=${JSON.stringify(out.slice(0, 200))}`,
      );
      return out;
    } catch (err) {
      log.error(`resolveReadonly: worker-eval threw chat=${chatId}: ${(err as Error).message}. Returning template verbatim (no Lumi-native fallback).`);
      return template;
    }
  }

  return { resolve, resolveMany, resolveInWorker, fetchMessages, stripMessageSetvars };
}
