// Risu regex-action runtime. Raw module metadata describes semantics, while
// the corresponding live host row remains authoritative for editable fields.
// Risu source: process/scripts.ts.

import type { HostApi, HostMessage } from './host.js';
import { errMsg } from '../util/coerce.js';
import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('atActions.runForPhase');

export type AtAtActionKind =
  | 'replace'
  | 'emo'
  | 'inject'
  | 'move_top'
  | 'move_bottom'
  | 'repeat_back';

export type AtAtFlagAction =
  | 'inject'
  | 'move_top'
  | 'move_bottom'
  | 'repeat_back'
  | 'cbs'
  | 'no_end_nl';

export type AtAtPhase =
  | 'editinput'
  | 'editoutput'
  | 'editprocess'
  | 'editdisplay'
  | 'edittrans';

export interface RuntimeAtAtAction {
  readonly action: AtAtActionKind;
  /**
   * Direct `@@...` directive parsed from OUT. Flag actions can override the
   * matched branch while direct `@@repeat_back` remains an ordinary
   * replacement when the current text already matches.
   */
  readonly directAction?: Exclude<AtAtActionKind, 'replace'>;
  readonly flagActions?: readonly AtAtFlagAction[];
  readonly findRegex: string;
  readonly flag: string;
  readonly out: string;
  readonly phase: AtAtPhase;
  readonly order: number;
  readonly hasExplicitOrder?: boolean;
  /** Zero-based declaration index in its character or module source list. */
  readonly sourceIndex?: number;
  /** Zero-based index among module entries that produced installed host rows. */
  readonly sourceRowIndex?: number;
  readonly sourceOrigin?: string;
  /**
   * Stable installed row identity. When present, an absent live row means the
   * action was disabled or deleted and must not run.
   */
  readonly liveScriptId?: string;
}

export interface RunAtActionsCtx {
  readonly api: HostApi;
  // Risu frame: -1 for greeting, 0..N for chat.message[i].
  readonly chatIndex: number;
  readonly role?: HostMessage['role'];
  /** Risu reparses the full string after every ordinary matched replacement. */
  readonly resolveTemplate?: (text: string) => string | Promise<string>;
}

export interface LiveAtActionScript {
  readonly findRegex: string;
  readonly flag: string;
  readonly out: string;
  readonly phase?: AtAtPhase;
  readonly order?: number;
  readonly hasExplicitOrder?: boolean;
}

export interface RuntimeAtActionDependencies {
  readonly messages: boolean;
  readonly effects: boolean;
}

export function getRuntimeAtActionDependencies(
  action: RuntimeAtAtAction,
): RuntimeAtActionDependencies {
  const direct = action.directAction ?? inferDirectAction(action.out);
  const flags = action.flagActions ?? [];
  const inject = direct === 'inject' || flags.includes('inject');
  const repeat =
    direct === 'repeat_back' || flags.includes('repeat_back');
  return {
    messages: inject || repeat,
    effects: direct === 'emo' || inject,
  };
}

/**
 * Rebind semantic metadata to the current host row. The live row owns all
 * user-editable fields. Raw metadata contributes only Risu flag actions that
 * the host's JavaScript flag field cannot represent.
 *
 * Returns null when editing OUT removed the last action semantic.
 */
export function bindAtActionToLiveScript(
  raw: RuntimeAtAtAction,
  live: LiveAtActionScript,
): RuntimeAtAtAction | null {
  const directAction = inferDirectAction(live.out);
  const flagActions = raw.flagActions ?? [];
  const action = directAction ?? primaryFlagAction(flagActions);
  if (!action) return null;
  return {
    action,
    ...(directAction ? { directAction } : {}),
    ...(flagActions.length > 0 ? { flagActions } : {}),
    findRegex: live.findRegex,
    flag: live.flag,
    out: live.out,
    phase: live.phase ?? raw.phase,
    order: live.order ?? raw.order,
    ...((live.hasExplicitOrder ?? raw.hasExplicitOrder) === true
      ? { hasExplicitOrder: true }
      : {}),
    ...(raw.sourceIndex !== undefined
      ? { sourceIndex: raw.sourceIndex }
      : {}),
    ...(raw.sourceRowIndex !== undefined
      ? { sourceRowIndex: raw.sourceRowIndex }
      : {}),
    ...(raw.sourceOrigin !== undefined
      ? { sourceOrigin: raw.sourceOrigin }
      : {}),
    ...(raw.liveScriptId !== undefined
      ? { liveScriptId: raw.liveScriptId }
      : {}),
  };
}

