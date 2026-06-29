declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import { runPipeline } from '../interpreter/evaluator/pipeline.js';
import { getActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { imageUrlFromId } from '../interpreter/image-cache.js';
import { getDecoratorBuffers as readDecoratorBuffers } from '../interpreter/decorator-buffers.js';
import type { RisuCompatSettings } from '../state/settings-store.js';

export interface ChatMessage {
  readonly id: string;
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
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
    opts?: { cbsContext?: boolean },
  ) => Promise<string>;
  readonly resolveInWorker: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string,
    cbsContext?: boolean,
  ) => Promise<string>;
  readonly fetchMessages: (chatId: string) => Promise<readonly ChatMessage[]>;
}

export function createReadonlyResolver(deps: ReadonlyResolverDeps): ReadonlyResolver {
  const { log, errMsg, activeCardByChat } = deps;

  async function fetchMessages(chatId: string): Promise<readonly ChatMessage[]> {
    try {
      const msgs = await spindle.chat.getMessages(chatId);
      return msgs.map((m) => ({ id: m.id, role: m.role, content: m.content }));
    } catch (err) {
      log.error(`fetchChatMessages chat=${chatId} failed: ${errMsg(err)}`);
      return [];
    }
  }

  async function resolveInWorker(
    template: string,
    chatId: string,
    characterId: string,
    userId: string,
    cbsContext = false,
  ): Promise<string> {
    const [chat, character, messages, persona] = await Promise.all([
      spindle.chats.get(chatId, userId),
      spindle.characters.get(characterId, userId),
      fetchMessages(chatId),
      spindle.personas.getActive(userId).catch(() => null),
    ]);

    const metadata = (chat?.metadata ?? {}) as {
      macro_variables?: {
        local?: Record<string, string>;
        global?: Record<string, string>;
        chat?: Record<string, string>;
      };
    };
    const mv = metadata.macro_variables ?? {};

    const lastMessageId = messages.length === 0 ? -1 : messages.length - 1;
    const assistantTail = [...messages].reverse().find((m) => m.role === 'assistant');
    const userTail = [...messages].reverse().find((m) => m.role === 'user');
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

    return runPipeline({
      template,
      phase: 'display',
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
      },
      variables: {
        ...(mv.local ? { local: mv.local } : {}),
        ...(mv.global ? { global: mv.global } : {}),
        ...(mv.chat ? { chat: mv.chat } : {}),
      },
      legacyMediaFindings: deps.getCachedSettingsSync(userId).legacyMediaFindings,
      wrapIslands: false,
      ...(activeCard && deps.modulesByNamespaceFromCard(activeCard) ? { modulesByNamespace: deps.modulesByNamespaceFromCard(activeCard)! } : {}),
      ...(readDecoratorBuffers(chatId)?.positionPt
        ? { positionPt: readDecoratorBuffers(chatId)!.positionPt }
        : {}),
    });
  }

  async function resolve(
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean },
  ): Promise<string> {
    const cbsContext = opts?.cbsContext === true;
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
      const out = await resolveInWorker(template, chatId, characterId, userId, cbsContext);
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

  return { resolve, resolveInWorker, fetchMessages };
}
