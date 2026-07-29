// Risu parity: triggers.ts, scripts.ts, parser.svelte.ts, scriptings.ts.

import {
  type HostApi,
  type DispatchData,
  type ScriptNS,
  type TriggerRuntimeOpts,
  type HostMessage,
  RisuCompatUnsupportedError,
} from './host.js';
import { buildRisuChatView } from './risu-chat-view.js';
import { makeVarsApi } from './runtime/vars.js';
import { makeArraysDictsApi } from './runtime/arrays-dicts.js';
import { makeChatApi } from './runtime/chat.js';
import { makeCharacterNoteApi } from './runtime/character-note.js';
import { makeLorebookApi, type LorebookCache } from './runtime/lorebook.js';
import { makeDisplayStateApi } from './runtime/display-state.js';
import { runLLM as _runLLM, parseLuaPromptArg } from './runtime/llm.js';
import {
  extractRegex,
  regexTest,
  replaceString,
  random,
  setCharAt,
  calculate,
  splitString,
} from './runtime/strings-regex.js';
import { toStr } from '../util/coerce.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { samplersToWire } from '../util/samplers-wire.js';
import { normalizeReplaceStringForSanitizer } from '../util/sanitizer-doc-shape.js';
import { risuRoleToLumi, lumiRoleToRisu } from '../util/role-coerce.js';

const _logStateChanged    = makeSafeLogger('runtime.stateChanged');
const _logMake            = makeSafeLogger('runtime.makeRisuTriggerRuntime');
const _logTriggercode     = makeSafeLogger('runtime.triggercode');
const _logRunLua          = makeSafeLogger('runtime.runLua');
const _logSetChat         = makeSafeLogger('runtime.setChat');
const _logSetFullChat     = makeSafeLogger('runtime.setFullChat');
const _logAddChat         = makeSafeLogger('runtime.addChat');
const _logLLMMain         = makeSafeLogger('runtime.LLMMain');
const _logAxLLMMain       = makeSafeLogger('runtime.axLLMMain');
const _logFlush           = makeSafeLogger('runtime.flush');
const _logLuaPrint        = makeSafeLogger('runtime.lua');
const _logCbs             = makeSafeLogger('runtime.cbs');

type WasmoonExec = (
  code: string,
  globals: Record<string, unknown>,
  opts: { entry?: string; args?: readonly unknown[]; wasmoonKey: string },
) => Promise<unknown>;
let _wasmoonExec: WasmoonExec | null = null;
export function setWasmoonExecutor(fn: WasmoonExec): void { _wasmoonExec = fn; }
let _wasmoonEnabled = true;
export function setWasmoonEnabled(b: boolean): void { _wasmoonEnabled = b; }
export function isWasmoonEnabled(): boolean { return _wasmoonEnabled; }

// Per-process alert gate so a Lua loop calling cbs() doesn't stack modals.
let _cbsUnresolvedAlertFired = false;
function warnCbsUnresolvedOnce(api: HostApi): void {
  _logCbs.warn('cbs(): no resolver wired, returning input verbatim');
  if (_cbsUnresolvedAlertFired) return;
  _cbsUnresolvedAlertFired = true;
  try {
    api.ui?.alert?.(
      'A card script called cbs(template) but no resolver was wired. Output will contain raw {{...}} markers. Report this if you see it.',
      'error',
    );
  } catch { /* */ }
}

// Compiled triggers' rtOpts are JSON-frozen, so non-serialisable fields
// (Function, Set) ride the side-channel. Safe: dispatch is serial,
// workers are single-user-scoped.
import {
  type DispatchContext,
  type AuxDebugCaptureEvent,
  getDispatchContext,
} from './runtime/dispatch-context.js';
export {
  getDispatchContext,
  withDispatchContext,
} from './runtime/dispatch-context.js';
export type { AuxDebugCaptureEvent } from './runtime/dispatch-context.js';

import { loadGlobalVars, loadVars, saveVars } from './runtime/chat-state.js';
import { inheritedVarsAls, withInheritedVarsCache } from './runtime/als.js';

export { compareValues } from './runtime/compare.js';
export { applyMatchTemplate } from './runtime/match-template.js';
export { calcString } from './runtime/calc.js';
import { compareValues } from './runtime/compare.js';
import { unsupported } from './runtime/unsupported.js';


export type RisuBinding =
  | 'input'
  | 'request'
  | 'output'
  | 'display'
  | 'start'
  | 'manual';

export interface RisuTriggerRuntime {
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly characterId: string | null;
  stopSending: boolean;
  sendAIprompt: boolean;
  // resolution
  resolve(value: unknown, kind: 'var' | 'value' | 'regex' | string): string;
  setVar(name: string, value: unknown): void;
  getVar(name: string): string;
  declareLocalVar(name: string, value: unknown, indent: number): void;
  setvarV1(name: string, op: string, rawValue: unknown): void;
  setvarV2(name: string, op: string, value: unknown): void;
  compare(a: unknown, b: unknown, op: string): boolean;
  checkConditions(conditions: readonly unknown[]): boolean;
  // control flow
  loopTick(): number;
  sleep(ms: number): Promise<void>;
  // chat / messaging
  impersonate(role: 'user' | 'char' | string, value: unknown): Promise<void>;
  systemPrompt(location: 'start' | 'historyend' | 'promptend' | string, value: unknown): Promise<void>;
  command(value: unknown): Promise<never>;
  cutChat(start: unknown, end: unknown): Promise<void>;
  modifyChat(index: unknown, value: unknown): Promise<void>;
  updateGUI(): Promise<void>;
  updateChatAt(i: unknown): Promise<void>;
  tokenize(value: unknown): never;
  quickSearchChat(value: unknown, condition: string, depth: unknown): boolean;
  getLastMessage(): string;
  getMessageAtIndex(i: unknown): string;
  getMessageCount(): number;
  getLastUserMessage(): string;
  getLastCharMessage(): string;
  getFirstMessage(): string;
  // alert / llm / recursion
  showAlert(type: unknown, value: unknown, inputVar: string | null): Promise<void>;
  alertInput(display: unknown): Promise<string>;
  alertSelect(display: unknown, options: unknown): Promise<string>;
  runLLM(value: unknown, model: string, streaming?: boolean): Promise<string>;
  checkSimilarity(value: unknown, source: unknown): Promise<never>;
  runImgGen(value: unknown, neg: unknown): Promise<never>;
  runTrigger(name: unknown): Promise<void>;
  runCode(code: unknown): Promise<void>;
  runLua(code: unknown, luaOpts?: Record<string, unknown>): Promise<unknown>;
  // string / regex / random
  extractRegex(value: unknown, regex: unknown, flags: unknown, result: unknown): string;
  regexTest(value: unknown, regex: unknown, flags: unknown): boolean;
  replaceString(source: unknown, regex: unknown, result: unknown, replacement: unknown, flags: unknown): string;
  random(min: unknown, max: unknown): number;
  setCharAt(source: unknown, index: unknown, value: unknown): string;
  splitString(source: unknown, delimiter: unknown, kind?: string): readonly string[];
  calculate(expr: unknown): string;
  // arrays
  makeArrayVar(name: string): void;
  arrayLength(name: string): number;
  arrayGet(name: string, i: unknown): string;
  arraySet(name: string, i: unknown, v: unknown): void;
  arrayPush(name: string, v: unknown): void;
  arrayPop(name: string): string;
  arrayShift(name: string): string;
  arrayUnshift(name: string, v: unknown): void;
  arraySplice(name: string, start: unknown, item: unknown): void;
  arraySlice(name: string, start: unknown, end: unknown): string;
  arrayJoin(name: string, delim: unknown): string;
  arrayIndexOf(name: string, v: unknown): number;
  arrayRemoveIndex(name: string, i: unknown): void;
  // dicts
  makeDictVar(name: string): void;
  dictGet(name: string, k: unknown): string;
  dictSet(name: string, k: unknown, v: unknown): void;
  dictDelete(name: string, k: unknown): void;
  dictHasKey(name: string, k: unknown): boolean;
  dictClear(name: string): void;
  dictSize(name: string): number;
  dictKeys(name: string): string[];
  dictValues(name: string): unknown[];
  // character / persona / note
  getCharacterDesc(): Promise<string>;
  setCharacterDesc(value: unknown): Promise<void>;
  getPersonaDesc(): Promise<string>;
  setPersonaDesc(value: unknown): Promise<void>;
  getReplaceGlobalNote(): Promise<string>;
  setReplaceGlobalNote(value: unknown): Promise<void>;
  getAuthorNote(): Promise<string>;
  setAuthorNote(value: unknown): Promise<void>;
  // lorebook
  modifyLorebook(target: unknown, value: unknown): Promise<void>;
  getLorebookByKey(target: unknown): string;
  getLorebookCount(): number;
  getLorebookEntry(index: unknown): string;
  setLorebookActivation(index: unknown, value: boolean): Promise<void>;
  getLorebookIndexViaName(name: unknown): number;
  getAllLorebooks(): string[];
  getLorebookByName(name: unknown): number[];
  getLorebookByIndex(index: unknown): string;
  createLorebook(name: unknown, key: unknown, content: unknown, order: unknown): Promise<void>;
  modifyLorebookByIndex(index: unknown, name: unknown, key: unknown, content: unknown, order: unknown): Promise<void>;
  deleteLorebookByIndex(index: unknown): Promise<void>;
  setLorebookAlwaysActive(index: unknown, value: boolean): Promise<void>;
  // display / request
  getDisplayState(): string;
  setDisplayState(v: unknown): void;
  getRequestState(i: unknown): string;
  setRequestState(i: unknown, v: unknown): void;
  getRequestStateRole(i: unknown): string;
  setRequestStateRole(i: unknown, v: unknown): void;
  getRequestStateLength(): number;
  getRequestStateMessages(): readonly {
    readonly role: string;
    readonly content: string;
  }[];
  // lifecycle
  flush(): Promise<void>;
  warnDroppedTriggerCode(label?: string): void;
}

