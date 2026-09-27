import type { FrontendLuaOperation } from './protocol.js';
import { FrontendLuaExecutionError, FrontendLuaUnavailableError } from './protocol.js';
import { mergeLlmText, projectLlmText } from '../util/llm-message-content.js';
import type { DispatchData, HostApi, TriggerRuntimeOpts } from '../interpreter/host.js';
import { dispatchBinding, dispatchByManualName, makeDispatcherScriptNS, registerManualTriggers, type CompiledTriggerEntry } from '../interpreter/dispatcher.js';
import { executeWasmoon } from '../interpreter/lua-wasmoon.js';
import { makeRisuTriggerRuntime } from '../interpreter/runtime.js';
import { runListenEditChain, type ListenEditMode } from '../interpreter/listen-edit.js';
import { runRequestTriggerChain } from '../interpreter/request-trigger-runner.js';
import type { DisplayLuaTrigger } from '../display/snapshot.js';
import { runAtActionsForPhase, isRowlessAtAction, type RuntimeAtAtAction } from '../interpreter/at-actions-runtime.js';

export function makeFrontendScriptNS() {
  return makeDispatcherScriptNS((code, globals, opts = {}) => executeWasmoon(code, globals, { ...opts, wasmoonKey: opts.mode ?? 'manual' }));
}

export interface FrontendLuaEnvironment {
  readonly api: HostApi;
  readonly data: DispatchData;
  prepareRuntime(): TriggerRuntimeOpts & { readonly chatId: string; readonly characterId: string };
  readonly compiled: readonly CompiledTriggerEntry[];
  readonly triggers: readonly DisplayLuaTrigger[];
  readonly atActions: readonly RuntimeAtAtAction[];
}

export async function runFrontendLuaOperation(operation: FrontendLuaOperation, env: FrontendLuaEnvironment, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const scriptNS = makeFrontendScriptNS();
  const options = () => ({ ...env.prepareRuntime(), luaSignal: signal });
  const dispatch = () => {
    // runTrigger owns its copied frame; runScripted button/edit hooks use live variables.
    const { luaVariables: _liveVariables, luaChat: _liveChat, ...frameOpts } = options();
    registerManualTriggers(scriptNS, env.compiled, env.api, frameOpts);
    return { compiledTriggers: env.compiled, api: env.api, data: env.data, scriptNS, opts: frameOpts };
  };
  const edit = <T>(mode: ListenEditMode, value: T, meta: Record<string, unknown> = {}) =>
    runListenEditChain(env.triggers, mode, value, meta, env.api, env.data, scriptNS, options());

  if (operation.kind === 'intercept') {
    let messages = operation.messages.slice();
    if (operation.generationType === 'normal') {
      let index = -1;
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') { index = i; break; }
      if (index >= 0) {
        const message = messages[index]!;
        const content = await edit('editInput', projectLlmText(message.content), { index: index - 1 });
        messages[index] = { ...message, content: mergeLlmText(message.content, content) };
      }
    }
    messages = await edit('editRequest', messages, { generationType: operation.generationType });
    try {
      return await runRequestTriggerChain(messages, {
        api: env.api, chatId: options().chatId, characterId: options().characterId,
        triggers: env.triggers.map(trigger => trigger.source), runtimeOpts: dispatch().opts, scriptNS,
      });
    } catch (error) {
      if (signal.aborted || error instanceof FrontendLuaExecutionError || error instanceof FrontendLuaUnavailableError) throw error;
      console.warn('Request trigger failed; preserving the previous request', error);
      return messages;
    }
  }

  if (operation.kind === 'edit') {
    if (!['editInput', 'editOutput', 'editDisplay', 'editRequest'].includes(operation.mode)) throw new Error(`Unknown Lua edit mode: ${operation.mode}`);
    return edit(operation.mode as ListenEditMode, operation.value, operation.meta);
  }
  if (operation.kind === 'request') {
    const { opts } = dispatch();
    return runRequestTriggerChain(operation.messages, {
      api: env.api, chatId: opts.chatId, characterId: opts.characterId, triggers: env.triggers.map(trigger => trigger.source),
      runtimeOpts: opts, scriptNS,
    });
  }
  if (operation.kind === 'binding') {
    if (operation.binding === 'output') {
      const messages = await env.api.chat.getMessages();
      const message = [...messages].reverse().find(value => value.role === 'assistant');
      if (message) {
        const index = Math.max(-1, messages.indexOf(message) - (messages[0]?.role !== 'user' ? 1 : 0));
        let content = await edit('editOutput', message.content, { index });
        for (const phase of ['editoutput', 'edittrans'] as const) content = await runAtActionsForPhase(
          env.atActions.filter(isRowlessAtAction), phase, content, { api: env.api, chatIndex: index, role: 'assistant' },
        );
        if (content !== message.content) await env.api.chat.editMessage(message.id, content);
      }
    }
    return dispatchBinding(dispatch(), operation.binding);
  }
  if (operation.kind === 'manual') {
    await dispatchByManualName(dispatch(), operation.name);
    return;
  }
  for (const trigger of env.triggers) {
    if (trigger.source.effect[0]?.type !== 'triggerlua') continue;
    const runtime = await makeRisuTriggerRuntime(env.api, env.data, scriptNS, {
      ...options(), binding: 'manual', lowLevelAccess: Boolean(trigger.source.lowLevelAccess),
    });
    try {
      await runtime.runLua(trigger.luaCode, { entry: 'onButtonClick', args: [undefined, operation.value] });
    } finally { await runtime.flush(); }
  }
}