export async function runAtActionsForPhase(
  actions: readonly RuntimeAtAtAction[],
  phase: AtAtPhase,
  data: string,
  ctx: RunAtActionsCtx,
): Promise<string> {
  const eligible = actions.filter((a) => a.phase === phase).slice();
  // Risu preserves declaration order unless at least one row uses <order N>.
  // Then higher values run first and stable sorting preserves ties.
  if (actions.some((a) => a.hasExplicitOrder === true)) {
    eligible.sort((a, b) => b.order - a.order);
  }
  if (eligible.length === 0) return data;

  log.info(
    `phase=${phase} eligible=${eligible.length} data_len=${data.length} chatIndex=${ctx.chatIndex}`,
  );

  let current = data;
  for (let i = 0; i < eligible.length; i++) {
    const action = eligible[i]!;
    try {
      current = await applyOne(action, current, ctx);
    } catch (err) {
      log.warn(
        `action[${i}] kind=${action.action} phase=${phase} THREW — ${errMsg(err)}; keeping prior data`,
      );
    }
  }
  return current;
}

async function applyOne(
  action: RuntimeAtAtAction,
  data: string,
  ctx: RunAtActionsCtx,
): Promise<string> {
  const flagActions = new Set(action.flagActions ?? []);
  const directAction =
    action.directAction ?? inferDirectAction(action.out);
  const moveTop =
    directAction === 'move_top' || flagActions.has('move_top');
  const moveBottom =
    directAction === 'move_bottom' || flagActions.has('move_bottom');
  const moveAction = moveTop || moveBottom;
  const rawFind =
    flagActions.has('cbs') && ctx.resolveTemplate
      ? await ctx.resolveTemplate(action.findRegex)
      : action.findRegex;
  const findRegex =
    typeof rawFind === 'string' ? rawFind : String(rawFind);
  let regexFlag = action.flag;
  // Risu strips g from move actions before compiling the expression.
  if (moveAction) regexFlag = regexFlag.replace(/g/g, '');
  regexFlag = sanitizeRegexFlag(regexFlag);

  let regex: RegExp;
  try {
    regex = new RegExp(findRegex, regexFlag);
  } catch (err) {
    throw new Error(
      `atAction ${action.action}: invalid regex /${findRegex}/${regexFlag} — ${(err as Error).message}`,
    );
  }

  const matched = regex.test(data);
  regex.lastIndex = 0;
  const outScript = normalizeOutScript(action.out, flagActions);

  if (matched) {
    if (directAction === 'emo') {
      const name = action.out.substring(6).trim();
      if (name) await setExpression(ctx.api, name);
      return data;
    }
    if (
      (directAction === 'inject' || flagActions.has('inject'))
      && ctx.chatIndex !== -1
    ) {
      await persistCurrentText(ctx, data);
      return data.replace(regex, '');
    }
    if (moveAction) {
      return applyMove(
        data,
        regex,
        outScript,
        moveTop ? 'move_top' : 'move_bottom',
      );
    }

    // repeat_back is special only when the current text does not match.
    const replaced = data.replace(regex, outScript);
    return ctx.resolveTemplate
      ? await ctx.resolveTemplate(replaced)
      : replaced;
  }

  if (
    (directAction === 'repeat_back' || flagActions.has('repeat_back'))
    && ctx.chatIndex !== -1
  ) {
    return applyRepeatBack(outScript, data, regex, ctx);
  }
  return data;
}