export type { RisuRegexRuntime } from './runtime/regex-runtime.js';

export async function makeRisuTriggerRuntime(
  api: HostApi,
  data: DispatchData,
  scriptNs: ScriptNS,
  opts: TriggerRuntimeOpts = {},
): Promise<RisuTriggerRuntime> {
  const displayMode = !!opts.displayMode;
  const lowLevelAccess = !!opts.lowLevelAccess;
  const characterId = opts.characterId || null;

  // Side-channel wins for `binding` so the dispatcher can run a start-declared
  // Lua trigger on output mode (Risu type-bypass; see DispatchContext.binding).
  const dispatchCtx: DispatchContext = getDispatchContext() ?? {};
  const binding = toStr(dispatchCtx.binding ?? opts.binding ?? '');
  const portalChatId: string | undefined = opts.chatId ?? dispatchCtx.chatId;
  const rememberOurWrite: ((chatId: string, msgId: string, content: string) => void) | undefined =
    opts.rememberOurWrite ?? dispatchCtx.rememberOurWrite;
  const stateChanged: (() => void) | undefined =
    opts.stateChanged ?? dispatchCtx.stateChanged;
  const auxConnectionId: string | null =
    (opts.auxConnectionId ?? dispatchCtx.auxConnectionId ?? null);
  const auxModelOverride: string | null =
    (opts.auxModelOverride ?? dispatchCtx.auxModelOverride ?? null);
  const auxSamplers = opts.auxSamplers ?? dispatchCtx.auxSamplers ?? null;
  // Submodel falls back to aux config when unset (single-connection users keep prior behaviour).
  const submodelConnectionId: string | null =
    (opts.submodelConnectionId ?? dispatchCtx.submodelConnectionId ?? auxConnectionId);
  const submodelModelOverride: string | null =
    (opts.submodelModelOverride ?? dispatchCtx.submodelModelOverride ?? auxModelOverride);
  const submodelSamplers = opts.submodelSamplers ?? dispatchCtx.submodelSamplers ?? auxSamplers;
  const auxDebugCapture: ((event: AuxDebugCaptureEvent) => void) | undefined =
    opts.auxDebugCapture ?? dispatchCtx.auxDebugCapture;
  // Bind at factory time so cbs() invoked from Lua resolves against the
  // user this runtime was built for, not whoever last set the global.
  const capturedResolveTemplate: ((text: string) => Promise<string>) | undefined =
    opts.resolveTemplate ?? dispatchCtx.resolveTemplate;
  const auxParamsWire = samplersToWire(auxSamplers);
  const submodelParamsWire = samplersToWire(submodelSamplers);
  const auxPrefillCompat: boolean =
    Boolean(opts.auxPrefillCompat ?? dispatchCtx.auxPrefillCompat ?? false);
  const submodelPrefillCompat: boolean =
    Boolean(opts.submodelPrefillCompat ?? dispatchCtx.submodelPrefillCompat ?? auxPrefillCompat);
  function notifyStateChanged(source: string): void {
    if (!stateChanged) {
      _logStateChanged.info(`source=${source} → <no-callback> (no-op)`);
      return;
    }
    _logStateChanged.info(`source=${source} → calling backend`);
    try { stateChanged(); }
    catch (err) {
      _logStateChanged.warn(`callback threw: ${(err as Error).message}`);
    }
  }
  {
    const bindingSrc = dispatchCtx.binding !== undefined
      ? 'side-channel'
      : (opts.binding !== undefined ? 'opts' : '<none>');
    _logMake.info(
      `chatId=${portalChatId ?? '<none>'} ` +
        `rememberOurWrite=${rememberOurWrite ? 'wired' : '<none>'} ` +
        `stateChanged=${stateChanged ? 'wired' : '<none>'} ` +
        `auxConn=${auxConnectionId ?? '<default>'} auxModel=${auxModelOverride ?? '<connection>'} ` +
        `auxParams=${auxParamsWire ? Object.keys(auxParamsWire).join(',') : '<preset>'} ` +
        `submodelConn=${submodelConnectionId ?? '<inherit-aux>'} ` +
        `submodelModel=${submodelModelOverride ?? '<connection>'} ` +
        `submodelParams=${submodelParamsWire ? Object.keys(submodelParamsWire).join(',') : '<preset>'} ` +
        `binding=${binding}(src=${bindingSrc}) characterId=${characterId ?? '<none>'}`,
    );
  }

  // Nested runTrigger reuses parent varsCache; only outermost runtime flushes.
  // Per-await timing: every step here is an IPC round-trip in Spindle; the
  // editDisplay listenEdit chain creates a fresh runtime per trigger (16x for
  // Mortal Realm), so the factory cost dominates the wall-clock budget.
  //
  // PRELOAD FAST-PATH: when caller passes `opts.preloaded`, we skip the
  // matching IPC fetch and reuse the provided snapshot. Used by
  // `runListenEditChain` to share one snapshot across all triggers in the
  // same chain, dropping repeated Spindle worker IPC channel pressure that
  // caused 4.5s stalls per stuck call.
  const preloaded = opts.preloaded;
  const _factoryStart = Date.now();
  const globalVarsPromise = preloaded?.globalVars
    ? Promise.resolve({ ...preloaded.globalVars })
    : loadGlobalVars(api);
  let varsCache: Record<string, string>;
  let isInheritedVarsCache = false;
  let _tVars = 0;
  let _varsSrc: 'inherited' | 'preloaded' | 'fetched' = 'fetched';
  const inheritedFrame = inheritedVarsAls.getStore();
  if (inheritedFrame) {
    varsCache = inheritedFrame;
    isInheritedVarsCache = true;
    _varsSrc = 'inherited';
  } else if (preloaded?.varsCache) {
    // Shallow-clone so per-trigger writes don't corrupt the shared snapshot.
    // Risu's listenEdit chain runs each trigger in fresh Lua state , varsCache
    // mutations from one trigger should not leak into the next via the
    // shared preload (they'd leak via flush() at chain end if needed).
    varsCache = { ...preloaded.varsCache };
    _varsSrc = 'preloaded';
  } else {
    const _t0 = Date.now();
    varsCache = await loadVars(api);
    _tVars = Date.now() - _t0;
  }
  const globalVarsCache = await globalVarsPromise;
  let messagesCache: HostMessage[] = [];
  // Risu's `char.firstMessage` (greeting), excluded from messagesCache to
  // match `chat.message[]`. getFirstMessage / getCharacterLastMessage use it.
  let firstMessage: string | undefined;
  let _msgsCount = 0;
  let _msgsSrc: 'preloaded' | 'fetched' = 'fetched';
  const _tMsgsStart = Date.now();
  try {
    if (preloaded?.messagesRaw) {
      _msgsSrc = 'preloaded';
      _msgsCount = preloaded.messagesRaw.length;
      const view = buildRisuChatView({ messages: preloaded.messagesRaw.map((m) => ({ ...m })) });
      messagesCache = view.messages;
      firstMessage = view.greeting;
      if (view.adjustments.length > 0) {
        _logMake.info(`chat-view from-len=${_msgsCount} to-len=${messagesCache.length} adjustments=[${view.adjustments.join(', ')}] src=preloaded`);
      }
    } else {
      const msgs = await api.chat.getMessages();
      _msgsCount = msgs.length;
      const view = buildRisuChatView({ messages: msgs.map((m) => ({ ...m })) });
      messagesCache = view.messages;
      firstMessage = view.greeting;
      if (view.adjustments.length > 0) {
        _logMake.info(`chat-view from-len=${msgs.length} to-len=${messagesCache.length} adjustments=[${view.adjustments.join(', ')}]`);
      }
    }
  } catch { messagesCache = []; }
  const _tMsgs = _msgsSrc === 'preloaded' ? 0 : Date.now() - _tMsgsStart;

  const lorebook: LorebookCache = { entries: [], primaryBookId: null };
  let _tCharGet = 0;
  let _tLore = 0;
  let _bookCount = 0;
  let _entryCount = 0;
  let _loreSrc: 'preloaded' | 'fetched' = 'fetched';
  if (preloaded?.lorebook) {
    _loreSrc = 'preloaded';
    // Reuse the entries array by reference , entries are read-only in the
    // listenEdit case (editDisplay can't write lorebook). The primaryBookId
    // carries through for `getLorebookCount`/etc.
    lorebook.entries = preloaded.lorebook.entries;
    lorebook.primaryBookId = preloaded.lorebook.primaryBookId;
    _entryCount = lorebook.entries.length;
    _bookCount = lorebook.primaryBookId ? 1 : 0;
  } else {
    try {
      const cid = characterId || (data && (data as { characterId?: string }).characterId);
      if (cid && api.characters && typeof api.characters.get === 'function') {
        const _tCharStart = Date.now();
        const char = await api.characters.get(cid);
        _tCharGet = Date.now() - _tCharStart;
        const bookIds = char && Array.isArray(char.worldBookIds) ? char.worldBookIds : [];
        _bookCount = bookIds.length;
        if (bookIds.length > 0 && api.worldInfo && api.worldInfo.entries) {
          lorebook.primaryBookId = bookIds[0] ?? null;
          const _tLoreStart = Date.now();
          for (const bid of bookIds) {
            try {
              const res = await api.worldInfo.entries.list(bid, { limit: 1000 });
              if (res && Array.isArray(res.data)) {
                _entryCount += res.data.length;
                for (const e of res.data) lorebook.entries.push({ ...e, worldBookId: e.worldBookId || bid });
              }
            } catch { /* skip */ }
          }
          lorebook.entries.sort((a, b) => Number(b.orderValue || 0) - Number(a.orderValue || 0));
          _tLore = Date.now() - _tLoreStart;
        }
      }
    } catch { /* world_books permission not granted */ }
  }

  const _factoryTotal = Date.now() - _factoryStart;
  // Always emit so we capture per-trigger factory cost in editDisplay chains.
  // The chain creates a fresh runtime per trigger; with 16 triggers and an
  // IPC cost per await, even "fast" individual factories add up to seconds.
  // src= field tells you which preload path actually fired (preloaded vs.
  // fetched vs. inherited from a parent runTrigger).
  _logMake.info(
    `factory.timing total=${_factoryTotal}ms vars=${_tVars}ms (src=${_varsSrc}) ` +
      `msgs=${_tMsgs}ms (n=${_msgsCount} src=${_msgsSrc}) chars.get=${_tCharGet}ms ` +
      `lore=${_tLore}ms (books=${_bookCount} entries=${_entryCount} src=${_loreSrc}) ` +
      `inherited=${isInheritedVarsCache} chatId=${portalChatId ?? '<none>'} ` +
      `binding=${binding} characterId=${characterId ?? '<none>'}`,
  );

  // Lumi stores chat messages as individual rows, while Risu mutates one
  // in-memory array and commits its final state. Serialize every row mutation
  // and track IDs assigned to new rows so later edits/deletes cannot race them.
  const pendingSendIds = new WeakMap<HostMessage, Promise<string>>();
  let chatMutationTail: Promise<void> = Promise.resolve();

  function enqueueChatMutation(label: string, operation: () => Promise<void>): Promise<void> {
    const next = chatMutationTail.then(operation);
    chatMutationTail = next.catch((err) => {
      _logSetFullChat.warn(
        `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return chatMutationTail;
  }

  function trackPendingSend(entry: HostMessage, completion: Promise<void>): void {
    pendingSendIds.set(entry, completion.then(() => entry.id));
  }

  function inheritPendingSend(previous: HostMessage, next: HostMessage): void {
    const pendingId = pendingSendIds.get(previous);
    if (!pendingId) return;
    pendingSendIds.set(next, pendingId);
    void pendingId.then((id) => {
      if (id) (next as { id: string }).id = id;
    });
  }

  async function resolveHostMessageId(entry: HostMessage): Promise<string> {
    return pendingSendIds.get(entry) ?? entry.id;
  }

  async function persistChatSend(entry: HostMessage): Promise<void> {
    try {
      const result = await api.chat.sendMessage(entry.content, { role: entry.role });
      const id = result && typeof result.id === 'string' ? result.id : '';
      if (id) (entry as { id: string }).id = id;
    } catch (err) {
      _logSetFullChat.warn(`send threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function persistChatDelete(entry: HostMessage): Promise<void> {
    try {
      const id = await resolveHostMessageId(entry);
      if (id) await api.chat.deleteMessage(id);
    } catch (err) {
      _logSetFullChat.warn(
        `delete msgId=${entry.id} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function persistChatEdit(previous: HostMessage, next: HostMessage): Promise<void> {
    try {
      const id = await resolveHostMessageId(previous);
      if (!id) return;
      if (rememberOurWrite && portalChatId) {
        try { rememberOurWrite(portalChatId, id, next.content); } catch { /* */ }
      }
      await api.chat.editMessage(id, next.content);
    } catch (err) {
      _logSetFullChat.warn(
        `edit msgId=${previous.id} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function reconcileFullChat(value: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(toStr(value));
    } catch (err) {
      _logSetFullChat.warn(
        `invalid JSON ignored: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!Array.isArray(parsed)) {
      _logSetFullChat.warn('non-array payload ignored');
      return;
    }

    const previous = [...messagesCache];
    const desired = parsed.map((raw) => {
      const item = raw && typeof raw === 'object'
        ? raw as { role?: unknown; data?: unknown }
        : {};
      return {
        role: risuRoleToLumi(toStr(item.role)),
        content: toStr(item.data),
      };
    });
    const overlap = Math.min(previous.length, desired.length);
    const roleChange = previous.findIndex(
      (entry, index) => index < overlap && entry.role !== desired[index]!.role,
    );
    const stablePrefixLength = roleChange >= 0 ? roleChange : overlap;
    const edits: Array<{ previous: HostMessage; next: HostMessage }> = [];
    const deletes = previous.slice(roleChange >= 0 ? roleChange : overlap);
    const sends: HostMessage[] = [];
    const next: HostMessage[] = [];

    for (let i = 0; i < stablePrefixLength; i++) {
      const oldEntry = previous[i]!;
      const wanted = desired[i]!;
      if (oldEntry.content === wanted.content) {
        next.push(oldEntry);
        continue;
      }
      const replacement: HostMessage = { ...oldEntry, content: wanted.content };
      inheritPendingSend(oldEntry, replacement);
      edits.push({ previous: oldEntry, next: replacement });
      next.push(replacement);
    }

    const desiredTailStart = roleChange >= 0 ? roleChange : overlap;
    for (let i = desiredTailStart; i < desired.length; i++) {
      const wanted = desired[i]!;
      const added: HostMessage = { id: '', role: wanted.role, content: wanted.content };
      sends.push(added);
      next.push(added);
    }
    messagesCache.splice(0, messagesCache.length, ...next);

    if (edits.length > 0 || deletes.length > 0 || sends.length > 0) {
      const completion = enqueueChatMutation('setFullChat', async () => {
        for (const edit of edits) await persistChatEdit(edit.previous, edit.next);
        for (const entry of deletes) await persistChatDelete(entry);
        for (const entry of sends) await persistChatSend(entry);
      });
      for (const entry of sends) trackPendingSend(entry, completion);
    }
    _logSetFullChat.info(
      `reconciled old=${previous.length} new=${next.length} edits=${edits.length} ` +
        `deletes=${deletes.length} sends=${sends.length} chatId=${portalChatId ?? '<none>'}`,
    );
  }

  // `dirty` boxed so flush() observes setVar writes across the closure boundary.
  const dirty: { value: boolean } = { value: false };
  const localScopes = new Map<number, Map<string, string>>();
  const tempVars = displayMode ? {} : undefined;
  const _vars = makeVarsApi({
    varsCache,
    localScopes,
    dirty,
    characterId,
    ...(preloaded?.scriptstateDefaults !== undefined
      ? { scriptstateDefaults: preloaded.scriptstateDefaults }
      : {}),
    ...(tempVars !== undefined ? { tempVars } : {}),
  });
  const { getVar, setVar, resolve, declareLocalVar, setvarV1, setvarV2, getLocal } = _vars;

  let stopSending = false;
  let sendAIprompt = false;
  const loopCounter: { value: number } = { value: 0 };
  const additionalSysPrompt: Record<'start' | 'historyend' | 'promptend', string> = {
    start: '', historyend: '', promptend: '',
  };

  const _chat = makeChatApi(api, { messagesCache, loopCounter, additionalSysPrompt, firstMessage }, (src) => notifyStateChanged(src));
  const {
    getMessagesTail, getMessageCount, getLastMessage, getMessageAtIndex,
    getLastUserMessage, getLastCharMessage, getFirstMessage,
    impersonate, systemPrompt, command, cutChat, modifyChat,
    updateGUI, updateChatAt, tokenize, quickSearchChat,
  } = _chat;

  function compare(a: unknown, b: unknown, op: string): boolean {
    return compareValues(a, b, op);
  }

  function checkConditions(conditions: readonly unknown[]): boolean {
    if (!Array.isArray(conditions)) return true;
    for (const c of conditions) {
      if (!c || typeof c !== 'object') continue;
      const co = c as Record<string, unknown>;
      const type = co['type'];
      let pass = true;
      if (type === 'chatindex') {
        const idx = getMessageCount() - 1;
        pass = compare(idx, resolve(co['value'], toStr(co['valueType'] ?? 'value')), toStr(co['operator'] ?? '='));
      } else if (type === 'exists') {
        const depth = Math.max(1, Number(co['depth']) || 1);
        const msgs = getMessagesTail(depth);
        const needle = toStr(resolve(co['value'], toStr(co['valueType'] ?? 'value'))).toLowerCase();
        const joined = msgs.map((m) => toStr(m.content)).join('\n').toLowerCase();
        const cond = co['condition'];
        pass = cond === 'loose' ? joined.indexOf(needle) >= 0
          : cond === 'regex' ? (() => { try { return new RegExp(needle).test(joined); } catch { return joined.indexOf(needle) >= 0; } })()
          : joined.split(/\s+/).indexOf(needle) >= 0;
      } else {
        const source = type === 'value' ? toStr(co['var']) : getVar(toStr(co['var']));
        const target = resolve(co['value'], toStr(co['valueType'] ?? 'value'));
        pass = compare(source, target, toStr(co['operator'] ?? '='));
      }
      if (!pass) return false;
    }
    return true;
  }

  async function showAlert(type: unknown, value: unknown, inputVar: string | null): Promise<void> {
    const t = toStr(type).toLowerCase();
    const v = toStr(value);
    try {
      if (t === 'input') {
        const r = api.ui && api.ui.prompt ? await api.ui.prompt(v, '') : null;
        if (inputVar) setVar(inputVar, toStr(r ?? ''));
        return;
      }
      if (t === 'ask' || t === 'confirm') {
        const r = api.ui && api.ui.confirm ? await api.ui.confirm(v, '') : false;
        if (inputVar) setVar(inputVar, r ? '1' : '0');
        return;
      }
      if (api.ui && api.ui.toast) {
        const kind = t === 'error' ? 'error' : t === 'warn' || t === 'warning' ? 'warning'
          : t === 'success' ? 'success' : 'info';
        api.ui.toast(v, kind);
      }
      if (inputVar) setVar(inputVar, '');
    } catch {
      if (inputVar) setVar(inputVar, '');
    }
  }

  async function alertInput(display: unknown): Promise<string> {
    try {
      if (api.ui && api.ui.prompt) {
        const r = await api.ui.prompt(toStr(display), '');
        return toStr(r ?? '');
      }
    } catch { /* */ }
    return '';
  }

  async function alertSelect(display: unknown, options: unknown): Promise<string> {
    if (api.ui && typeof api.ui.pick === 'function') {
      const opts = Array.isArray(options) ? options.map(toStr) : [];
      const r = await api.ui.pick(toStr(display), opts);
      // alertSelect returns the option index as a string, not its label.
      if (r == null) return '';
      const idx = opts.indexOf(toStr(r));
      return idx >= 0 ? String(idx) : '';
    }
    return unsupported('alertSelect', 'requires api.ui.pick');
  }

  async function runLLM(value: unknown, model: string, _streaming?: boolean): Promise<string> {
    return _runLLM(
      api,
      {
        submodelConnectionId,
        submodelModelOverride,
        submodelParamsWire,
        submodelPrefillCompat,
        auxPrefillCompat,
        ...(auxDebugCapture ? { auxDebugCapture } : {}),
      },
      value,
      model,
      _streaming,
    );
  }

  async function checkSimilarity(value: unknown, source: unknown): Promise<never> {
    void value; void source;
    return unsupported('checkSimilarity', 'requires HypaProcessor / vector-store equivalent; corpus usage = 0 effects');
  }

  async function runImgGen(value: unknown, neg: unknown): Promise<never> {
    void value; void neg;
    return unsupported('runImgGen', 'requires Lumiverse-side image-gen pipeline; corpus usage = 0 effects');
  }

  async function runTrigger(name: unknown): Promise<void> {
    const candidates = ['risu-manual-' + toStr(name), toStr(name)];
    await withInheritedVarsCache(varsCache, async () => {
      for (const n of candidates) {
        try {
          const mod = await scriptNs.require(n);
          const modObj = mod as { run?: (ctx: unknown) => Promise<unknown> };
          if (modObj && typeof modObj.run === 'function') {
            await modObj.run({ api, data, script: scriptNs });
            return;
          }
        } catch { /* try next */ }
      }
    });
  }

  // Risu dropped triggercode; runCode is a no-op for parity.
  async function runCode(code: unknown): Promise<void> {
    warnDroppedTriggerCode(toStr(code).slice(0, 60));
  }

  // Per-label dedup so each distinct triggercode body warns once per dispatch.
  const triggerCodeWarned = new Set<string>();
  function warnDroppedTriggerCode(label?: string): void {
    const key = label && label.length > 0 ? label : '<unspecified>';
    if (triggerCodeWarned.has(key)) return;
    triggerCodeWarned.add(key);
    _logTriggercode.warn(
      `dropped (Risu parity: triggercode no longer dispatched). ` +
      `characterId=${characterId ?? '<none>'} binding=${binding ?? '<none>'} ` +
      `body[0..60]=${JSON.stringify(key)}`,
    );
  }

  async function runLua(code: unknown, luaOpts?: Record<string, unknown>): Promise<unknown> {
    // RISU_COMPAT_VERBOSE=1 enables phase/globals logging.
    let verbose = false;
    try {
      verbose = typeof process !== 'undefined'
        && (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RISU_COMPAT_VERBOSE === '1';
    } catch { /* */ }
    const rlog = _logRunLua.info;
    const rverbose = (m: string) => { if (verbose) rlog(m); };
    const rerr = _logRunLua.error;
    const codeStr = toStr(code);
    const tStart = Date.now();
    rlog(`START binding=${binding} code_len=${codeStr.length} characterId=${characterId ?? '<none>'} entry=${String(luaOpts?.['entry'] ?? '<default>')}`);
    rverbose(`START ctx varsCache_keys=${Object.keys(varsCache).length} messagesCache_count=${messagesCache.length} lorebook_entries=${lorebook.entries.length}`);
    rverbose(`luaOpts=${JSON.stringify(luaOpts ?? {})}`);
    const lua = await scriptNs.require('risu-compat-lua') as { execute?: (code: string, globals: unknown, opts: unknown) => Promise<unknown> } | null;
    if (!lua || typeof lua.execute !== 'function') {
      rerr(`risu-compat-lua bridge missing/invalid: require returned ${lua === null ? 'null' : typeof lua}`);
      return unsupported('runLua', 'risu-compat-lua bridge failed to load exports.execute');
    }
    const entryMap: Record<string, string> = {
      input: 'onInput', output: 'onOutput', start: 'onStart',
      manual: 'onButtonClick', request: 'onRequest',
    };
    const effective: Record<string, unknown> = { ...(luaOpts || {}) };
    if (!effective['entry']) effective['entry'] = entryMap[binding] || binding || 'onRun';
    if (!effective['args']) effective['args'] = [String(Math.random()).slice(2, 10)];
    rverbose(`calling lua.execute entry=${String(effective['entry'])} args=${JSON.stringify(effective['args'])}`);
    const globals = makeRisuLuaGlobals();
    rverbose(`globals keys=${Object.keys(globals).length}: ${Object.keys(globals).slice(0, 20).join(',')}${Object.keys(globals).length > 20 ? '…' : ''}`);
    const wasmoonKey = typeof effective['wasmoonKey'] === 'string' ? effective['wasmoonKey'] as string : null;
    try {
      const result = (wasmoonKey && _wasmoonExec && _wasmoonEnabled)
        ? await _wasmoonExec(codeStr, globals, { entry: String(effective['entry']), args: effective['args'] as readonly unknown[], wasmoonKey })
        : await lua.execute(codeStr, globals, effective);
      const preview = result === undefined ? 'undefined' : String(JSON.stringify(result) ?? '').slice(0, 200);
      rlog(`DONE elapsed=${Date.now() - tStart}ms result_type=${typeof result} result_preview=${preview}`);
      if (result === false) stopSending = true;
      return result;
    } catch (err) {
      rerr(`THREW after ${Date.now() - tStart}ms: ${(err as Error).message}`);
      throw err;
    }
  }

  function makeRisuLuaGlobals(): Record<string, unknown> {
    function luaReject(name: string, reason: string): () => Promise<never> {
      return function () {
        return Promise.reject(new Error('risu-compat: lua.' + name + ' unavailable: ' + reason));
      };
    }
    return {
      getChatVar: (_id: unknown, key: unknown) => getVar(toStr(key)),
      setChatVar: (_id: unknown, key: unknown, value: unknown) => setVar(toStr(key), toStr(value)),
      getGlobalVar: (_id: unknown, key: unknown) => globalVarsCache[toStr(key)] ?? 'null',
      stopChat: (_id: unknown) => { stopSending = true; },
      // Risu parity: fire-and-forget. Returning the Promise would force Lua to await or leak an unhandledRejection on modal-infra throw.
      alertError: (_id: unknown, value: unknown) => {
        if (api.ui?.alert) {
          api.ui.alert(toStr(value), 'error').catch(() => { /* swallow */ });
          return;
        }
        try { api.ui?.toast?.(toStr(value), 'error'); } catch { /* */ }
      },
      alertNormal: (_id: unknown, value: unknown) => {
        if (api.ui?.alert) {
          api.ui.alert(toStr(value), 'info').catch(() => { /* swallow */ });
          return;
        }
        try { api.ui?.toast?.(toStr(value), 'info'); } catch { /* */ }
      },
      alertInput: (_id: unknown, value: unknown) => {
        if (!api.ui?.prompt) return Promise.reject(new Error('risu-compat: lua.alertInput requires api.ui.prompt'));
        return api.ui.prompt(toStr(value), '').then((r) => toStr(r ?? ''));
      },
      alertSelect: (_id: unknown, options: unknown) => {
        if (api.ui?.pick) {
          const opts = Array.isArray(options) ? options.map(toStr) : [];
          return api.ui.pick('', opts).then((r) => {
            if (r == null) return '';
            const idx = opts.indexOf(toStr(r));
            return idx >= 0 ? String(idx) : '';
          });
        }
        return Promise.reject(new Error('risu-compat: lua.alertSelect requires api.ui.pick'));
      },
      alertConfirm: (_id: unknown, value: unknown) => {
        if (!api.ui?.confirm) return Promise.reject(new Error('risu-compat: lua.alertConfirm requires api.ui.confirm'));
        return api.ui.confirm(toStr(value), '');
      },
      getChatMain: (_id: unknown, index: unknown) => {
        const n = Number(index);
        const real = n >= 0 ? n : messagesCache.length + n;
        const m = messagesCache[real];
        // Risu chat.message[i].role is 'user' | 'char' (scriptings.ts:154-165,182).
        // Cards branch on `msg.role == "char"`; surface Lumi roles in Risu shape.
        return m ? JSON.stringify({ role: lumiRoleToRisu(m.role), data: toStr(m.content) }) : JSON.stringify(null);
      },
      setChat: (_id: unknown, index: unknown, value: unknown) => {
        const n = Number(index);
        const real = n >= 0 ? n : messagesCache.length + n;
        if (!messagesCache[real]) {
          // Risu silently no-ops on out-of-range; log for diagnosis (off-by-one callers).
          _logSetChat.warn(
            `out-of-range index=${index} ` +
              `(real=${real}, messagesCache.length=${messagesCache.length}): ignored`,
          );
          return;
        }
        // Doc-boundary normalize. Strips DOCTYPE/html/head/body tags, wraps
        // leading style so DOMPurify keeps the CSS.
        const raw = normalizeReplaceStringForSanitizer(toStr(value));
        const msgId = messagesCache[real]!.id;
        const prevContent = messagesCache[real]!.content;

        // No-op write: Lua read the message via `getChat(N)`, did some logic
        // that didn't actually mutate the body, then wrote the same string
        // back. Cards do this routinely as part of "set var X then nudge"
        // patterns (Alternate Hunters V2 ToggleSysSettings , flips
        // `ui_sys_stat` and re-writes the same already-resolved greeting,
        // expecting the next render to re-evaluate `{{getvar::ui_sys_stat}}`
        // in the display-regex panel rule).
        //
        // Skip when the value is identical to what's already stored. Lua's
        // intent ("nudge a re-render") is satisfied by the
        // `notifyStateChanged` calls earlier in the same trigger body
        // (reloadDisplay / v2UpdateGUI). The chat row stays unchanged.
        if (raw === prevContent) {
          _logSetChat.info(
            `index=${index} (real=${real}) msgId=${msgId} len=${raw.length} ` +
              `chatId=${portalChatId ?? '<none>'} no-op (raw === prev) — ` +
              `skipped editMessage`,
          );
          return;
        }

        const oldEntry = messagesCache[real]!;
        const newEntry = { ...oldEntry, content: raw };
        messagesCache[real] = newEntry;

        _logSetChat.info(
          `index=${index} (real=${real}) msgId=${msgId} ` +
            `len=${raw.length} chatId=${portalChatId ?? '<none>'}`,
        );

        // Editing an addChat'd message before its sendMessage resolved: id is
        // still ''. Carry the pending mapping to the replacement object (so a
        // later removeChat can still delete the row) and apply the edit once
        // the real id lands instead of dropping it on editMessage('').
        inheritPendingSend(oldEntry, newEntry);
        enqueueChatMutation('setChat', () => persistChatEdit(oldEntry, newEntry));
      },
      setChatRole: (_id: unknown, index: unknown, value: unknown) => {
        const n = Number(index);
        if (!messagesCache[n]) return;
        const desired = messagesCache.map((message) => ({
          role: lumiRoleToRisu(message.role),
          data: message.content,
        }));
        desired[n] = {
          ...desired[n]!,
          role: lumiRoleToRisu(risuRoleToLumi(toStr(value))),
        };
        reconcileFullChat(JSON.stringify(desired));
      },
      cutChat: (_id: unknown, start: unknown, end: unknown) => { cutChat(start, end); },
      removeChat: (_id: unknown, index: unknown) => {
        const n = Number(index);
        if (!Number.isFinite(n)) return;
        // Mirror Risu's `chat.message.splice(index, 1)` JS clamping exactly so
        // positive/negative/out-of-range indices remove the same element. `start`
        // also locates the Lumi row ('' id while the send is still pending).
        const len = messagesCache.length;
        const start = n < 0 ? Math.max(len + n, 0) : Math.min(n, len);
        if (start >= len) return;
        const m = messagesCache[start];
        if (m) enqueueChatMutation('removeChat', () => persistChatDelete(m));
        messagesCache.splice(start, 1);
      },
      addChat: (_id: unknown, role: unknown, value: unknown) => {
        const raw = normalizeReplaceStringForSanitizer(toStr(value));
        const lumiRole = risuRoleToLumi(toStr(role));
        const entry: HostMessage = { id: '', role: lumiRole, content: raw };
        messagesCache.push(entry);
        _logAddChat.info(
          `role=${toStr(role)} len=${raw.length} chatId=${portalChatId ?? '<none>'}`,
        );
        trackPendingSend(
          entry,
          enqueueChatMutation('addChat', () => persistChatSend(entry)),
        );
      },
      insertChat: (_id: unknown, index: unknown, role: unknown, value: unknown) => {
        const desired = messagesCache.map((message) => ({
          role: lumiRoleToRisu(message.role),
          data: message.content,
        }));
        desired.splice(Number(index), 0, {
          role: lumiRoleToRisu(risuRoleToLumi(toStr(role))),
          data: toStr(value),
        });
        reconcileFullChat(JSON.stringify(desired));
      },
      getChatLength: (_id: unknown) => messagesCache.length,
      getFullChatMain: (_id: unknown) => JSON.stringify(messagesCache.map((m) => ({ role: lumiRoleToRisu(m.role), data: toStr(m.content) }))),
      setFullChatMain: (_id: unknown, value: unknown) => { reconcileFullChat(value); },
      sleep: (_id: unknown, ms: unknown) => new Promise<void>((r) => setTimeout(r, Math.max(0, Number(ms) || 0))),
      // Risu parity: user-facing `cbs` is sync. The lua-bridge prelude wraps `cbsMain():await()` so cards calling `cbs("...")` get a string.
      cbsMain: async (value: unknown): Promise<string> => {
        const text = toStr(value);
        // Closure-captured resolver. Late-reading the dispatch context here
        // would route cbs() through whichever user's setDispatchContext won
        // the race, leaking their data into this runtime's Lua.
        const resolver = capturedResolveTemplate;
        if (resolver) {
          try {
            return await resolver(text);
          } catch (err) {
            _logCbs.warn(`cbs resolver threw — returning input verbatim: ${err instanceof Error ? err.message : String(err)}`);
            return text;
          }
        }
        if (api.utils?.template?.render) {
          try {
            return await api.utils.template.render(text, {});
          } catch (err) {
            _logCbs.warn(`cbs api.utils.template.render threw — returning input verbatim: ${err instanceof Error ? err.message : String(err)}`);
            return text;
          }
        }
        warnCbsUnresolvedOnce(api);
        return text;
      },
      logMain: (value: unknown) => { try { _logLuaPrint.debug(toStr(value)); } catch { /* */ } },
      // reloadDisplay forces refresh from async/callback paths.
      reloadDisplay: (_id: unknown) => {
        notifyStateChanged('reloadDisplay');
      },
      reloadChat: (_id: unknown, _index: unknown) => {
        notifyStateChanged('reloadChat');
      },
      getNameMain: async (_id: unknown) => {
        const cid = characterId || (data as { characterId?: string }).characterId;
        if (!cid) return '';
        try {
          return toStr((await api.characters.get(cid)).name);
        } catch {
          return toStr((data as { characterName?: unknown }).characterName || '');
        }
      },
      setNameMain: async (_id: unknown, name: unknown) => {
        const cid = characterId || (data as { characterId?: string }).characterId;
        if (cid) await api.characters.update(cid, { name: toStr(name) });
      },
      getDescriptionMain: (_id: unknown) => _charNote.getCharacterDesc(),
      setDescriptionMain: (_id: unknown, desc: unknown) => _charNote.setCharacterDesc(desc),
      getCharacterFirstMessageMain: async (_id: unknown) => {
        const cid = characterId || (data as { characterId?: string }).characterId;
        if (!cid) return toStr(firstMessage ?? '');
        try {
          return toStr((await api.characters.get(cid)).firstMessage);
        } catch {
          return toStr(firstMessage ?? '');
        }
      },
      setCharacterFirstMessageMain: async (_id: unknown, value: unknown) => {
        const cid = characterId || (data as { characterId?: string }).characterId;
        if (cid) await api.characters.update(cid, { firstMessage: toStr(value) });
      },
      getPersonaName: (_id: unknown) => toStr((data as { userName?: unknown }).userName || 'user'),
      getPersonaDescriptionMain: async (_id: unknown) => {
        const description = await _charNote.getPersonaDesc();
        const resolver = capturedResolveTemplate;
        if (!resolver) return description;
        try {
          return await resolver(description);
        } catch {
          return description;
        }
      },
      getAuthorsNoteMain: (_id: unknown) => _charNote.getAuthorNote(),
      getBackgroundEmbedding: (_id: unknown) => '',
      setBackgroundEmbedding: (_id: unknown, _data: unknown) => { /* */ },
      // Risu scriptings.ts getCharacterLastMessage falls back to char.firstMessage
      // (the greeting) when chat.message[] has no char-role message.
      getCharacterLastMessage: (_id: unknown) => {
        const last = getLastCharMessage();
        return last !== '' ? last : toStr(firstMessage ?? '');
      },
      getUserLastMessage: (_id: unknown) => getLastUserMessage(),
      // Returns {success,result} JSON. Gated on lowLevelAccess.
      LLMMain: async (_id: unknown, promptStr: unknown, _useMulti: unknown, _optionsStr: unknown): Promise<string> => {
        if (!lowLevelAccess) {
          return JSON.stringify({
            success: false,
            result: 'risu-compat: lua.LLMMain unavailable, trigger lacks lowLevelAccess',
          });
        }
        if (!api.llm?.generate) {
          return JSON.stringify({
            success: false,
            result: 'risu-compat: api.llm.generate not available on this host',
          });
        }
        const msgs = parseLuaPromptArg(promptStr);
        const tStart = Date.now();
        try {
          const r = await api.llm.generate({ messages: msgs, ...(auxPrefillCompat ? { prefillCompat: true } : {}) });
          const out = toStr(r && r.content);
          _logLLMMain.info(
            `msgs=${msgs.length} elapsed=${Date.now() - tStart}ms ` +
              `out_len=${out.length} chatId=${portalChatId ?? '<none>'}`,
          );
          return JSON.stringify({ success: true, result: out });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          _logLLMMain.warn(`failed elapsed=${Date.now() - tStart}ms: ${msg}`);
          return JSON.stringify({ success: false, result: 'Error: ' + msg });
        }
      },
      // Same shape as LLMMain. Routes through auxConnectionId.
      axLLMMain: async (_id: unknown, promptStr: unknown, _useMulti: unknown, _optionsStr: unknown): Promise<string> => {
        if (!lowLevelAccess) {
          return JSON.stringify({
            success: false,
            result: 'risu-compat: lua.axLLMMain unavailable, trigger lacks lowLevelAccess',
          });
        }
        if (!api.llm?.generate) {
          return JSON.stringify({
            success: false,
            result: 'risu-compat: api.llm.generate not available on this host',
          });
        }
        const msgs = parseLuaPromptArg(promptStr);
        const tStart = Date.now();
        const generateReq: {
          messages: { role: string; content: string }[];
          model?: string;
          connectionId?: string;
          parameters?: Record<string, number>;
          prefillCompat?: boolean;
        } = {
          messages: msgs,
          ...(auxConnectionId ? { connectionId: auxConnectionId } : {}),
          ...(auxModelOverride ? { model: auxModelOverride } : {}),
          ...(auxParamsWire ? { parameters: auxParamsWire } : {}),
          ...(auxPrefillCompat ? { prefillCompat: true } : {}),
        };
        if (auxDebugCapture) {
          try {
            auxDebugCapture({
              kind: 'request',
              channel: 'aux',
              auxConnectionId,
              auxModelOverride,
              elapsedMs: null,
              payload: generateReq,
            });
          } catch { /* never crash trigger work for diagnostic plumbing */ }
        }
        try {
          const r = await api.llm.generate(generateReq);
          const out = toStr(r && r.content);
          const elapsed = Date.now() - tStart;
          _logAxLLMMain.info(
            `msgs=${msgs.length} elapsed=${elapsed}ms ` +
              `out_len=${out.length} chatId=${portalChatId ?? '<none>'} ` +
              `auxConn=${auxConnectionId ?? '<default>'} auxModel=${auxModelOverride ?? '<connection>'}`,
          );
          if (auxDebugCapture) {
            try {
              auxDebugCapture({
                kind: 'response',
                channel: 'aux',
                auxConnectionId,
                auxModelOverride,
                elapsedMs: elapsed,
                payload: { content: out },
              });
            } catch { /* */ }
          }
          return JSON.stringify({ success: true, result: out });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const elapsed = Date.now() - tStart;
          _logAxLLMMain.warn(`failed elapsed=${elapsed}ms: ${errMsg}`);
          if (auxDebugCapture) {
            try {
              auxDebugCapture({
                kind: 'error',
                channel: 'aux',
                auxConnectionId,
                auxModelOverride,
                elapsedMs: elapsed,
                payload: { message: errMsg },
              });
            } catch { /* */ }
          }
          return JSON.stringify({ success: false, result: 'Error: ' + errMsg });
        }
      },
      // Returns string directly. Empty string when no access (Risu parity).
      simpleLLM: async (_id: unknown, prompt: unknown): Promise<string> => {
        if (!lowLevelAccess) {
          return '';
        }
        if (!api.llm?.generate) {
          throw new Error('risu-compat: lua.simpleLLM requires api.llm.generate');
        }
        const r = await api.llm.generate({ messages: [{ role: 'user', content: toStr(prompt) }], ...(auxPrefillCompat ? { prefillCompat: true } : {}) });
        return toStr(r && r.content);
      },
      hash: (_id: unknown, value: unknown) => {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
          return Promise.reject(new Error('risu-compat: lua.hash requires globalThis.crypto.subtle'));
        }
        const dataBytes = new TextEncoder().encode(toStr(value));
        return crypto.subtle.digest('SHA-256', dataBytes).then((buf) => {
          const bytes = new Uint8Array(buf);
          let hex = '';
          for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i]!.toString(16);
            hex += b.length === 1 ? '0' + b : b;
          }
          return hex;
        });
      },
      // Falls back to length/4 when host doesn't expose tokens.
      getTokens: async (_id: unknown, value: unknown): Promise<number> => {
        const text = toStr(value);
        if (!api.tokens?.count) {
          return Math.ceil(text.length / 4);
        }
        try {
          return await api.tokens.count(text);
        } catch {
          return Math.ceil(text.length / 4);
        }
      },
      similarity: luaReject('similarity', 'requires vector-store bridge'),
      request: luaReject('request', 'arbitrary-URL fetch from user Lua is out of scope'),
      generateImage: luaReject('generateImage', 'requires image-gen pipeline'),
      // Emits resolved HTML directly. Sentinel wouldn't survive DB write without a re-parse pass.
      getCharacterImageMain: async (_id: unknown) => {
        try {
          if (!characterId) return '';
          const char = await api.characters.get(characterId);
          const imgId = char?.imageId;
          if (!imgId) return '';
          return `<div class="risu-inlay-image"><img src="/api/v1/images/${imgId}" /></div>\n\n`;
        } catch { return ''; }
      },
      // Same shape. Reads active persona avatar.
      getPersonaImageMain: async (_id: unknown) => {
        try {
          if (!api.personas?.getActive) return '';
          const persona = await api.personas.getActive();
          const imgId = persona?.imageId;
          if (!imgId) return '';
          return `<div class="risu-inlay-image"><img src="/api/v1/images/${imgId}" /></div>\n\n`;
        } catch { return ''; }
      },
      loadLoreBooksMain: (_id: unknown, _reserve: unknown) => {
        void _reserve;
        return Promise.resolve(JSON.stringify(lorebook.entries.map((e) => toStr(e.content))));
      },
      getLoreBooksMain: (_id: unknown, _search: unknown) => JSON.stringify(getAllLorebooks()),
      upsertLocalLoreBook: (_id: unknown, name: unknown, content: unknown, opts?: Record<string, unknown>) => {
        const o = opts || {};
        createLorebook(name, o['key'] || name, content, o['order'] || 0);
      },
    };
  }


  // String/regex/arithmetic helpers live in runtime/strings-regex.ts (pure, no closure deps).

  const _arraysDicts = makeArraysDictsApi(_vars);
  const {
    makeArrayVar, arrayLength, arrayGet, arraySet, arrayPush, arrayPop,
    arrayShift, arrayUnshift, arraySplice, arraySlice, arrayJoin,
    arrayIndexOf, arrayRemoveIndex,
    makeDictVar, dictGet, dictSet, dictDelete, dictHasKey, dictClear,
    dictSize, dictKeys, dictValues,
  } = _arraysDicts;

  const _charNote = makeCharacterNoteApi(api, { characterId, data: data as { characterId?: string } & Record<string, unknown> }, _vars);
  const {
    getCharacterDesc, setCharacterDesc,
    getPersonaDesc, setPersonaDesc,
    getReplaceGlobalNote, setReplaceGlobalNote,
    getAuthorNote, setAuthorNote,
  } = _charNote;

  const _lore = makeLorebookApi(api, lorebook);
  const {
    getLorebookCount, getLorebookEntry, getLorebookByIndex, getLorebookByKey,
    getLorebookIndexViaName, getAllLorebooks, getLorebookByName,
    modifyLorebook, modifyLorebookByIndex, createLorebook,
    deleteLorebookByIndex, setLorebookActivation, setLorebookAlwaysActive,
  } = _lore;

  const _displayState = makeDisplayStateApi(opts.displayData, opts.requestData);
  const {
    getDisplayState, setDisplayState,
    getRequestState, setRequestState,
    getRequestStateRole, setRequestStateRole,
    getRequestStateLength, getRequestStateMessages,
  } = _displayState;


  function loopTick(): number { return ++loopCounter.value; }
  function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, Math.max(1, Number(ms) || 1))); }

  async function flush(): Promise<void> {
    const flog = _logFlush.info;
    // Persist on dirty=true even when frame is inherited: Risu's two-stage
    // cycle (parent fires runTrigger, child writes, parent returns without
    // writing itself) would lose child-only writes if we gated, since
    // parent's own dirty stays false and its flush no-ops. inheritedVarsAls
    // prevents cross-user mixing at source so no extra gate needed.
    flog(`START dirty=${dirty.value} varsCache_keys=${Object.keys(varsCache).length} binding=${binding} inherited=${isInheritedVarsCache}`);
    if (Object.keys(varsCache).length > 0) {
      const preview = Object.entries(varsCache).slice(0, 10).map(([k,v]) => `${k}=${JSON.stringify(String(v).slice(0, 40))}`).join(' ');
      flog(`varsCache_sample: ${preview}${Object.keys(varsCache).length > 10 ? ' …' : ''}`);
    }
    if (dirty.value) {
      try {
        await saveVars(api, varsCache, portalChatId);
        flog(`saveVars OK`);
      } catch (err) {
        _logFlush.error(`saveVars FAILED: ${(err as Error).message}`);
      }
    }
    dirty.value = false;
    await chatMutationTail;
    flog(`DONE`);
  }

  const publicApi: RisuTriggerRuntime = {
    get stopSending() { return stopSending; },
    set stopSending(v) { stopSending = !!v; },
    get sendAIprompt() { return sendAIprompt; },
    set sendAIprompt(v) { sendAIprompt = !!v; },
    displayMode, lowLevelAccess, characterId,
    resolve, setVar, getVar, declareLocalVar,
    setvarV1, setvarV2, compare, checkConditions,
    loopTick, sleep,
    impersonate, systemPrompt, command, cutChat, modifyChat,
    updateGUI, updateChatAt, tokenize, quickSearchChat,
    getLastMessage, getMessageAtIndex, getMessageCount,
    getLastUserMessage, getLastCharMessage, getFirstMessage,
    showAlert, alertInput, alertSelect,
    runLLM, checkSimilarity, runImgGen,
    runTrigger, runCode, runLua,
    extractRegex, regexTest, replaceString,
    random,
    setCharAt, splitString, calculate,
    makeArrayVar, arrayLength, arrayGet, arraySet, arrayPush, arrayPop,
    arrayShift, arrayUnshift, arraySplice, arraySlice, arrayJoin,
    arrayIndexOf, arrayRemoveIndex,
    makeDictVar, dictGet, dictSet, dictDelete, dictHasKey, dictClear,
    dictSize, dictKeys, dictValues,
    getCharacterDesc, setCharacterDesc, getPersonaDesc, setPersonaDesc,
    getReplaceGlobalNote, setReplaceGlobalNote, getAuthorNote, setAuthorNote,
    modifyLorebook, getLorebookByKey, getLorebookCount, getLorebookEntry,
    setLorebookActivation, getLorebookIndexViaName, getAllLorebooks,
    getLorebookByName, getLorebookByIndex, createLorebook,
    modifyLorebookByIndex, deleteLorebookByIndex, setLorebookAlwaysActive,
    getDisplayState, setDisplayState, getRequestState, setRequestState,
    getRequestStateRole, setRequestStateRole, getRequestStateLength,
    getRequestStateMessages,
    flush,
    warnDroppedTriggerCode,
  };

  return publicApi;
}


export { makeRisuRegexRuntime } from './runtime/regex-runtime.js';
