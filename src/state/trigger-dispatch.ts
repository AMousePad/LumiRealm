import type { ActiveCard } from '../interpreter/dispatch.js';
import type { RisuBinding, AuxDebugCaptureEvent } from '../interpreter/runtime.js';
import {
  prepareTriggers,
  dispatchBinding,
  dispatchByManualName,
  makeDispatcherScriptNS,
  registerManualTriggers,
  type CompiledTriggerEntry,
} from '../interpreter/dispatcher.js';
import { makeSpindleHost } from '../interpreter/spindle-host.js';
import { makeRisuTriggerRuntime, withDispatchContext } from '../interpreter/runtime.js';
import { runListenEditChain } from '../interpreter/listen-edit.js';
import {
  runAtActionsForPhase,
  coerceAtActions,
  isRowlessAtAction,
} from '../interpreter/at-actions-runtime.js';
import { buildDispatchSeams } from './dispatch-seams.js';
import { rememberOurWrite } from './recent-writes.js';
import { invalidateRenderMcpForChat } from './render-mcp-cache.js';
import { invalidateMacroInterceptorForChat } from './macro-interceptor-cache.js';
import type { RisuCompatSettings } from './settings-store.js';

export interface TriggerDispatcherDeps {
  readonly compiledByCharacter: Map<string, readonly CompiledTriggerEntry[]>;
  readonly getCachedSettingsSync: (userId: string | undefined) => RisuCompatSettings;
  readonly makeStateChangedCallback: (chatId: string, userId: string | undefined) => () => void;
  readonly makeAuxDebugCapture: (
    chatId: string | null,
    settings: RisuCompatSettings,
    userId: string | undefined,
  ) => ((event: AuxDebugCaptureEvent) => void) | undefined;
  readonly resolveReadonly: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean },
  ) => Promise<string>;
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string | undefined) => Promise<void>;
  readonly refreshVariables: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface TriggerDispatcher {
  readonly runBinding: (
    active: ActiveCard,
    chatId: string,
    binding: RisuBinding,
    userId: string | undefined,
  ) => Promise<{ stopSending: boolean }>;
  readonly dispatchManualTrigger: (
    chatId: string,
    triggerName: string,
    triggerId: string | undefined,
    userId: string | undefined,
  ) => Promise<void>;
  readonly dispatchButtonClick: (
    chatId: string,
    btn: string,
    btnId: string | undefined,
    userId: string | undefined,
  ) => Promise<void>;
}

interface LuaTrigger {
  effect: readonly { type: string; code?: string }[];
  type?: string;
  comment?: string;
  lowLevelAccess?: boolean;
}