async function applyRepeatBack(
  outScript: string,
  data: string,
  regex: RegExp,
  ctx: RunAtActionsCtx,
): Promise<string> {
  // Risu selects the nearest prior same-role message, or the greeting when
  // none exists. It tests only that selected string.
  const messages = await ctx.api.chat.getMessages();
  const lumiIndex = ctx.chatIndex + 1;
  const targetRole = ctx.role ?? messages[lumiIndex]?.role;
  let priorContent = messages[0]?.content ?? '';
  for (let i = lumiIndex - 1; i >= 1; i--) {
    const message = messages[i];
    if (!message) continue;
    if (targetRole && message.role !== targetRole) continue;
    priorContent = message.content;
    break;
  }
  const priorMatch = priorContent.match(regex);
  if (!priorMatch) return data;
  const piece = priorMatch[0];
  const position = outScript.split(' ', 2)[1];
  if (!position) return data + piece;
  switch (position) {
    case 'start':
      return piece + data;
    case 'end':
      return data + piece;
    case 'start_nl':
      return piece + '\n' + data;
    case 'end_nl':
      return data + '\n' + piece;
    default:
      return data;
  }
}

async function setExpression(api: HostApi, name: string): Promise<void> {
  if (api.characters.setExpression) {
    await api.characters.setExpression(name);
    return;
  }
  if (api.chat.setExpression) {
    await api.chat.setExpression(name);
    return;
  }
  api.broadcast?.emit?.('risu:emotion', { name });
}

async function persistCurrentText(
  ctx: RunAtActionsCtx,
  data: string,
): Promise<void> {
  const messages = await ctx.api.chat.getMessages();
  const message = messages[ctx.chatIndex + 1];
  if (!message) return;
  await ctx.api.chat.editMessage(message.id, data);
}

function applyMove(
  data: string,
  regex: RegExp,
  outScript: string,
  direction: 'move_top' | 'move_bottom',
): string {
  const matched = data.match(regex);
  if (!matched) return data;
  const withoutMatch = data.replace(regex, '');
  const inData = matched[0];
  const out = stripMoveDirective(outScript)
    .replace(/(?<!\$)\$[0-9]+/g, (token) => {
      const index = Number.parseInt(token.slice(1), 10);
      return index < matched.length ? matched[index]! : token;
    })
    .replace(/\$\&/g, inData)
    // Preserve Risu's observable parseInt-before-named-group behavior.
    .replace(/(?<!\$)\$<([^>]+)>/g, (token, name: string) => {
      const groupName = Number.parseInt(name, 10);
      const groups = matched.groups as Record<string, string> | undefined;
      return groups?.[String(groupName)] || token;
    });
  return direction === 'move_top'
    ? `${out}\n${withoutMatch}`
    : `${withoutMatch}\n${out}`;
}

function stripMoveDirective(out: string): string {
  return out
    .replace('@@move_top ', '')
    .replace('@@move_bottom ', '');
}

function normalizeOutScript(
  out: string,
  flagActions: ReadonlySet<AtAtFlagAction>,
): string {
  let normalized = out.replaceAll('$n', '\n');
  if (normalized.endsWith('>') && !flagActions.has('no_end_nl')) {
    normalized += '\n';
  }
  return normalized;
}

function sanitizeRegexFlag(flag: string): string {
  const seen = new Set<string>();
  let normalized = '';
  for (const char of flag.trim()) {
    if (!'dgimsuvy'.includes(char) || seen.has(char)) continue;
    seen.add(char);
    normalized += char;
  }
  return normalized.length > 0 ? normalized : 'u';
}

function inferDirectAction(
  out: string,
): Exclude<AtAtActionKind, 'replace'> | undefined {
  if (out.startsWith('@@emo ')) return 'emo';
  if (out.startsWith('@@inject')) return 'inject';
  if (out.startsWith('@@move_top')) return 'move_top';
  if (out.startsWith('@@move_bottom')) return 'move_bottom';
  if (out.startsWith('@@repeat_back')) return 'repeat_back';
  return undefined;
}

