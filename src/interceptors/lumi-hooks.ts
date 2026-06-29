declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { StoredRisuCard } from '../payload/types.js';
import { runPipeline } from '../interpreter/evaluator/pipeline.js';
import type { VarReadRecorder } from '../interpreter/evaluator/context.js';
import { runListenEditChain } from '../interpreter/listen-edit.js';
import { runAtActionsForPhase, coerceAtActions } from '../interpreter/at-actions-runtime.js';
import { puaEncodeFeMacros, puaDecodeFeMacros } from '../util/pua-roundtrip.js';
import { panelTrace } from '../util/perf.js';
import { perfEnabled, perfRecord } from '../util/perf.js';
import { normalizeReplaceStringForSanitizer } from '../util/sanitizer-doc-shape.js';
import {
  lookupRenderMcp,
  lookupInFlightRenderMcp,
  markRenderMcpInFlight,
  cacheRenderMcp,
  renderMcpCacheStats,
} from '../state/render-mcp-cache.js';
import {
  lookupMacroInterceptor,
  cacheMacroInterceptor,
  macroInterceptorCacheStats,
} from '../state/macro-interceptor-cache.js';
import { rememberOurWrite } from '../state/recent-writes.js';
import { expectChatChange } from '../state/own-chat-change.js';
import { invalidateRecentFlush, getRecentFlush } from '../state/recent-flush-cache.js';
import { getActiveAssetIndexes } from '../interpreter/asset-cache.js';
import { getActiveLorebook } from '../state/lorebook-cache.js';
import { getScreenDims } from '../interpreter/screen-dims-cache.js';
import { getCachedMessages } from '../interpreter/messages-cache.js';
import {
  getActiveCharacterImage,
  getActivePersonaImage,
} from '../interpreter/image-cache.js';
import {
  getDecoratorBuffers as readDecoratorBuffers,
  setDecoratorBuffers,
  clearDecoratorBuffers as clearDecoratorBuffer,
} from '../interpreter/decorator-buffers.js';
import { userIdAls } from '../interpreter/runtime/als.js';
import { makeSpindleHost } from '../interpreter/spindle-host.js';
import { loadVars } from '../interpreter/runtime/chat-state.js';
import { makeDispatcherScriptNS } from '../interpreter/dispatcher.js';
import {
  getRegisterMacroInterceptor,
  getRegisterMessageContentProcessor,
  getRegisterInterceptor,
  getRegisterWorldInfoInterceptor,
  type LlmMessage,
  type InterceptorContext,
} from '../adapters/spindle-extras.js';
import type { RisuCompatSettings } from '../state/settings-store.js';
import type { InjectAtPlan } from '../payload/lorebook-decorator-runtime.js';
import {
  buildBackendPipelineInput,
  listLivePromptRegexScripts,
} from './prompt-regex-apply.js';
import type { RunnerDispatchResult } from './prompt-regex-runner-client.js';

export interface CreateLumiInterceptorsDeps {
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly lastActiveChatByUser: Map<string, string>;
  readonly captureUserId: (userId: string | undefined, where: string) => void;
  readonly isFeDisplayAuthoritative: (chatId: string) => boolean;
  readonly isPromptRegexAuthoritative: (chatId: string) => boolean;
  readonly dispatchPromptRegex: (
    prebuilt: import('./prompt-regex-apply.js').PrebuiltPipelineInput,
    scripts: readonly import('../display/regex-core.js').RegexCoreScript[],
    messages: LlmMessage[],
    userId: string | undefined,
  ) => Promise<RunnerDispatchResult>;
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly getCachedSettingsSync: (userId: string | undefined) => RisuCompatSettings;
  readonly modulesByNamespaceFromCard: (
    card: StoredRisuCard,
  ) => Readonly<Record<string, readonly string[]>> | null;
  readonly resolveReadonly: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean },
  ) => Promise<string>;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
    readonly trace: (m: string) => void;
    readonly debug: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface LumiInterceptors {
  readonly registerAll: () => void;
}

