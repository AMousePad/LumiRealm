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
import type { VarReadRecorder } from '../interpreter/evaluator/context.js';
import { makeSafeLogger } from '../util/safe-log.js';
import {
  getDisplaySnapshot,
  getDisplayResolutionMode,
  isDisplayResolutionReady,
  waitForSnapshot,
  type DisplaySnapshot,
} from './snapshot.js';
import { type FeRegexScript } from './regex-apply.js';
import { applyRegexScriptsCore, type RegexCoreScript } from './regex-core.js';
import { runEditDisplayChain, runEditDisplayAtActions } from './lua-runner.js';
import { withCurrentDisplayMessage } from './host-shim.js';
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
  const dyn = context.dynamicMacros;
  const lastIdx = snap.chat.messages.length - 1;
  const chatIndexStr = dyn?.chat_index;
  // Lumi's message index includes the greeting at zero. Risu's chat.message[]
  // does not, so its Chat.svelte index is one less.
  const idxOverride = typeof context.messageIndex === 'number'
    ? context.messageIndex - 1
    : (typeof chatIndexStr === 'string' && /^-?\d+$/.test(chatIndexStr)
      ? parseInt(chatIndexStr, 10) - 1
      : (typeof context.depth === 'number' && context.depth >= 0
        ? lastIdx - context.depth
        : undefined));
  const role = context.role ?? dyn?.role;
  return {
    template: content,
    phase: 'display',
    // Risu Chat.svelte renders with rmVar: the setvar family hides, never executes.
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
    ...(idxOverride !== undefined ? { currentMessageIndexOverride: idxOverride } : {}),
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

function runApply(
  snap: DisplaySnapshot,
  args: SpindleDisplayScriptsArgs,
  recorder: VarReadRecorder,
): string {
  const ctx = args.context;
  const placement = ctx.isUser ? 'user_input' : 'ai_output';
  const scripts = args.scripts as readonly FeRegexScript[];

  const coreScripts: RegexCoreScript[] = scripts.map((script) => {
    const preFind = args.resolvedFindPatterns?.[script.id];
    const preReplace = args.resolvedReplacements?.[script.id];
    return {
      find_regex: script.find_regex,
      replace_string: script.replace_string,
      flags: script.flags,
      substitute_macros: script.substitute_macros,
      placement: script.placement,
      target: 'display',
      min_depth: script.min_depth,
      max_depth: script.max_depth,
      trim_strings: script.trim_strings,
      ...(script.disabled !== undefined ? { disabled: script.disabled } : {}),
      ...(preFind !== undefined ? { preResolvedFind: preFind } : {}),
      ...(preReplace !== undefined ? { preResolvedReplace: preReplace } : {}),
    };
  });

  return applyRegexScriptsCore(args.content, coreScripts, {
    placement,
    depth: ctx.depth,
    evalTemplate: (text) => {
      try {
        return evalTemplate(snap, text, ctx, recorder);
      } catch (err) {
        recorder.volatile = true;
        throw err;
      }
    },
    reResolveAfterRule: true,
  });
}

export function createDisplayResolver(writeback?: DisplayWritebackSink): SpindleDisplayResolver {
  return {
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
        const liveSnap = (snap.luaTriggers.length > 0 || snap.atActions.length > 0)
          ? withCurrentDisplayMessage(snap, args.context, args.content)
          : snap;
        let body = args.content;
        if (liveSnap.luaTriggers.length > 0) {
          body = runPipeline(buildInput(liveSnap, body, args.context), { recorder });
          body = await runEditDisplayChain(
            liveSnap,
            body,
            args.context,
            (t) => Promise.resolve(runPipeline(buildInput(liveSnap, t, args.context), { recorder })),
            (vars) => writeback?.(chatId, vars),
          );
        }
        if (liveSnap.atActions.length > 0) {
          body = await runEditDisplayAtActions(liveSnap, body, args.context);
        }
        feContent = runPipeline(buildInput(liveSnap, body, args.context), { recorder });
      } catch (err) {
        log.warn(`resolveBody: threw chat=${chatId}: ${String(err)}. Deferring to backend.`);
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
        log.warn(`resolveTemplates: runPipeline threw chat=${chatId}: ${String(err)}. Deferring to backend.`);
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
        feContent = runApply(snap, args, recorder);
      } catch (err) {
        log.warn(`applyScripts: threw chat=${chatId}: ${String(err)}. Deferring to backend.`);
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