export function createTriggerDispatcher(deps: TriggerDispatcherDeps): TriggerDispatcher {
  const {
    compiledByCharacter,
    getCachedSettingsSync,
    makeStateChangedCallback,
    makeAuxDebugCapture,
    resolveReadonly,
    ensureActiveCardForChat,
    refreshBgHtml,
    refreshVariables,
    toastFor,
    log,
    errMsg,
  } = deps;

  async function runBinding(
    active: ActiveCard,
    chatId: string,
    binding: RisuBinding,
    userId: string | undefined,
  ): Promise<{ stopSending: boolean }> {
    const characterId = active.card.character_id;
    const tBind = Date.now();
    let compiled = compiledByCharacter.get(characterId);
    if (!compiled) {
      try {
        const tCompile = Date.now();
        compiled = prepareTriggers(active.card.risuPayload, characterId);
        compiledByCharacter.set(characterId, compiled);
        log.info(`runBinding: compiled ${compiled.length} triggers for character=${characterId} in ${Date.now() - tCompile}ms`);
      } catch (err) {
        log.error(
          `compileTriggers failed for character=${characterId}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        return { stopSending: false };
      }
    }
    if (compiled.length === 0) {
      log.info(`runBinding: no triggers on character=${characterId}, skip binding=${binding}`);
      return { stopSending: false };
    }
    log.info(`runBinding: start binding=${binding} chatId=${chatId} characterId=${characterId} triggers=${compiled.length}`);
    const api = makeSpindleHost({ chatId, characterId, userId });
    const scriptNS = makeDispatcherScriptNS();
    registerManualTriggers(scriptNS, compiled, api);
    const settings = getCachedSettingsSync(userId);
    const seams = buildDispatchSeams({
      chatId,
      binding,
      settings,
      rememberOurWrite,
      stateChanged: makeStateChangedCallback(chatId, userId),
      auxDebugCapture: makeAuxDebugCapture(chatId, settings, userId),
      resolveTemplate: (text) => resolveReadonly(text, chatId, characterId, userId, { cbsContext: true }),
    });
    // Risu finalizes editOutput/list actions and stores the edited assistant
    // message before firing the structured output trigger. The trigger must
    // therefore read the post-edit chat state, not the raw model response.
    if (binding === 'output') {
      const triggers = active.card.risuPayload.triggers as ReadonlyArray<{
        effect?: ReadonlyArray<{ type?: string }>;
      }>;
      const luaScripts = active.card.risuPayload.lua_scripts;
      const hasLuaTrigger = triggers.some(
        (t) => t.effect?.[0]?.type === 'triggerlua',
      );
      const atActions = coerceAtActions(
        active.card.risuPayload.at_actions,
      ).filter(isRowlessAtAction);
      const hasOutputAtActions = atActions.some(
        (a) => a.phase === 'editoutput' || a.phase === 'edittrans',
      );
      if (hasLuaTrigger || hasOutputAtActions) {
        try {
          const messages = await api.chat.getMessages();
          const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (latestAssistant) {
            const idx = messages.indexOf(latestAssistant);
            const risuChatIdx = Math.max(-1, idx - 1);
            let mutated = latestAssistant.content;

            if (hasLuaTrigger) {
              const editChain = triggers.map((t, i) => ({
                source: t,
                luaCode: luaScripts[i] ?? '',
              }));
              try {
                mutated = await runListenEditChain(
                  editChain,
                  'editOutput',
                  mutated,
                  { index: risuChatIdx },
                  api,
                  { characterId, content: mutated },
                  scriptNS,
                  {
                    chatId,
                    characterId,
                    resolveTemplate: (text: string) => resolveReadonly(text, chatId, characterId, userId, { cbsContext: true }),
                  },
                );
              } catch (err) {
                log.warn(`runBinding: listenEdit editOutput chain threw: ${errMsg(err)}. Continuing.`);
              }
            }
            if (hasOutputAtActions) {
              try {
                for (const phase of ['editoutput', 'edittrans'] as const) {
                  mutated = await runAtActionsForPhase(atActions, phase, mutated, {
                    api,
                    chatIndex: risuChatIdx,
                    role: 'assistant',
                  });
                }
              } catch (err) {
                log.warn(`runBinding: at-actions output threw: ${errMsg(err)}. Continuing.`);
              }
            }

            if (mutated !== latestAssistant.content) {
              log.info(
                `runBinding: edit hooks mutated message content ` +
                  `chat=${chatId} msg=${latestAssistant.id} ` +
                  `before_len=${latestAssistant.content.length} after_len=${mutated.length}`,
              );
              rememberOurWrite(chatId, latestAssistant.id, mutated);
              await api.chat.editMessage(latestAssistant.id, mutated);
            }
          }
        } catch (err) {
          log.warn(`runBinding: edit-hooks output threw: ${errMsg(err)}. Continuing.`);
        }
      }
    }

    const outcome = await withDispatchContext(seams, async () =>
      dispatchBinding(
        {
          compiledTriggers: compiled!,
          api,
          data: { characterId },
          scriptNS,
          opts: { characterId, binding },
        },
        binding,
        (err, name) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`trigger "${name}" failed on ${binding}: ${msg}`);
        },
      ),
    );

    log.info(`runBinding: done binding=${binding} elapsed=${Date.now() - tBind}ms stopSending=${outcome.stopSending}`);
    return { stopSending: outcome.stopSending };
  }

  async function dispatchManualTrigger(
    chatId: string,
    triggerName: string,
    triggerId: string | undefined,
    userId: string | undefined,
  ): Promise<void> {
    const active = await ensureActiveCardForChat(chatId, null, userId);
    if (!active) {
      log.warn(`dispatchManualTrigger: no active card for chatId=${chatId},skip`);
      return;
    }
    const characterId = active.card.character_id;
    const triggers = (active.card.risuPayload.triggers ?? []) as unknown as readonly LuaTrigger[];
    const luaTriggers = triggers.filter(
      (t) => Array.isArray(t.effect) && t.effect[0] && t.effect[0].type === 'triggerlua',
    );
    // Risu dispatches buttons via two paths: triggerlua-by-name and non-Lua triggers with comment===manualName, both run.
    const commentMatchedTriggers = triggers.filter(
      (t) =>
        Array.isArray(t.effect) &&
        t.effect[0] &&
        t.effect[0].type !== 'triggerlua' &&
        t.effect[0].type !== 'triggercode' &&
        t.comment === triggerName,
    );
    if (luaTriggers.length === 0 && commentMatchedTriggers.length === 0) {
      log.warn(
        `dispatchManualTrigger: no matching triggers on character=${characterId} ` +
          `(no triggerlua and no comment="${triggerName}"),Risu would no-op here too`,
      );
      return;
    }
    log.info(
      `dispatchManualTrigger: name="${triggerName}" lua=${luaTriggers.length} ` +
        `commentMatched=${commentMatchedTriggers.length} chatId=${chatId}`,
    );
    const api = makeSpindleHost({ chatId, characterId, userId });
    const scriptNS = makeDispatcherScriptNS();
    const effectiveTriggerId = triggerId ?? String(Math.random()).slice(2, 10);
    const t0 = Date.now();
    for (const trigger of luaTriggers) {
      const firstEffect = trigger.effect[0];
      if (!firstEffect) continue;
      const luaCode = String(firstEffect.code ?? '');
      if (luaCode.length === 0) continue;
      try {
        const settings = getCachedSettingsSync(userId);
        const seams = buildDispatchSeams({
          chatId,
          binding: 'manual',
          settings,
          rememberOurWrite,
          stateChanged: makeStateChangedCallback(chatId, userId),
          auxDebugCapture: makeAuxDebugCapture(chatId, settings, userId),
          resolveTemplate: (text) => resolveReadonly(text, chatId, characterId, userId, { cbsContext: true }),
        });
        const runtime = await makeRisuTriggerRuntime(api, { characterId }, scriptNS, {
          ...seams,
          characterId,
          lowLevelAccess: Boolean(trigger.lowLevelAccess),
        });
        log.info(
          `dispatchManualTrigger: invoking Lua entry=${triggerName} args=[${effectiveTriggerId}] chatId=${chatId}`,
        );
        await runtime.runLua(luaCode, {
          entry: triggerName,
          args: [effectiveTriggerId],
        });
        await runtime.flush();
      } catch (err) {
        log.error(`dispatchManualTrigger: Lua failed triggerName=${triggerName}: ${errMsg(err)}`);
      }
    }

    if (commentMatchedTriggers.length > 0) {
      try {
        const compiled = prepareTriggers(active.card.risuPayload, characterId);
        registerManualTriggers(scriptNS, compiled, api);
        const settings = getCachedSettingsSync(userId);
        const seams = buildDispatchSeams({
          chatId,
          binding: 'manual',
          settings,
          rememberOurWrite,
          stateChanged: makeStateChangedCallback(chatId, userId),
          auxDebugCapture: makeAuxDebugCapture(chatId, settings, userId),
          resolveTemplate: (text) => resolveReadonly(text, chatId, characterId, userId, { cbsContext: true }),
        });
        await withDispatchContext(seams, async () => {
          const fired = await dispatchByManualName(
            {
              compiledTriggers: compiled,
              api,
              data: { characterId, manualName: triggerName },
              scriptNS,
              opts: { characterId, binding: 'manual', lowLevelAccess: commentMatchedTriggers.some((t) => Boolean(t.lowLevelAccess)) },
            },
            triggerName,
            (err, name) => {
              const msg = err instanceof Error ? err.message : String(err);
              log.error(`dispatchManualTrigger: comment-matched trigger "${name}" threw: ${msg}`);
              toastFor(userId, 'error', `lumirealm: ${name},${msg}`, { title: 'lumirealm trigger error' });
            },
          );
          log.info(`dispatchManualTrigger: comment-matched dispatch fired=${fired}/${commentMatchedTriggers.length}`);
        });
      } catch (err) {
        log.error(`dispatchManualTrigger: comment-matched dispatch threw: ${errMsg(err)}`);
      }
    }

    log.info(`dispatchManualTrigger: done triggerName=${triggerName} elapsed=${Date.now() - t0}ms`);
    invalidateRenderMcpForChat(chatId);
    invalidateMacroInterceptorForChat(chatId);
    await refreshBgHtml(active, chatId, userId);
    await refreshVariables(active, chatId, userId);
  }

  async function dispatchButtonClick(
    chatId: string,
    btn: string,
    btnId: string | undefined,
    userId: string | undefined,
  ): Promise<void> {
    const active = await ensureActiveCardForChat(chatId, null, userId);
    if (!active) {
      log.warn(`dispatchButtonClick: no active card for chatId=${chatId},skip`);
      return;
    }
    const characterId = active.card.character_id;
    const triggers = (active.card.risuPayload.triggers ?? []) as unknown as readonly LuaTrigger[];
    const luaTriggers = triggers.filter(
      (t) => Array.isArray(t.effect) && t.effect[0] && t.effect[0].type === 'triggerlua',
    );
    if (luaTriggers.length === 0) {
      log.warn(
        `dispatchButtonClick: no triggerlua on character=${characterId},Risu would no-op`,
      );
      return;
    }
    log.info(
      `dispatchButtonClick: btn="${btn}" btnId=${btnId ?? '<none>'} lua=${luaTriggers.length} chatId=${chatId}`,
    );
    const api = makeSpindleHost({ chatId, characterId, userId });
    const scriptNS = makeDispatcherScriptNS();
    const effectiveId = btnId ?? String(Math.random()).slice(2, 10);
    const t0 = Date.now();
    for (const trigger of luaTriggers) {
      const firstEffect = trigger.effect[0];
      if (!firstEffect) continue;
      const luaCode = String(firstEffect.code ?? '');
      if (luaCode.length === 0) continue;
      try {
        const settings = getCachedSettingsSync(userId);
        const seams = buildDispatchSeams({
          chatId,
          binding: 'manual',
          settings,
          rememberOurWrite,
          stateChanged: makeStateChangedCallback(chatId, userId),
          auxDebugCapture: makeAuxDebugCapture(chatId, settings, userId),
          resolveTemplate: (text) => resolveReadonly(text, chatId, characterId, userId, { cbsContext: true }),
        });
        const runtime = await makeRisuTriggerRuntime(api, { characterId }, scriptNS, {
          ...seams,
          characterId,
          lowLevelAccess: Boolean(trigger.lowLevelAccess),
        });
        log.info(
          `dispatchButtonClick: invoking onButtonClick args=[${effectiveId}, ${btn}] chatId=${chatId}`,
        );
        await runtime.runLua(luaCode, {
          entry: 'onButtonClick',
          args: [effectiveId, btn],
        });
        await runtime.flush();
      } catch (err) {
        log.error(`dispatchButtonClick: Lua failed btn="${btn}": ${errMsg(err)}`);
      }
    }
    log.info(`dispatchButtonClick: done btn="${btn}" elapsed=${Date.now() - t0}ms`);
    invalidateRenderMcpForChat(chatId);
    invalidateMacroInterceptorForChat(chatId);
    await refreshBgHtml(active, chatId, userId);
    await refreshVariables(active, chatId, userId);
  }

  return { runBinding, dispatchManualTrigger, dispatchButtonClick };
}