export function createLumiInterceptors(deps: CreateLumiInterceptorsDeps): LumiInterceptors {
  const { log, errMsg, activeCardByChat, lastActiveChatByUser } = deps;

  let diagInterceptorCall = 0;
  let mcpInFlight = 0;
  let mcpEnterSeq = 0;
  let lastCacheStatsAt = 0;
  let lastMicCacheStatsAt = 0;

  function withMaybeUser<T>(userId: string | undefined, fn: () => Promise<T>): Promise<T> {
    return userId !== undefined ? (userIdAls.run(userId, fn) as Promise<T>) : fn();
  }

  function maybeEmitCacheStats(): void {
    const stats = renderMcpCacheStats();
    const lookups = stats.hits + stats.misses;
    if (lookups < 200) return;
    const now = Date.now();
    if (now - lastCacheStatsAt < 5_000) return;
    lastCacheStatsAt = now;
    const ratio = lookups > 0 ? Math.round((stats.hits / lookups) * 100) : 0;
    log.info(
      `[render-mcp-cache] size=${stats.size} hits=${stats.hits} misses=${stats.misses} ratio=${ratio}%`,
    );
  }

  function maybeEmitMicCacheStats(): void {
    const stats = macroInterceptorCacheStats();
    const lookups = stats.hits + stats.misses;
    if (lookups < 200) return;
    const now = Date.now();
    if (now - lastMicCacheStatsAt < 5_000) return;
    lastMicCacheStatsAt = now;
    const ratio = lookups > 0 ? Math.round((stats.hits / lookups) * 100) : 0;
    log.info(
      `[macro-interceptor-cache] size=${stats.size} hits=${stats.hits} misses=${stats.misses} ratio=${ratio}%`,
    );
  }

  // Lumi builds env.variables.local empty during assembly (transient), so prompt-time
  // {{getvar}} for our scriptstate reads null unless we resolve against the stored state.
  const promptLocalColdCache = new Map<string, { vars: Record<string, string>; ts: number }>();
  const PROMPT_LOCAL_COLD_TTL_MS = 1500;
  const stripDollar = (src: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) out[k.startsWith('$') ? k.slice(1) : k] = v;
    return out;
  };
  async function storedLocalForResolve(
    chatId: string,
    userId: string | undefined,
    characterId: string,
  ): Promise<Record<string, string>> {
    const warm = getRecentFlush(chatId);
    if (warm) return stripDollar(warm);
    if (userId === undefined) return {};
    const cached = promptLocalColdCache.get(chatId);
    if (cached && Date.now() - cached.ts < PROMPT_LOCAL_COLD_TTL_MS) return cached.vars;
    try {
      const api = makeSpindleHost({ chatId, characterId, userId });
      const loaded = stripDollar(await loadVars(api));
      promptLocalColdCache.set(chatId, { vars: loaded, ts: Date.now() });
      return loaded;
    } catch {
      return {};
    }
  }

  function registerMacroInterceptorIfAvailable(): void {
    const registerMacroInterceptor = getRegisterMacroInterceptor();
    const registerMessageContentProcessor = getRegisterMessageContentProcessor();
    if (typeof registerMacroInterceptor !== 'function') {
      log.warn('macroInterceptor: NOT AVAILABLE on this Lumi build, extension macros will resolve via per-call RPC (slow for iteration-heavy cards, and FRAME-SHIFT UNRELIABLE without preprocessor coherence)');
      return;
    }
    const mcpRenderAvailable = typeof registerMessageContentProcessor === 'function';

    registerMacroInterceptor((ctx) => withMaybeUser(ctx.userId, async () => {
      const callId = ++diagInterceptorCall;
      const t0 = Date.now();
      const chatId = typeof ctx.env.chat?.id === 'string' ? (ctx.env.chat.id as string) : null;
      const activeBefore = chatId ? activeCardByChat.has(chatId) : false;
      const templateHead = ctx.template.slice(0, 120);
      const hasMarker = /★[A-Z_]+★|###[A-Z_]+###/.test(ctx.template);
      const chatEnv = ctx.env.chat as { id?: string; messageCount?: number; lastMessageId?: number };
      const sourceHint = (ctx as { sourceHint?: string }).sourceHint;
      log.trace(
        `macroInterceptor.enter #${callId} chat=${chatId ?? '<none>'} active_present=${activeBefore} ` +
          `commit=${ctx.commit} phase=${ctx.phase} sourceHint=${sourceHint ?? '<none>'} userId=${ctx.userId ?? '<none>'} ` +
          `tmpl_len=${ctx.template.length} has_marker=${hasMarker} ` +
          `lumi_messageCount=${chatEnv?.messageCount ?? '?'} lumi_lastMessageId=${chatEnv?.lastMessageId ?? '?'} ` +
          `tmpl_head=${JSON.stringify(templateHead)}`,
      );

      if (!ctx.template.includes('{{')) {
        log.trace(`macroInterceptor.exit #${callId} path=no_cbs elapsed=${Date.now() - t0}ms`);
        return;
      }

      deps.captureUserId(ctx.userId, 'macroInterceptor');

      if (!chatId) {
        log.trace(`macroInterceptor.exit #${callId} path=no_chat_id elapsed=${Date.now() - t0}ms`);
        return;
      }
      const active = activeCardByChat.get(chatId);
      if (!active) {
        log.warn(
          `macroInterceptor.exit #${callId} path=no_active_card chat=${chatId} ` +
            `elapsed=${Date.now() - t0}ms ⚠ falling back to Lumi native eval. ` +
            `activeCardByChat keys=[${[...activeCardByChat.keys()].map((k) => k.slice(0, 8)).join(',')}]`,
        );
        return;
      }
      if (ctx.userId && active.ownerUserId !== ctx.userId) {
        log.warn(
          `macroInterceptor.exit #${callId} path=owner_mismatch chat=${chatId} ` +
            `cached=${active.ownerUserId} ctx=${ctx.userId} elapsed=${Date.now() - t0}ms`,
        );
        return;
      }

      const micDynForKey = (ctx.env as { dynamicMacros?: Record<string, string> }).dynamicMacros;
      const micCtxKey = `${micDynForKey?.chat_index ?? ''}|${micDynForKey?.role ?? ''}`;
      const cacheable = !(ctx.commit === false && !mcpRenderAvailable);
      if (cacheable) {
        const hit = lookupMacroInterceptor(chatId, ctx.template, ctx.commit !== false, micCtxKey);
        if (hit !== null) {
          maybeEmitMicCacheStats();
          log.trace(
            `macroInterceptor.exit #${callId} path=cache_hit elapsed=${Date.now() - t0}ms ` +
              `tmpl_len=${ctx.template.length} out_len=${hit.result.length}`,
          );
          return { text: hit.result, touchedVars: hit.touchedVars, volatile: hit.volatile };
        }
      }

      const charCard = ctx.env.character as {
        name?: string;
        description?: string;
        personality?: string;
        scenario?: string;
        mesExamples?: string;
        mesExamplesRaw?: string;
        systemPrompt?: string;
        postHistoryInstructions?: string;
        creatorNotes?: string;
        persona?: string;
        firstMessage?: string;
      };
      const envChat = ctx.env.chat as {
        id?: string;
        messageCount?: number;
        lastMessage?: string;
        lastUserMessage?: string;
        lastCharMessage?: string;
        lastMessageId?: number;
      };
      const namesEnv = ctx.env.names as { user?: string; char?: string };

      const assetIndexes = getActiveAssetIndexes(chatId);
      const scriptstateDefaults = active.card.risuPayload.scriptstate_defaults;
      const screenDims = getScreenDims(ctx.userId);
      const charImage = getActiveCharacterImage(chatId);
      const personaImage = getActivePersonaImage(ctx.userId);

      const dynamicMacros = (ctx.env as { dynamicMacros?: Record<string, string> }).dynamicMacros;
      const dynChatIndex = dynamicMacros?.chat_index;
      const dynChatIndexNum = typeof dynChatIndex === 'string' && /^-?\d+$/.test(dynChatIndex)
        ? parseInt(dynChatIndex, 10) - 1
        : undefined;
      const dynRole = typeof dynamicMacros?.role === 'string' ? dynamicMacros.role : undefined;
      const cachedMessages = getCachedMessages(chatId);
      const activeLore = getActiveLorebook(chatId);
      if (ctx.template.includes('lorebook') || ctx.template.includes('risu_each')) {
        log.trace(`macroInterceptor #${callId}: lorebook entries=${activeLore.length} for chat=${chatId} (tmpl mentions lorebook/each)`);
      }

      const storedLocal = await storedLocalForResolve(chatId, ctx.userId, active.card.character_id);
      let resolved: string;
      const recorder: VarReadRecorder = { touched: new Set<string>(), volatile: false };
      const __ppT0 = perfEnabled() ? Date.now() : 0;
      try {
        resolved = runPipeline({
          template: ctx.template,
          phase: ctx.commit ? 'commit' : 'display',
          chatId,
          ...(ctx.userId !== undefined ? { userId: ctx.userId } : {}),
          ...(dynChatIndexNum !== undefined ? { currentMessageIndexOverride: dynChatIndexNum } : {}),
          ...(dynRole !== undefined ? { currentMessageRoleOverride: dynRole } : {}),
          characterId: active.card.character_id,
          userName: namesEnv.user ?? '',
          charName: namesEnv.char ?? charCard.name ?? '',
          ...(charCard.persona ? { personaText: charCard.persona } : {}),
          ...(personaImage ? { personaImage } : {}),
          character: {
            description: charCard.description ?? '',
            personality: charCard.personality ?? '',
            scenario: charCard.scenario ?? '',
            exampleDialogue: charCard.mesExamples ?? charCard.mesExamplesRaw ?? '',
            mainPrompt: charCard.systemPrompt ?? '',
            postHistoryInstructions: charCard.postHistoryInstructions ?? '',
            creatorNotes: charCard.creatorNotes ?? '',
            firstMessage: charCard.firstMessage ?? '',
            ...(assetIndexes?.assets ? { additionalAssets: assetIndexes.assets } : {}),
            ...(assetIndexes?.emotions ? { emotionImages: assetIndexes.emotions } : {}),
            ...(charImage ? { image: charImage } : {}),
          },
          chat: {
            ...(typeof envChat.messageCount === 'number' ? { messageCount: envChat.messageCount } : {}),
            ...(typeof envChat.lastMessage === 'string' ? { lastMessage: envChat.lastMessage } : {}),
            ...(typeof envChat.lastUserMessage === 'string' ? { lastUserMessage: envChat.lastUserMessage } : {}),
            ...(typeof envChat.lastCharMessage === 'string' ? { lastCharMessage: envChat.lastCharMessage } : {}),
            ...(typeof envChat.lastMessageId === 'number' ? { lastMessageId: envChat.lastMessageId } : {}),
            ...(cachedMessages ? { messages: cachedMessages } : {}),
          },
          variables: {
            local: { ...ctx.env.variables.local, ...storedLocal },
            global: ctx.env.variables.global,
            chat: ctx.env.variables.chat,
          },
          ...(scriptstateDefaults && Object.keys(scriptstateDefaults).length > 0
            ? { scriptstateDefaults }
            : {}),
          ...(screenDims ? { screenWidth: screenDims.width, screenHeight: screenDims.height } : {}),
          legacyMediaFindings: deps.getCachedSettingsSync(ctx.userId).legacyMediaFindings,
          lorebook: activeLore,
          ...(deps.modulesByNamespaceFromCard(active.card) ? { modulesByNamespace: deps.modulesByNamespaceFromCard(active.card)! } : {}),
          ...(readDecoratorBuffers(chatId)?.positionPt
            ? { positionPt: readDecoratorBuffers(chatId)!.positionPt }
            : {}),
        }, { recorder });
      } catch (err) {
        log.warn(`macroInterceptor: runPipeline threw chat=${chatId} phase=${ctx.phase}: ${errMsg(err)}. Passing through.`);
        return;
      }
      if (__ppT0) perfRecord("cbs.runPipeline", Date.now() - __ppT0);

      const resolvedMarker = /★[A-Z_]+★|###[A-Z_]+###/.exec(resolved)?.[0] ?? null;
      const stillHasRaw = resolved.includes('{{risu_') || resolved.includes('{{getvar::') || resolved.includes('{{#risu_');

      // editDisplay fallback for Lumi builds without the render MCP origin (the load-bearing path on Lumi 0.9.6+).
      // DO NOT widen this gate, every commit:false template flowing through here (bg-html, 88KB CSS bundles) feeds 16+ Lua VMs, ~12s per chat-open on listenEdit-heavy cards.
      if (!ctx.commit && !mcpRenderAvailable) {
        const triggers = active.card.risuPayload.triggers as ReadonlyArray<{
          effect?: ReadonlyArray<{ type?: string }>;
        }>;
        const luaScripts = active.card.risuPayload.lua_scripts;
        const hasLuaTrigger = triggers.some(
          (t) => t.effect?.[0]?.type === 'triggerlua',
        );
        if (hasLuaTrigger && ctx.userId !== undefined) {
          const editChain = triggers.map((t, i) => ({
            source: t,
            luaCode: luaScripts[i] ?? '',
          }));
          try {
            const editApi = makeSpindleHost({
              chatId,
              characterId: active.card.character_id,
              userId: ctx.userId,
            });
            const editScriptNS = makeDispatcherScriptNS();
            resolved = await runListenEditChain(
              editChain,
              'editDisplay',
              resolved,
              { index: typeof envChat.lastMessageId === 'number' ? envChat.lastMessageId : -1 },
              editApi,
              { characterId: active.card.character_id },
              editScriptNS,
              {
                chatId,
                characterId: active.card.character_id,
                resolveTemplate: (text: string) => deps.resolveReadonly(text, chatId, active.card.character_id, ctx.userId, { cbsContext: true }),
              },
            );
            recorder.volatile = true;
          } catch (err) {
            log.warn(`macroInterceptor: listenEdit chain threw: ${errMsg(err)}. Continuing with pre-hook resolved.`);
          }
        }

        // @@emo and @@repeat_back fire from the render MCP origin and runBinding,output. Skip them here so setExpression doesn't over-trigger.
      }

      const touchedVars = [...recorder.touched];
      if (resolved === ctx.template) {
        if (cacheable) {
          cacheMacroInterceptor(chatId, ctx.template, ctx.commit !== false, micCtxKey, resolved, touchedVars, recorder.volatile);
          maybeEmitMicCacheStats();
        }
        log.trace(
          `macroInterceptor.exit #${callId} path=unchanged_passthrough elapsed=${Date.now() - t0}ms ` +
            `tmpl_len=${ctx.template.length} marker=${resolvedMarker ?? 'none'}`,
        );
        return { text: resolved, touchedVars, volatile: recorder.volatile };
      }
      if (cacheable) {
        cacheMacroInterceptor(chatId, ctx.template, ctx.commit !== false, micCtxKey, resolved, touchedVars, recorder.volatile);
        maybeEmitMicCacheStats();
      }
      // Doc-boundary normalize is NOT applied here. macroInterceptor fires for both replace_string and find_regex, and wrapping a find_regex would break compilation.
      log.trace(
        `macroInterceptor.exit #${callId} path=resolved elapsed=${Date.now() - t0}ms ` +
          `in_len=${ctx.template.length} out_len=${resolved.length} ` +
          `marker=${resolvedMarker ?? 'none'} still_has_raw_cbs=${stillHasRaw} ` +
          `out_head=${JSON.stringify(resolved.slice(0, 120))}`,
      );
      // Panel-shape diagnostics: emit a single fingerprint line when the resolved output looks like a status/sys panel wrapper.
      if (resolved.length > 200) {
        const panelMatches = resolved.match(/<div[^>]*class="[^"]*(?:sys-backdrop|sys-panel|status-?panel)[^"]*"/g);
        if (panelMatches && panelMatches.length > 0) {
          log.info(
            `[panel-shape] callId=${callId} commit=${ctx.commit} count=${panelMatches.length} ` +
              `out_len=${resolved.length} ` +
              `head=${JSON.stringify(resolved.slice(0, 60))} ` +
              `tail=${JSON.stringify(resolved.slice(-60))}`,
          );
        }
      }
      return { text: resolved, touchedVars, volatile: recorder.volatile };
    }), 100);
    log.info('macroInterceptor: registered at priority=100');
  }

  function registerMessageContentProcessorIfAvailable(): void {
    const registerMessageContentProcessor = getRegisterMessageContentProcessor();
    if (typeof registerMessageContentProcessor !== 'function') {
      log.info('messageContentProcessor: not available on this Lumi build, falling back to reactive MESSAGE_EDITED resolve');
      return;
    }
    registerMessageContentProcessor((ctx) => withMaybeUser(ctx.userId, async () => {
      // Gate only on "is this a Risu-imported chat?". Risu's semantic runs the pipeline always, with `resolved === ctx.content` as the short-circuit.
      const tStart = Date.now();
      const seq = ++mcpEnterSeq;
      const enteredAt = ++mcpInFlight;
      log.trace(
        `messageContentProcessor.enter #${seq} chat=${ctx.chatId} origin=${ctx.origin} msg=${ctx.messageId ?? '<new>'} raw_len=${ctx.content.length} inflight=${enteredAt}`,
      );
      try {
        deps.captureUserId(ctx.userId, 'messageContentProcessor');
        const tA = Date.now();
        const active = await deps.ensureActiveCardForChat(ctx.chatId, null, ctx.userId);
        const tB = Date.now();
        if (!active) {
          log.trace(
            `messageContentProcessor.exit #${seq} path=skip-not-lumirealm chat=${ctx.chatId} ensure=${tB - tA}ms total=${Date.now() - tStart}ms`,
          );
          return;
        }

        if (ctx.origin === 'render') {
          if (deps.isFeDisplayAuthoritative(ctx.chatId)) {
            log.trace(
              `messageContentProcessor.exit #${seq} path=fe-owned-passthrough chat=${ctx.chatId} msg=${ctx.messageId ?? '<new>'} total=${Date.now() - tStart}ms (FE owns display; backend skips render-MCP)`,
            );
            return;
          }
          const triggers = active.card.risuPayload.triggers as ReadonlyArray<{
            effect?: ReadonlyArray<{ type?: string }>;
          }>;
          const luaScripts = active.card.risuPayload.lua_scripts;
          const hasLuaTrigger = triggers.some(
            (t) => t.effect?.[0]?.type === 'triggerlua',
          );
          const renderAtActions = coerceAtActions(active.card.risuPayload.at_actions);
          const rawIdx = ctx.extra?.['messageIndex'];
          const messageIndex = typeof rawIdx === 'number' ? rawIdx : 0;
          const risuChatIdx = Math.max(-1, messageIndex - 1);

          if (ctx.messageId) {
            const cached = lookupRenderMcp(ctx.chatId, ctx.messageId, ctx.content);
            maybeEmitCacheStats();
            if (cached) {
              const totalMs = Date.now() - tStart;
              if (cached.kind === 'noop') {
                log.trace(
                  `messageContentProcessor.exit #${seq} path=render-cache-noop chat=${ctx.chatId} msg=${ctx.messageId} idx=${messageIndex} total=${totalMs}ms`,
                );
                return;
              }
              log.trace(
                `messageContentProcessor.exit #${seq} path=render-cache-hit chat=${ctx.chatId} msg=${ctx.messageId} idx=${messageIndex} before_len=${ctx.content.length} after_len=${cached.content.length} total=${totalMs}ms`,
              );
              return { content: cached.content };
            }
            const inFlight = lookupInFlightRenderMcp(ctx.chatId, ctx.messageId, ctx.content);
            if (inFlight) {
              const shared = await inFlight;
              const totalMs = Date.now() - tStart;
              if (shared.kind === 'noop') {
                log.info(
                  `messageContentProcessor.exit #${seq} path=render-inflight-share-noop chat=${ctx.chatId} msg=${ctx.messageId} idx=${messageIndex} total=${totalMs}ms`,
                );
                return;
              }
              log.info(
                `messageContentProcessor.exit #${seq} path=render-inflight-share chat=${ctx.chatId} msg=${ctx.messageId} idx=${messageIndex} before_len=${ctx.content.length} after_len=${shared.content.length} total=${totalMs}ms`,
              );
              return { content: shared.content };
            }
          }

          let workResolve: (r: { kind: 'noop' } | { kind: 'transformed'; content: string }) => void = () => {};
          let workReject: (e: unknown) => void = () => {};
          const workPromise = new Promise<{ kind: 'noop' } | { kind: 'transformed'; content: string }>((res, rej) => {
            workResolve = res;
            workReject = rej;
          });
          workPromise.catch(() => { /* swallow — the work itself logs errors */ });
          if (ctx.messageId) {
            markRenderMcpInFlight(ctx.chatId, ctx.messageId, ctx.content, workPromise);
          }

          const editChain = triggers.map((t, i) => ({
            source: t,
            luaCode: luaScripts[i] ?? '',
          }));
          try {
            const editApi = makeSpindleHost({
              chatId: ctx.chatId,
              characterId: active.card.character_id,
              userId: ctx.userId,
            });
            const editScriptNS = makeDispatcherScriptNS();
            // Risu resolves CBS (risuChatParser rmVar+visualize) BEFORE the
            // editdisplay Lua hook runs, so the hook sees only the active
            // {{#risu_if}} branch, not the raw body. FE-resolved macros stay
            // PUA-protected so resolveDisplayMacros gets current persona.
            const puaResolve = async (text: string): Promise<string> => {
              if (text.indexOf('{{') < 0) return text;
              const enc = puaEncodeFeMacros(text);
              const resolved = await deps.resolveReadonly(
                enc.text, ctx.chatId, active.card.character_id, ctx.userId,
              );
              return puaDecodeFeMacros(resolved, enc.tokens);
            };
            let transformed = ctx.content;
            panelTrace('mcp.render.in', transformed);
            let preResolveMs = 0;
            {
              const tPre = Date.now();
              try {
                transformed = await puaResolve(transformed);
              } catch (err) {
                log.warn(
                  `messageContentProcessor.render pre-resolve threw: ${errMsg(err)}. Continuing with raw content.`,
                );
              }
              preResolveMs = Date.now() - tPre;
            }
            panelTrace('mcp.render.afterPreResolve', transformed);
            let chainMs = 0;
            if (hasLuaTrigger) {
              const tChain = Date.now();
              transformed = await runListenEditChain<string>(
                editChain,
                'editDisplay',
                transformed,
                { index: risuChatIdx },
                editApi,
                { characterId: active.card.character_id, content: ctx.content },
                editScriptNS,
                {
                  chatId: ctx.chatId,
                  characterId: active.card.character_id,
                  resolveTemplate: (text: string) => deps.resolveReadonly(text, ctx.chatId, active.card.character_id, ctx.userId, { cbsContext: true }),
                },
              );
              chainMs = Date.now() - tChain;
              log.trace(
                `messageContentProcessor.render chain.elapsed #${seq} chain=${chainMs}ms (mcp_total_so_far=${Date.now() - tStart}ms)`,
              );
            }
            panelTrace('mcp.render.afterLua', transformed);
            let atActionsMs = 0;
            if (renderAtActions.length > 0) {
              const tAt = Date.now();
              try {
                transformed = await runAtActionsForPhase(renderAtActions, 'editdisplay', transformed, {
                  api: editApi,
                  chatIndex: risuChatIdx,
                  role: 'assistant',
                });
              } catch (err) {
                log.warn(
                  `messageContentProcessor.render at-actions threw: ${errMsg(err)}. Continuing with prior content.`,
                );
              }
              atActionsMs = Date.now() - tAt;
            }
            panelTrace('mcp.render.afterAtActions', transformed);

            // Second resolve for any CBS the hook emitted, mirroring Risu's
            // processScriptFull parser pass after the editdisplay hook.
            let resolveMs = 0;
            if (transformed.indexOf('{{') >= 0) {
              const tResolve = Date.now();
              try {
                transformed = await puaResolve(transformed);
              } catch (err) {
                log.warn(
                  `messageContentProcessor.render body-resolve threw: ${errMsg(err)}. Returning pre-resolve content.`,
                );
              }
              resolveMs = Date.now() - tResolve;
            }
            panelTrace('mcp.render.afterBodyResolve', transformed);

            const totalMs = Date.now() - tStart;
            const otherOverhead = totalMs - preResolveMs - chainMs - atActionsMs - resolveMs - (tB - tA);
            if (perfEnabled()) {
              perfRecord("mcp.render.total", totalMs);
              perfRecord("mcp.render.preResolve", preResolveMs);
              if (hasLuaTrigger) perfRecord("mcp.render.luaChain", chainMs);
              if (renderAtActions.length > 0) perfRecord("mcp.render.atActions", atActionsMs);
              perfRecord("mcp.render.bodyResolve", resolveMs);
              perfRecord("mcp.render.ensureCard", tB - tA);
            }
            if (transformed === ctx.content) {
              if (ctx.messageId) {
                cacheRenderMcp(ctx.chatId, ctx.messageId, ctx.content, { kind: 'noop' });
              }
              workResolve({ kind: 'noop' });
              log.trace(
                `messageContentProcessor.exit #${seq} path=render-noop chat=${ctx.chatId} msg=${ctx.messageId ?? '<?>'} idx=${messageIndex} total=${totalMs}ms (pre=${preResolveMs}ms chain=${chainMs}ms at_actions=${atActionsMs}ms resolve=${resolveMs}ms ensure=${tB - tA}ms other=${otherOverhead}ms)`,
              );
              return;
            }
            if (ctx.messageId) {
              cacheRenderMcp(ctx.chatId, ctx.messageId, ctx.content, { kind: 'transformed', content: transformed });
            }
            workResolve({ kind: 'transformed', content: transformed });
            log.trace(
              `messageContentProcessor.exit #${seq} path=render-transformed chat=${ctx.chatId} msg=${ctx.messageId ?? '<?>'} idx=${messageIndex} before_len=${ctx.content.length} after_len=${transformed.length} total=${totalMs}ms (pre=${preResolveMs}ms chain=${chainMs}ms at_actions=${atActionsMs}ms resolve=${resolveMs}ms ensure=${tB - tA}ms other=${otherOverhead}ms)`,
            );
            return { content: transformed };
          } catch (err) {
            workReject(err);
            log.warn(
              `messageContentProcessor.exit #${seq} path=render-threw chat=${ctx.chatId} msg=${ctx.messageId ?? '<?>'} err=${errMsg(err)} total=${Date.now() - tStart}ms`,
            );
            return;
          }
        }

        // Write-time origins hold raw post-unbake (body macros resolve at the render origin), and we run editoutput @@-actions and the doc-boundary normalize so DOMPurify keeps leading style blocks.
        const isUserMessage = ctx.extra?.['is_user'] === true;
        const isGreeting = ctx.extra?.['greeting'] === true;
        const atActions = coerceAtActions(active.card.risuPayload.at_actions);
        let working = ctx.content;
        if (atActions.length > 0 && !isUserMessage) {
          try {
            const atApi = makeSpindleHost({
              chatId: ctx.chatId,
              characterId: active.card.character_id,
              userId: ctx.userId,
            });
            working = await runAtActionsForPhase(atActions, 'editoutput', working, {
              api: atApi,
              chatIndex: isGreeting ? -1 : 0,
              role: 'assistant',
            });
          } catch (err) {
            log.warn(
              `messageContentProcessor: at-actions editoutput threw: ${errMsg(err)}. ` +
                `Continuing with pre-action content.`,
            );
          }
        }

        const finalContent = normalizeReplaceStringForSanitizer(working);

        if (finalContent === ctx.content) {
          log.trace(
            `messageContentProcessor.exit #${seq} path=noop chat=${ctx.chatId} origin=${ctx.origin} msg=${ctx.messageId ?? '<new>'} ensure=${tB - tA}ms total=${Date.now() - tStart}ms`,
          );
          return;
        }
        if (ctx.messageId) rememberOurWrite(ctx.chatId, ctx.messageId, finalContent);
        log.trace(
          `messageContentProcessor.exit #${seq} path=transformed chat=${ctx.chatId} origin=${ctx.origin} msg=${ctx.messageId ?? '<new>'} raw_len=${ctx.content.length} final_len=${finalContent.length} doc_normalized=${finalContent !== working} ensure=${tB - tA}ms total=${Date.now() - tStart}ms`,
        );
        return { content: finalContent };
      } finally {
        mcpInFlight--;
      }
    }), 100);
    log.info('messageContentProcessor: registered');
  }

  function registerInterceptorIfAvailable(): void {
    const registerInterceptor = getRegisterInterceptor();
    if (typeof registerInterceptor !== 'function') {
      log.info('interceptor: not available on this Lumi build, listenEdit editInput/editRequest will not fire');
      return;
    }

    registerInterceptor(async (messages, contextRaw) => {
      const ctx = (contextRaw ?? {}) as InterceptorContext;
      const chatId = typeof ctx.chatId === 'string' ? ctx.chatId : null;
      if (!chatId) return messages;
      // Lumi's interceptor ctx omits userId, so attribute via the chat-to-owner stamp from activeCardByChat (populated at chat-open).
      let activeCandidate: ActiveCard | null | undefined = activeCardByChat.get(chatId);
      let userId: string | undefined = activeCandidate?.ownerUserId;
      if (!activeCandidate) {
        // Cold-cache fallback: Lumi fires this only for the user's active chat, so lastActiveChatByUser holds the mapping.
        for (const [uid, lastChat] of lastActiveChatByUser) {
          if (lastChat === chatId) { userId = uid; break; }
        }
        if (!userId) {
          if (deps.isPromptRegexAuthoritative(chatId)) {
            log.error(
              `interceptor: chat=${chatId} is prompt-regex owned (host skipped its pass) but userId is unattributable — shipping an UN-REGEX'd prompt.`,
            );
          }
          return messages;
        }
        activeCandidate = await deps.ensureActiveCardForChat(chatId, null, userId);
        if (!activeCandidate) {
          if (deps.isPromptRegexAuthoritative(chatId)) {
            log.error(
              `interceptor: chat=${chatId} is prompt-regex owned (host skipped its pass) but no active card resolved — shipping an UN-REGEX'd prompt.`,
            );
          }
          return messages;
        }
      }
      const active: ActiveCard = activeCandidate;
      const resolvedUserId = userId!;

      return userIdAls.run(resolvedUserId, async () => {
        let out: LlmMessage[] = messages;

        if (deps.isPromptRegexAuthoritative(chatId) && userId !== undefined) {
          try {
            const scripts = await listLivePromptRegexScripts(active.card.character_id, chatId, userId);
            if (scripts.length > 0) {
              const prebuilt = await buildBackendPipelineInput(
                chatId,
                active.card.character_id,
                userId,
                {
                  activeCardByChat,
                  getCachedSettingsSync: deps.getCachedSettingsSync,
                  modulesByNamespaceFromCard: deps.modulesByNamespaceFromCard,
                  log,
                  errMsg,
                },
                typeof ctx.personaId === 'string' ? ctx.personaId : undefined,
              );
              const target = out === messages ? out.slice() : out;
              const result = await deps.dispatchPromptRegex(prebuilt, scripts, target, userId);
              if (result.ok && result.changed) {
                log.info(
                  `interceptor.promptRegex: chat=${chatId} applied scripts=${scripts.length} messages=${result.messages.length} (via runner)`,
                );
                out = result.messages;
              }
            }
          } catch (err) {
            log.error(
              `interceptor.promptRegex threw for prompt-regex-owned chat=${chatId} (host skipped its pass): ` +
                `${errMsg(err)}. Shipping an UN-REGEX'd prompt.`,
            );
          }
        }

        // Tier 3 inject_at: apply staged plans to system messages by content match. Mirrors Risu's positionParser append/prepend/replace operations on the slot's text.
        const buffers = readDecoratorBuffers(chatId);
        if (buffers && buffers.injectAt.length > 0) {
          const character = await spindle.characters
            .get(active.card.character_id, userId)
            .catch(() => null);
          const persona = await spindle.personas.getActive(userId).catch(() => null);
          const authorsNote = (() => {
            const meta = active.card.risuPayload.extra as
              | { authors_note?: { content?: unknown } }
              | undefined;
            const c = meta?.authors_note?.content;
            return typeof c === 'string' ? c : '';
          })();
          // Slot to identifier-text map for system messages. Anchors are imperfect since Lumi merges multiple sources into one block.
          const slotText: Record<string, string> = {};
          const charDesc = (character as { description?: unknown } | null)?.description;
          if (typeof charDesc === 'string' && charDesc.length > 0) slotText['description'] = charDesc;
          const charPersona = (character as { persona?: unknown } | null)?.persona;
          if (typeof charPersona === 'string' && charPersona.length > 0) slotText['persona'] = charPersona;
          const charScenario = (character as { scenario?: unknown } | null)?.scenario;
          if (typeof charScenario === 'string' && charScenario.length > 0) slotText['scenario'] = charScenario;
          const charSysPrompt = (character as { system_prompt?: unknown } | null)?.system_prompt;
          if (typeof charSysPrompt === 'string' && charSysPrompt.length > 0) slotText['main'] = charSysPrompt;
          const charPostHist = (character as { post_history_instructions?: unknown } | null)?.post_history_instructions;
          if (typeof charPostHist === 'string' && charPostHist.length > 0) {
            slotText['globalNote'] = charPostHist;
            // Risu's jailbreak and cot cards both consume globalNote-like content.
            slotText['jailbreak'] = charPostHist;
            slotText['cot'] = charPostHist;
          }
          const personaDesc = (persona as { description?: unknown } | null)?.description;
          if (typeof personaDesc === 'string' && personaDesc.length > 0 && !slotText['persona']) {
            slotText['persona'] = personaDesc;
          }
          if (authorsNote.length > 0) slotText['authornote'] = authorsNote;

          const { applyInjectAtToMessages } = await import(
            '../payload/lorebook-decorator-runtime.js'
          );
          const applyResult = applyInjectAtToMessages(
            out,
            buffers.injectAt as readonly InjectAtPlan[],
            slotText,
          );
          out = applyResult.messages.slice();
          if (
            applyResult.mutationCount > 0 ||
            applyResult.synthesizedCount > 0 ||
            applyResult.fallbackAppendCount > 0
          ) {
            log.info(
              `[decorators] injectAt applied chat=${chatId} ` +
                `mutations=${applyResult.mutationCount}/${buffers.injectAt.length} ` +
                `synthesized=${applyResult.synthesizedCount} ` +
                `fallback_append=${applyResult.fallbackAppendCount}`,
            );
          }
          if (buffers.positionPt && Object.keys(buffers.positionPt).length > 0) {
            setDecoratorBuffers(chatId, { injectAt: [], positionPt: buffers.positionPt });
          } else {
            clearDecoratorBuffer(chatId);
          }
        }

        const triggers = active.card.risuPayload.triggers as ReadonlyArray<{
          effect?: ReadonlyArray<{ type?: string }>;
        }>;
        const luaScripts = active.card.risuPayload.lua_scripts;
        const hasLuaTrigger = triggers.some((t) => t.effect?.[0]?.type === 'triggerlua');
        if (!hasLuaTrigger) return out;

        const editApi = makeSpindleHost({
          chatId,
          characterId: active.card.character_id,
          userId,
        });
        const editScriptNS = makeDispatcherScriptNS();
        const editChain = triggers.map((t, i) => ({
          source: t,
          luaCode: luaScripts[i] ?? '',
        }));

        // editInput fires on actual user typing only, not regenerate or swipe or continue.
        if (ctx.generationType === 'normal') {
          let userIdx = -1;
          for (let i = out.length - 1; i >= 0; i--) {
            if (out[i]?.role === 'user') { userIdx = i; break; }
          }
          if (userIdx >= 0) {
            const orig = out[userIdx]!.content;
            try {
              const mutated = await runListenEditChain<string>(
                editChain,
                'editInput',
                orig,
                { index: userIdx - 1 }, // Risu chat index excludes greeting
                editApi,
                { characterId: active.card.character_id, content: orig },
                editScriptNS,
                {
                  chatId,
                  characterId: active.card.character_id,
                  resolveTemplate: (text: string) => deps.resolveReadonly(text, chatId, active.card.character_id, userId, { cbsContext: true }),
                },
              );
              if (mutated !== orig) {
                log.info(
                  `interceptor.editInput: chat=${chatId} userIdx=${userIdx} ` +
                    `before_len=${orig.length} after_len=${mutated.length}`,
                );
                out = out.slice();
                out[userIdx] = { ...out[userIdx]!, content: mutated };
              }
            } catch (err) {
              log.warn(`interceptor.editInput threw: ${errMsg(err)}. Continuing with original.`);
            }
          }
        }

        try {
          const mutated = await runListenEditChain<LlmMessage[]>(
            editChain,
            'editRequest',
            out,
            { generationType: ctx.generationType ?? 'normal' },
            editApi,
            { characterId: active.card.character_id, content: '' },
            editScriptNS,
            {
              chatId,
              characterId: active.card.character_id,
              resolveTemplate: (text: string) => deps.resolveReadonly(text, chatId, active.card.character_id, userId, { cbsContext: true }),
            },
          );
          if (Array.isArray(mutated)) {
            if (mutated.length !== out.length) {
              log.info(
                `interceptor.editRequest: chat=${chatId} array length changed ` +
                  `before=${out.length} after=${mutated.length}`,
              );
            }
            out = mutated;
          }
        } catch (err) {
          log.warn(`interceptor.editRequest threw: ${errMsg(err)}. Continuing with prior array.`);
        }

        return out;
      });
    }, 100);
    log.info('interceptor: registered (editInput + editRequest)');
  }

  function registerWorldInfoInterceptorIfAvailable(): void {
    const registerWorldInfoInterceptor = getRegisterWorldInfoInterceptor();
    if (!registerWorldInfoInterceptor) {
      log.info('worldInfoInterceptor: not available on this Lumi build, Tier 2 lorebook decorators will not gate');
      return;
    }
    log.info(`[decorators] registerWorldInfoInterceptor wired at boot`);
    registerWorldInfoInterceptor((ctx) => withMaybeUser(ctx.userId, async () => {
      log.info(
        `[decorators] worldInfoInterceptor ENTER chat=${ctx.chatId} entries=${ctx.entries.length}`,
      );
      const verbose = (() => {
        try {
          const env = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env;
          return env?.RISU_COMPAT_VERBOSE === '1';
        } catch { return false; }
      })();
      const { runWorldInfoInterceptor } = await import('../payload/lorebook-decorator-runtime.js');
      const verboseFn = verbose ? (m: string) => log.info(`[decorators] ${m}`) : undefined;
      // Risu's shipped loreDepth default. Lumi exposes neither per-entry scan_depth nor the chat-level default in the interceptor view.
      const RISU_DEFAULT_LORE_DEPTH = 4;
      // Pre-pass diagnostics: count entries that look like decorator carriers so we always emit a single line when any are present.
      let stashedDecCount = 0;
      let inlineDecCount = 0;
      for (const e of ctx.entries) {
        const stash = e.extensions?.['_risu_decorators'];
        if (Array.isArray(stash) && stash.length > 0) {
          stashedDecCount += 1;
        } else if (typeof e.content === 'string' && e.content.startsWith('@@')) {
          inlineDecCount += 1;
        }
      }
      const outcome = runWorldInfoInterceptor(
        {
          entries: ctx.entries.map((e) => ({
            id: e.id,
            disabled: e.disabled,
            comment: typeof e.comment === 'string' ? e.comment : '',
            key: Array.isArray(e.key) ? e.key : [],
            keysecondary: Array.isArray(e.keysecondary) ? e.keysecondary : [],
            content: typeof e.content === 'string' ? e.content : '',
            priority: typeof e.priority === 'number' ? e.priority : 0,
            extensions: e.extensions,
          })),
          messages: ctx.messages.map((m) => ({
            role: m.role,
            content: m.content,
            is_user: m.is_user,
            is_greeting: m.is_greeting,
            ...(m.greeting_index !== undefined ? { greeting_index: m.greeting_index } : {}),
          })),
          chatTurn: ctx.chatTurn,
          chatMetadata: ctx.chatMetadata,
          defaultScanDepth: RISU_DEFAULT_LORE_DEPTH,
        },
        verboseFn,
      );
      if (stashedDecCount + inlineDecCount > 0 || outcome.positionPt.length > 0 || outcome.injectAt.length > 0) {
        const ptNames = outcome.positionPt.map((p) => `${p.name}(${p.content.length})`).join(',');
        const injAtLocs = outcome.injectAt.map((p) => `${p.loc}/${p.operation}`).join(',');
        // Load-bearing pipeline-state line for triaging "decorator silently not firing" without forcing the user to flip their toggle.
        log.info(
          `[decorators] worldInfoInterceptor chat=${ctx.chatId} ` +
            `entries_in=${ctx.entries.length} ` +
            `dec_carriers=stashed:${stashedDecCount}+inline:${inlineDecCount} ` +
            `outcome: disabled=${outcome.disabled.length} forced=${outcome.forced.length} ` +
            `mutated=${outcome.mutated.length} stickyWrites=${outcome.stickyWrites.length} ` +
            `positionPt=[${ptNames}] injectAt=[${injAtLocs}]`,
        );
      }

      // Persist sticky var writes via a single chats.update RMW. expectChatChange suppresses the resulting CHAT_CHANGED echo.
      if (outcome.stickyWrites.length > 0 && ctx.userId) {
        try {
          const chat = await spindle.chats.get(ctx.chatId, ctx.userId);
          const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
          const mv = (meta['macro_variables'] && typeof meta['macro_variables'] === 'object'
            ? { ...(meta['macro_variables'] as Record<string, unknown>) }
            : {}) as Record<string, unknown>;
          const local = (mv['local'] && typeof mv['local'] === 'object'
            ? { ...(mv['local'] as Record<string, unknown>) }
            : {}) as Record<string, unknown>;
          let changed = 0;
          for (const w of outcome.stickyWrites) {
            if (local[w.varName] === w.value) continue;
            local[w.varName] = w.value;
            changed += 1;
          }
          if (changed > 0) {
            mv['local'] = local;
            expectChatChange(ctx.chatId);
            await spindle.chats.update(
              ctx.chatId,
              { metadata: { ...meta, macro_variables: mv } as never },
              ctx.userId,
            );
            invalidateRecentFlush(ctx.chatId);
            log.info(
              `[decorators] sticky_writes chat=${ctx.chatId} count=${changed}/${outcome.stickyWrites.length} ` +
                `keys=[${outcome.stickyWrites.slice(0, 3).map((w) => w.varName).join(',')}${outcome.stickyWrites.length > 3 ? ',…' : ''}]`,
            );
          }
        } catch (err) {
          log.warn(`[decorators] sticky_writes failed chat=${ctx.chatId}: ${errMsg(err)}`);
        }
      }

      // Stash Tier 3 cross-hook data for registerInterceptor (injectAt) and the position macro (positionPt). Each generation overwrites with a 60s TTL safety net.
      if (outcome.injectAt.length > 0 || outcome.positionPt.length > 0) {
        const positionPt: Record<string, string> = {};
        for (const p of outcome.positionPt) positionPt[p.name] = p.content;
        setDecoratorBuffers(ctx.chatId, {
          injectAt: outcome.injectAt,
          positionPt,
        });
        log.info(
          `[decorators] tier3_buffer chat=${ctx.chatId} ` +
            `injectAt=${outcome.injectAt.length} ` +
            `positionPt=${outcome.positionPt.length}`,
        );
      } else {
        // No Tier 3 plans this turn. Drop stale buffer so post-assembly doesn't apply ghosts.
        clearDecoratorBuffer(ctx.chatId);
      }

      if (outcome.disabled.length > 0 || outcome.forced.length > 0 || outcome.mutated.length > 0) {
        const reasons = Object.entries(outcome.reasons)
          .map(([n, c]) => `${n}:${c}`)
          .join(',');
        log.info(
          `[decorators] chat=${ctx.chatId} entries=${ctx.entries.length} ` +
            `disabled=${outcome.disabled.length} forced=${outcome.forced.length} ` +
            `mutated=${outcome.mutated.length} sticky_writes=${outcome.stickyWrites.length} ` +
            `reasons=[${reasons}]`,
        );
      }
      if (
        outcome.disabled.length === 0 &&
        outcome.forced.length === 0 &&
        outcome.mutated.length === 0
      ) return;
      const result: {
        disabled?: readonly string[];
        forced?: readonly string[];
        mutated?: readonly { id: string; content: string }[];
      } = {};
      if (outcome.disabled.length > 0) result.disabled = outcome.disabled;
      if (outcome.forced.length > 0) result.forced = outcome.forced;
      if (outcome.mutated.length > 0) {
        result.mutated = outcome.mutated.map((m) => ({ id: m.entryId, content: m.content }));
      }
      return result;
    }), 100);
    log.info('worldInfoInterceptor: registered');
  }

  return {
    registerAll(): void {
      registerMacroInterceptorIfAvailable();
      registerMessageContentProcessorIfAvailable();
      registerInterceptorIfAvailable();
      registerWorldInfoInterceptorIfAvailable();
    },
  };
}
