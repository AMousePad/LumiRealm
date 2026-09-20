import type {
  SpindleDisplayResolver,
  SpindleDisplayBodyArgs,
  SpindleDisplayResolveResult,
  SpindleDisplayTemplatesArgs,
  SpindleDisplayTemplatesResult,
  SpindleDisplayScriptsArgs,
  SpindleDisplayContext,
} from 'lumiverse-spindle-types';
import { runPipeline, type RunPipelineInput } from '../interpreter/evaluator/pipeline.js';
import {
  MSG_DEP_KEY,
  buildEvaluatorContext,
  type VarReadRecorder,
} from '../interpreter/evaluator/context.js';
import {
  getRuntimeAtActionDependencies,
  isRowlessAtAction,
} from '../interpreter/at-actions-runtime.js';
import { makeSafeLogger } from '../util/safe-log.js';
import {
  getDisplaySnapshot,
  getDisplayResolutionMode,
  isDisplayResolutionReady,
  waitForSnapshot,
  type DisplaySnapshot,
} from './snapshot.js';
import { isRisuRegexScript, type FeRegexScript, type FeRegexMatch } from './regex-apply.js';
import { ActivationPatternError, createActivationPatternCache, type ActivationPatternCache } from './activation-patterns.js';
import { applyRegexScriptsCore, type RegexCoreScript } from './regex-core.js';
import { decorateNativeRegexActions } from './regex-actions.js';
import { createNativeVariableMacros } from './native-variable-macros.js';
import { runEditDisplayChain, runEditDisplayAtActions } from './lua-runner.js';
import { runDisplayTriggerChain } from './trigger-runner.js';
import {
  withCurrentDisplayMessage,
  resolveHostDisplayMessageIndex,
  resolveRisuDisplayMessageIndex,
  type DisplayRuntimeEffectSink,
} from './host-shim.js';
import { buildModuleDisplayPlan } from './module-action-plan.js';
import { parseDisplayCaller } from './caller-parser.js';
import { evaluate } from '../interpreter/evaluator/scanner.js';
const log = makeSafeLogger('display-resolver');

const DBG_MARKS = ['🔄', '<CombatChoice', '<ActivityChoice', '<Panel>', '■■■', 'intro', '★■', '🦶'];
function dbgMarks(s: string): string {
  return DBG_MARKS.filter((m) => s.includes(m)).join(',');
}

export type DisplayWritebackSink = (chatId: string, vars: Record<string, string>) => void;

const SNAPSHOT_WAIT_MS = 4000;

async function getSnapshotOrWait(chatId: string): Promise<DisplaySnapshot | undefined> {
  const existing = getDisplaySnapshot(chatId);
  if (existing) return existing;
  const ok = await waitForSnapshot(chatId, SNAPSHOT_WAIT_MS);
  if (ok) return getDisplaySnapshot(chatId);
  log.error(
    `[FE-DISPLAY] snapshot did not arrive for owned chat=${chatId} within ${SNAPSHOT_WAIT_MS}ms — ` +
      `failing LOUD (raw content shown). The host must NOT fall back to backend resolution for an owned chat.`,
  );
  return undefined;
}

function buildInput(
  snap: DisplaySnapshot,
  content: string,
  context: SpindleDisplayContext,
): RunPipelineInput {
  const role = context.role ?? context.dynamicMacros?.role;
  return {
    template: content,
    phase: 'display',
    // Risu renders display with rmVar: the setvar family hides, never executes.
    rmVar: true,
    chatId: snap.chatId,
    characterId: snap.characterId,
    userName: snap.userName,
    charName: snap.charName,
    personaText: snap.personaText,
    personaImage: snap.personaImage,
    character: snap.character,
    chat: snap.chat,
    variables: snap.vars,
    scriptstateDefaults: snap.scriptstateDefaults,
    screenWidth: snap.screenWidth,
    screenHeight: snap.screenHeight,
    legacyMediaFindings: snap.legacyMediaFindings,
    modulesByNamespace: snap.modulesByNamespace,
    lorebook: snap.lorebook,
    currentMessageIndexOverride: resolveRisuDisplayMessageIndex(snap, context),
    ...(role ? { currentMessageRoleOverride: role } : {}),
  };
}