export function coerceAtActions(
  raw: readonly unknown[],
): RuntimeAtAtAction[] {
  const out: RuntimeAtAtAction[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as {
      action?: unknown;
      findRegex?: unknown;
      out?: unknown;
      script?: {
        in?: unknown;
        out?: unknown;
        flag?: unknown;
        ableFlag?: unknown;
      };
      actions?: unknown;
      directAction?: unknown;
      flagActions?: unknown;
      flag?: unknown;
      phase?: unknown;
      order?: unknown;
      hasExplicitOrder?: unknown;
      index?: unknown;
      sourceIndex?: unknown;
      sourceRowIndex?: unknown;
      sourceOrigin?: unknown;
      runtime_origin?: unknown;
      liveScriptId?: unknown;
    } | null;
    if (!row || typeof row !== 'object') continue;
    const findRegex =
      typeof row.findRegex === 'string'
        ? row.findRegex
        : typeof row.script?.in === 'string'
          ? row.script.in
          : '';
    const outText =
      typeof row.out === 'string'
        ? row.out
        : typeof row.script?.out === 'string'
          ? row.script.out
          : '';
    if (!findRegex) continue;
    const normalizedSource = normalizeRuntimeFlag(
      typeof row.script?.flag === 'string'
        ? row.script.flag
        : undefined,
      Boolean(row.script?.ableFlag),
    );
    const flagActions = coerceFlagActions(
      Array.isArray(row.flagActions)
        ? row.flagActions
        : Array.isArray(row.actions)
          ? row.actions
          : normalizedSource.actions,
    );
    const declaredAction =
      isAtActionKind(row.action) ? row.action : undefined;
    const directAction =
      isDirectAction(row.directAction)
        ? row.directAction
        : declaredAction && declaredAction !== 'replace'
          ? declaredAction
          : inferDirectAction(outText);
    const action =
      declaredAction
      ?? directAction
      ?? primaryFlagAction(flagActions);
    if (!action) continue;
    const flag =
      typeof row.flag === 'string' ? row.flag : normalizedSource.flag;
    const phase = row.phase as AtAtPhase | undefined;
    if (!isAtActionPhase(phase)) continue;
    const hasExplicitOrder =
      typeof row.hasExplicitOrder === 'boolean'
        ? row.hasExplicitOrder
        : normalizedSource.order !== undefined;
    const order =
      hasExplicitOrder && typeof row.order === 'number'
        ? row.order
        : normalizedSource.order ?? 0;
    const sourceIndex =
      typeof row.sourceIndex === 'number'
        ? row.sourceIndex
        : typeof row.index === 'number'
          ? row.index
          : i;
    const sourceOrigin =
      typeof row.sourceOrigin === 'string'
        ? row.sourceOrigin
        : typeof row.runtime_origin === 'string'
          ? row.runtime_origin
          : 'character';
    const sourceRowIndex =
      typeof row.sourceRowIndex === 'number'
        ? row.sourceRowIndex
        : undefined;
    const liveScriptId =
      typeof row.liveScriptId === 'string' && row.liveScriptId.length > 0
        ? row.liveScriptId
        : undefined;
    out.push({
      action,
      ...(directAction ? { directAction } : {}),
      ...(flagActions.length > 0 ? { flagActions } : {}),
      findRegex,
      flag,
      out: outText,
      phase,
      order,
      ...(hasExplicitOrder ? { hasExplicitOrder: true } : {}),
      sourceIndex,
      ...(sourceRowIndex !== undefined ? { sourceRowIndex } : {}),
      sourceOrigin,
      ...(liveScriptId !== undefined ? { liveScriptId } : {}),
    });
  }
  return out;
}

/**
 * Runtime-only projection of attached-module scripts. These records carry
 * semantics and provenance only. They must be rebound to the corresponding
 * live host row and never executed independently.
 */
export function coerceAtActionsFromScripts(
  raw: readonly unknown[],
  sourceOrigin: string,
): RuntimeAtAtAction[] {
  const out: RuntimeAtAtAction[] = [];
  let sourceRowIndex = 0;
  for (let i = 0; i < raw.length; i++) {
    const script = raw[i] as {
      in?: unknown;
      out?: unknown;
      comment?: unknown;
      type?: unknown;
      flag?: unknown;
      ableFlag?: unknown;
    } | null;
    if (!script || typeof script !== 'object') continue;
    const findRegex =
      typeof script.in === 'string' ? script.in : '';
    const comment =
      typeof script.comment === 'string' ? script.comment : '';
    // The module installer creates one row per valid entry. Comment-only
    // dividers consume a row but carry no action.
    if (!findRegex && !comment) continue;
    const installedRowIndex = sourceRowIndex++;
    if (!findRegex) continue;
    const outText =
      typeof script.out === 'string' ? script.out : '';
    const phase = script.type as AtAtPhase | undefined;
    if (!isAtActionPhase(phase)) continue;
    const directAction = inferDirectAction(outText);
    const normalized = normalizeRuntimeFlag(
      typeof script.flag === 'string' ? script.flag : undefined,
      Boolean(script.ableFlag),
    );
    const action =
      directAction ?? primaryFlagAction(normalized.actions);
    if (!action) continue;
    out.push({
      action,
      ...(directAction ? { directAction } : {}),
      ...(normalized.actions.length > 0
        ? { flagActions: normalized.actions }
        : {}),
      findRegex,
      flag: normalized.flag,
      out: outText,
      phase,
      order: normalized.order ?? 0,
      ...(normalized.order !== undefined
        ? { hasExplicitOrder: true }
        : {}),
      sourceIndex: i,
      sourceRowIndex: installedRowIndex,
      sourceOrigin,
    });
  }
  return out;
}

function isAtActionPhase(phase: unknown): phase is AtAtPhase {
  return phase === 'editinput'
    || phase === 'editoutput'
    || phase === 'editprocess'
    || phase === 'editdisplay'
    || phase === 'edittrans';
}

function normalizeRuntimeFlag(
  rawFlag: string | undefined,
  ableFlag: boolean,
): {
  flag: string;
  actions: readonly AtAtFlagAction[];
  order?: number;
} {
  let raw = ableFlag ? (rawFlag ?? 'g') : 'g';
  let order: number | undefined;
  const actions: AtAtFlagAction[] = [];
  if (ableFlag && raw.includes('<')) {
    raw = raw.replace(/<(.+?)>/g, (_full, inner: string) => {
      for (const part of inner.split(',').map((value) => value.trim())) {
        if (part.startsWith('order ')) {
          const parsed = Number.parseInt(part.slice(6), 10);
          if (!Number.isNaN(parsed)) order = parsed;
          continue;
        }
        if (isAtFlagAction(part)) actions.push(part);
      }
      return '';
    });
  }
  const allowed = new Set('dgimsuvy');
  const seen = new Set<string>();
  let flag = '';
  for (const char of raw.trim()) {
    if (!allowed.has(char) || seen.has(char)) continue;
    seen.add(char);
    flag += char;
  }
  if (flag.length === 0) flag = 'u';
  return {
    flag,
    actions,
    ...(order !== undefined ? { order } : {}),
  };
}

function primaryFlagAction(
  actions: readonly AtAtFlagAction[],
): AtAtActionKind | undefined {
  if (actions.includes('inject')) return 'inject';
  if (actions.includes('move_top')) return 'move_top';
  if (actions.includes('move_bottom')) return 'move_bottom';
  if (actions.includes('repeat_back')) return 'repeat_back';
  if (actions.includes('cbs') || actions.includes('no_end_nl')) {
    return 'replace';
  }
  return undefined;
}

function coerceFlagActions(raw: readonly unknown[]): AtAtFlagAction[] {
  const out: AtAtFlagAction[] = [];
  for (const value of raw) {
    if (isAtFlagAction(value)) out.push(value);
  }
  return out;
}

function isAtFlagAction(value: unknown): value is AtAtFlagAction {
  return value === 'inject'
    || value === 'move_top'
    || value === 'move_bottom'
    || value === 'repeat_back'
    || value === 'cbs'
    || value === 'no_end_nl';
}

function isAtActionKind(value: unknown): value is AtAtActionKind {
  return value === 'replace' || isDirectAction(value);
}

function isDirectAction(
  value: unknown,
): value is Exclude<AtAtActionKind, 'replace'> {
  return value === 'emo'
    || value === 'inject'
    || value === 'move_top'
    || value === 'move_bottom'
    || value === 'repeat_back';
}