function evalTemplate(
  snap: DisplaySnapshot,
  text: string,
  context: SpindleDisplayContext,
  recorder: VarReadRecorder,
): string {
  return runPipeline(buildInput(snap, text, context), { recorder });
}

async function fetchBackendBody(
  chatId: string,
  messageId: string | undefined,
  role: string | undefined,
  content: string,
): Promise<string> {
  try {
    const res = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/display-preprocess`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ messageId, role, rawContent: content }] }),
    });
    if (!res.ok) return content;
    const json = (await res.json()) as { items?: Array<{ content?: unknown }> };
    const c = json.items?.[0]?.content;
    return typeof c === 'string' ? c : content;
  } catch {
    return content;
  }
}

async function fetchBackendTemplates(
  templates: Record<string, string>,
  context: SpindleDisplayContext,
): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/v1/macros/resolve-batch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templates,
        chat_id: context.chatId,
        character_id: context.characterId,
        persona_id: context.personaId,
      }),
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { resolved?: Record<string, string> };
    return json.resolved ?? {};
  } catch {
    return {};
  }
}

async function fetchBackendApply(args: SpindleDisplayScriptsArgs): Promise<string | null> {
  const ctx = args.context;
  try {
    const res = await fetch('/api/v1/regex-scripts/apply', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: args.content,
        scripts: args.scripts,
        resolved_find_patterns: args.resolvedFindPatterns,
        resolved_replacements: args.resolvedReplacements,
        dynamic_macros: ctx.dynamicMacros,
        context: {
          chat_id: ctx.chatId,
          character_id: ctx.characterId,
          persona_id: ctx.personaId,
          is_user: ctx.isUser,
          depth: ctx.depth,
          ...(ctx.messageId ? { message_id: ctx.messageId } : {}),
          ...(typeof ctx.messageIndex === 'number' ? { message_index: ctx.messageIndex } : {}),
          ...(ctx.role ? { role: ctx.role } : {}),
        },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    return typeof json.result === 'string' ? json.result : null;
  } catch {
    return null;
  }
}

const warnedActionBindings = new Set<string>();

function warnActionBinding(scriptId: string, reason: string): void {
  const key = `${scriptId}\u0000${reason}`;
  if (warnedActionBindings.has(key)) return;
  if (warnedActionBindings.size >= 256) warnedActionBindings.clear();
  warnedActionBindings.add(key);
  log.warn(`applyScripts: skipped module row=${scriptId}: ${reason}`);
}

function scriptApplies(
  script: FeRegexScript,
  context: SpindleDisplayContext,
): boolean {
  if (script.disabled === true) return false;
  const placement = context.isUser ? 'user_input' : 'ai_output';
  if (!script.placement.includes(placement)) return false;
  if (script.min_depth !== null && context.depth < script.min_depth) return false;
  if (script.max_depth !== null && context.depth > script.max_depth) return false;
  return true;
}

function toCoreScript(script: FeRegexScript, nativeEval: (text: string) => string, prepared: ReadonlyMap<string, string | ActivationPatternError>): RegexCoreScript {
  const matchActions = readRegexMatchActions(script.metadata);
  const actions = script.actions;
  const isRisu = isRisuRegexScript(script);
  const risu = script.metadata?.['_risu'] as Record<string, unknown> | undefined;
  const unicodeFlags = risu?.['unicode_flags'];
  return {
    find_regex: script.find_regex,
    replace_string: script.replace_string,
    flags: isRisu && typeof unicodeFlags === 'string'
      && script.flags === (unicodeFlags.replace(/u/g, '') || 'u')
      ? unicodeFlags : script.flags,
    substitute_macros: script.substitute_macros,
    placement: script.placement,
    target: 'display',
    min_depth: script.min_depth,
    max_depth: script.max_depth,
    trim_strings: script.trim_strings,
    // Only Risu's processScriptFull adds a CBS pass after ordinary replacement.
    reResolveAfterRule: isRisu,
    ...(isRisu ? { risuActions: Array.isArray(risu?.['flag_actions'])
      ? risu['flag_actions'].filter((action): action is string => typeof action === 'string')
      : [] } : {}),
    ...(typeof prepared.get(script.id) === 'string' ? { preResolvedFind: prepared.get(script.id) as string } : {}),
    ...(!isRisu ? { evalTemplate: nativeEval } : {}),
    ...(actions && actions.length > 0 ? {
      decorateReplacement: (replacement: string, match: FeRegexMatch, input: string) =>
        decorateNativeRegexActions(replacement, script.id, actions, match, input),
    } : {}),
    ...(script.disabled !== undefined ? { disabled: script.disabled } : {}),
    ...(matchActions.length > 0 ? { matchActions } : {}),
    ...(typeof script.metadata?.['repeat_position'] === 'string'
      ? { repeatPosition: script.metadata['repeat_position'] }
      : {}),
    ...(script.metadata?.['repeat_raw_match'] === true
      ? { repeatRawMatch: true }
      : {}),
  };
}

function readRegexMatchActions(
  metadata: Readonly<Record<string, unknown>> | undefined,
): NonNullable<RegexCoreScript['matchActions']> {
  const raw = metadata?.['match_actions'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (action): action is 'move_top' | 'move_bottom' | 'repeat_back' =>
      action === 'move_top'
      || action === 'move_bottom'
      || action === 'repeat_back',
  );
}

function displayBehaviorContext(
  snap: DisplaySnapshot,
  context: SpindleDisplayContext,
): {
  readonly previousContent?: string;
} {
  const currentIndex = resolveHostDisplayMessageIndex(snap, context);
  if (
    typeof currentIndex !== 'number'
    || !Number.isInteger(currentIndex)
    || currentIndex <= 0
  ) return {};
  const role = context.role
    ?? snap.messagesHost[currentIndex]?.role
    ?? (context.isUser ? 'user' : 'assistant');
  for (let index = currentIndex - 1; index >= 1; index--) {
    const message = snap.messagesHost[index];
    if (message?.role === role) {
      return {
        previousContent: message.content,
      };
    }
  }
  const greeting = snap.messagesHost[0]?.content;
  return {
    ...(greeting !== undefined ? { previousContent: greeting } : {}),
  };
}

async function runApply(
  snap: DisplaySnapshot,
  args: SpindleDisplayScriptsArgs,
  recorder: VarReadRecorder,
  activationPatterns: ActivationPatternCache,
  cache: Map<string, SpindleDisplayResolveResult>,
  onEffect?: DisplayRuntimeEffectSink,
): Promise<string> {
  const ctx = args.context;
  const placement = ctx.isUser ? 'user_input' : 'ai_output';
  // Match the host execution pipeline's scope order; UI list sort numbers
  // overlap between global presets and character rules.
  const scopeOrder = { global: 0, character: 1, chat: 2 };
  const scripts = [...args.scripts as readonly FeRegexScript[]].sort(
    (a, b) => scopeOrder[a.scope ?? 'global'] - scopeOrder[b.scope ?? 'global'],
  );
  const prepared = await activationPatterns.resolve(scripts.filter(script => scriptApplies(script, ctx)), ctx, recorder.touched);
  // Lumiverse's compiler rejects invalid activation inputs per rule, leaving other rules runnable.
  const plan = buildModuleDisplayPlan(scripts.filter(script => {
    const result = prepared.get(script.id);
    if (!(result instanceof ActivationPatternError)) return true;
    log.error(`applyScripts: activation input failed for rule=${script.id}: ${String(result)}`);
    return false;
  }), snap.atActions);
  const hasRepeatBack = plan.some(
    (step) =>
      step.kind === 'script'
      && readRegexMatchActions(step.script.metadata).includes('repeat_back'),
  );
  const behaviorContext = hasRepeatBack
    ? displayBehaviorContext(snap, ctx)
    : {};
  if (hasRepeatBack) recorder.touched.add(MSG_DEP_KEY);
  let content = args.content;
  let nativeVariables: ReturnType<typeof createNativeVariableMacros> | undefined;
  const nativeEval = (text: string): string => {
    nativeVariables ??= createNativeVariableMacros(snap.vars, recorder.touched);
    return runPipeline(buildInput(snap, text, ctx), { recorder, resolveLeaf: nativeVariables });
  };

  // Risu processScriptFull caches after Lua/CBS, including evaluated <cbs> inputs.
  // Native rows stay live and split cache batches without changing execution order.
  for (let start = 0; start < plan.length;) {
    const risu = isRisuRegexScript(plan[start]!.script);
    let end = start + 1;
    while (end < plan.length && isRisuRegexScript(plan[end]!.script) === risu) end++;
    const reads: VarReadRecorder = risu ? { touched: new Set<string>(), volatile: false } : recorder;
    const key = risu ? JSON.stringify([
      snap.chatId, snap.characterId, resolveRisuDisplayMessageIndex(snap, ctx), start, content,
      plan.slice(start, end).map(step => [step.script, scriptApplies(step.script, ctx),
        (step.script.metadata?.['_risu'] as { flag_actions?: string[] } | undefined)?.flag_actions?.includes('cbs')
          ? evalTemplate(snap, step.script.find_regex, ctx, reads) : step.script.find_regex,
        step.kind === 'action' ? step.action : step.kind === 'skip' ? step.reason : null]),
    ]) : undefined;
    const cached = key === undefined ? undefined : cache.get(key);
    if (cached?.content) {
      content = cached.content;
      for (const dependency of cached.touchedVars ?? []) reads.touched.add(dependency);
      if (cached.cacheable === false) reads.volatile = true;
    } else {
      for (let index = start; index < end; index++) {
        const step = plan[index]!;
        if (step.kind === 'skip') {
          warnActionBinding(step.script.id, step.reason);
          continue;
        }
        if (step.kind === 'action') {
          if (!scriptApplies(step.script, ctx)) continue;
          const dependencies = getRuntimeAtActionDependencies(step.action);
          if (dependencies.messages) reads.touched.add(MSG_DEP_KEY);
          if (dependencies.effects) reads.volatile = true;
          content = await runEditDisplayAtActions(snap, content, ctx, [step.action], {
            resolveTemplate: text => evalTemplate(snap, text, ctx, reads),
            ...(onEffect ? { onEffect } : {}),
          });
          continue;
        }
        const coreScripts = [toCoreScript(step.script, nativeEval, prepared)];
        while (index + 1 < end && plan[index + 1]?.kind === 'script') {
          const next = plan[++index]!;
          if (next.kind === 'script') coreScripts.push(toCoreScript(next.script, nativeEval, prepared));
        }
        content = applyRegexScriptsCore(content, coreScripts, {
          placement,
          depth: ctx.depth,
          ...behaviorContext,
          evalTemplate: text => {
            try { return evalTemplate(snap, text, ctx, reads); }
            catch (err) { reads.volatile = true; throw err; }
          },
          reResolveAfterRule: true,
        });
      }
      if (key !== undefined) {
        cache.set(key, { content, touchedVars: [...reads.touched], cacheable: !reads.volatile });
        if (cache.size > 1000) cache.delete(cache.keys().next().value!);
      }
    }
    if (reads !== recorder) {
      for (const dependency of reads.touched) recorder.touched.add(dependency);
      if (reads.volatile) recorder.volatile = true;
    }
    start = end;
  }
  return content;
}

export function createDisplayResolver(
  writeback?: DisplayWritebackSink,
  onEffect?: DisplayRuntimeEffectSink,
  activationPatterns: ActivationPatternCache = createActivationPatternCache(),
): SpindleDisplayResolver & { resetScriptCache(): void } {
  const scriptCache = new Map<string, SpindleDisplayResolveResult>();
  return {
    resetScriptCache() { scriptCache.clear(); },
    ready(chatId: string): boolean {
      return isDisplayResolutionReady(chatId);
    },
    async resolveBody(args: SpindleDisplayBodyArgs): Promise<SpindleDisplayResolveResult | null> {
      const chatId = args.context.chatId;
      if (!chatId) return null;
      const snap = await getSnapshotOrWait(chatId);
      if (!snap) return null;

      let feContent: string;
      const recorder: VarReadRecorder = { touched: new Set<string>(), volatile: false };
      try {
        const rowlessAtActions = snap.atActions.filter(isRowlessAtAction);
        let liveSnap = (snap.luaTriggers.length > 0 || rowlessAtActions.length > 0)
          ? withCurrentDisplayMessage(snap, args.context, args.content)
          : snap;
        let body = parseDisplayCaller(buildInput(liveSnap, args.content, args.context), recorder);
        if (liveSnap.luaTriggers.length > 0) {
          // Risu ChatBody reruns parsing on input changes and GUI reloads, not persistence echoes.
          // Keep the host's outer render cache; every actual resolution still executes Lua.
          body = await runEditDisplayChain(
            liveSnap,
            body,
            args.context,
            (t) => {
              const current = getDisplaySnapshot(chatId);
              const source = current?.characterId === liveSnap.characterId ? current : liveSnap;
              return evaluate(t, buildEvaluatorContext({
                ...buildInput(source, t, args.context),
                recorder, commit: false, rmVar: false, runVar: false, cbsContext: false,
                reparseMacroResults: false, currentMessageIndexOverride: -1,
              }));
            },
            (vars) => writeback?.(chatId, vars),
            onEffect,
            // Same key shape as the CBS recorder so snapshot-diff invalidation
            // matches entries whose var reads happened inside Lua.
            (name, scope) => {
              if (scope === 'global') recorder.touched.add(`global:${name}`);
              else {
                recorder.touched.add(`chat:${name}`);
                recorder.touched.add(`local:${name}`);
              }
            },
            () => recorder.touched.add(MSG_DEP_KEY),
          );
          const current = getDisplaySnapshot(chatId);
          if (current?.characterId === liveSnap.characterId) {
            liveSnap = withCurrentDisplayMessage(current, args.context, args.content);
          }
        }
        const displayTriggerResult = await runDisplayTriggerChain(liveSnap, body);
        body = displayTriggerResult.content;
        if (displayTriggerResult.ran) recorder.volatile = true;
        body = runPipeline(buildInput(liveSnap, body, args.context), { recorder });
        if (rowlessAtActions.length > 0) {
          for (const action of rowlessAtActions) {
            const dependencies = getRuntimeAtActionDependencies(action);
            if (dependencies.messages) recorder.touched.add(MSG_DEP_KEY);
            if (dependencies.effects) recorder.volatile = true;
          }
          body = await runEditDisplayAtActions(
            liveSnap,
            body,
            args.context,
            rowlessAtActions,
            {
              resolveTemplate: (text) =>
                evalTemplate(liveSnap, text, args.context, recorder),
              ...(onEffect ? { onEffect } : {}),
            },
          );
        }
        feContent = body;
      } catch (err) {
        log.warn(`resolveBody: threw chat=${chatId}: ${String(err)}. Showing raw content.`);
        return null;
      }

      log.info(`resolveBody.dbg chat=${chatId} msg=${args.context.messageId ?? '?'} lua=${snap.luaTriggers.length} at=${snap.atActions.length} inMarks=[${dbgMarks(args.content)}] outMarks=[${dbgMarks(feContent)}] cacheable=${!recorder.volatile} touched=${recorder.touched.size}`);

      const mode = getDisplayResolutionMode();
      if (mode === 'shadow') {
        const beContent = await fetchBackendBody(
          chatId,
          args.context.messageId,
          args.context.role,
          args.content,
        );
        if (beContent !== feContent) {
          log.warn(
            `[shadow] body mismatch chat=${chatId} msg=${args.context.messageId ?? '?'} ` +
              `feLen=${feContent.length} beLen=${beContent.length} ` +
              `fe[0..160]=${JSON.stringify(feContent.slice(0, 160))} ` +
              `be[0..160]=${JSON.stringify(beContent.slice(0, 160))}`,
          );
        } else {
          log.trace(`[shadow] body match chat=${chatId} msg=${args.context.messageId ?? '?'} len=${feContent.length}`);
        }
        return { content: beContent };
      }

      return {
        content: feContent,
        touchedVars: [...recorder.touched],
        cacheable: !recorder.volatile,
      };
    },
    async resolveTemplates(args: SpindleDisplayTemplatesArgs): Promise<SpindleDisplayTemplatesResult | null> {
      const chatId = args.context.chatId;
      if (!chatId) return null;
      const snap = await getSnapshotOrWait(chatId);
      if (!snap) return null;

      const resolved: Record<string, string> = {};
      const touchedVars: Record<string, string[]> = {};
      const cacheable: Record<string, boolean> = {};
      try {
        for (const [key, template] of Object.entries(args.templates)) {
          const recorder: VarReadRecorder = { touched: new Set<string>(), volatile: false };
          resolved[key] = runPipeline(buildInput(snap, template, args.context), { recorder });
          touchedVars[key] = [...recorder.touched];
          cacheable[key] = !recorder.volatile;
        }
      } catch (err) {
        log.warn(`resolveTemplates: runPipeline threw chat=${chatId}: ${String(err)}. Showing raw content.`);
        return null;
      }

      const mode = getDisplayResolutionMode();
      if (mode === 'shadow') {
        const be = await fetchBackendTemplates(args.templates, args.context);
        for (const key of Object.keys(args.templates)) {
          const beVal = be[key];
          if (typeof beVal === 'string' && beVal !== resolved[key]) {
            log.warn(
              `[shadow] template mismatch chat=${chatId} key=${key} ` +
                `fe=${JSON.stringify((resolved[key] ?? '').slice(0, 120))} ` +
                `be=${JSON.stringify(beVal.slice(0, 120))}`,
            );
          }
        }
        return { resolved: { ...resolved, ...be } };
      }

      return { resolved, touchedVars, cacheable };
    },
    async applyScripts(args: SpindleDisplayScriptsArgs): Promise<SpindleDisplayResolveResult | null> {
      const chatId = args.context.chatId;
      if (!chatId) return null;
      const snap = await getSnapshotOrWait(chatId);
      if (!snap) return null;

      let feContent: string;
      const recorder: VarReadRecorder = { touched: new Set<string>(), volatile: false };
      try {
        feContent = await runApply(snap, args, recorder, activationPatterns, scriptCache, onEffect);
      } catch (err) {
        log.warn(`applyScripts: threw chat=${chatId}: ${String(err)}. Showing raw content.`);
        return null;
      }

      log.info(`applyScripts.dbg chat=${chatId} msg=${args.context.messageId ?? '?'} placement=${args.context.isUser ? 'user' : 'ai'} rules=${args.scripts.length} inMarks=[${dbgMarks(args.content)}] outMarks=[${dbgMarks(feContent)}] cacheable=${!recorder.volatile}`);

      const mode = getDisplayResolutionMode();
      if (mode === 'shadow') {
        const beContent = await fetchBackendApply(args);
        if (beContent === null) {
          return { content: feContent, touchedVars: [...recorder.touched], cacheable: !recorder.volatile };
        }
        if (beContent !== feContent) {
          log.warn(
            `[shadow] apply mismatch chat=${chatId} msg=${args.context.messageId ?? '?'} ` +
              `feLen=${feContent.length} beLen=${beContent.length} ` +
              `fe[0..160]=${JSON.stringify(feContent.slice(0, 160))} ` +
              `be[0..160]=${JSON.stringify(beContent.slice(0, 160))}`,
          );
        } else {
          log.trace(`[shadow] apply match chat=${chatId} msg=${args.context.messageId ?? '?'} len=${feContent.length}`);
        }
        return { content: beContent };
      }

      return {
        content: feContent,
        touchedVars: [...recorder.touched],
        cacheable: !recorder.volatile,
      };
    },
  };
}
