declare const spindle: any;

// Spindle macro registrations for Risu compatibility macros in Lumiverse prompt assembly.
// Allows Lumiverse native prompt assembly and Loom blocks to evaluate Risu-style expressions,
// calculations, boolean operators, and string utilities.

import { calcString } from '../risu-compat/risu-helpers.js';
import { collectLegacyGlobals, mergeEffectiveGlobals, readTogglePreferences } from '../state/toggle-preferences.js';
import { presetToggleValues } from '../state/preset-toggle-values.js';
import { readChatAuthorsNote } from '../state/authors-note-cache.js';
import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('spindle-macros');

interface MacroContext {
  args: string[];
  env: {
    variables: {
      local: Map<string, string>;
      global: Map<string, string>;
      chat: Map<string, string>;
    };
    extra?: Record<string, unknown>;
  };
}

function getArg(ctx: unknown, index: number): string {
  const args = (ctx as { args?: string[] })?.args;
  if (Array.isArray(args)) {
    return args[index] == null ? '' : String(args[index]);
  }
  return '';
}

function getArgs(ctx: unknown): string[] {
  const args = (ctx as { args?: string[] })?.args;
  if (Array.isArray(args)) {
    return args.map((a) => (a == null ? '' : String(a)));
  }
  return [];
}

function isTruthy(val: string): boolean {
  const s = String(val == null ? '' : val).trim().toLowerCase();
  return s === '1' || s === 'true';
}

function evalRisuCalc(ctx: unknown): string {
  const expr = getArg(ctx, 0);
  if (!expr) return '0';
  const c = ctx as MacroContext;
  const readLocal = (name: string): string => {
    return c?.env?.variables?.local?.get?.(name) ?? '';
  };
  const readGlobal = (name: string): string => {
    return c?.env?.variables?.global?.get?.(name) ?? '';
  };
  try {
    const num = calcString(expr, readLocal, readGlobal);
    return Number.isFinite(num) ? String(num) : '0';
  } catch {
    return '0';
  }
}

// ─── Effective global variables (`{{getglobalvar::}}` parity) ────────────────

// One preset block can contain hundreds of toggle lookups and every occurrence
// is an extension-macro round trip, so the preference file is memoized per user
// instead of re-read each time. The toggle-write path invalidates the entry, so
// a single window is always exact; the short TTL only bounds staleness when
// another browser session of the same user changes the file.
const PREFERENCE_CACHE_TTL_MS = 2000;
const preferenceCache = new Map<string, { at: number; value: Record<string, string> | null }>();

/** Drop the memoized toggle preferences for one user, or for every user. */
export function invalidateToggleMacroCache(userId?: string): void {
  if (userId === undefined) preferenceCache.clear();
  else preferenceCache.delete(userId);
}

async function readPreferencesCached(userId: string): Promise<Record<string, string> | null> {
  const now = Date.now();
  const hit = preferenceCache.get(userId);
  if (hit && now - hit.at < PREFERENCE_CACHE_TTL_MS) return hit.value;
  const value = await readTogglePreferences(userId);
  preferenceCache.set(userId, { at: now, value });
  return value;
}

// The worker host serializes `env.variables.*` as plain objects; in-process
// callers (tests, dry runs) pass Maps. Accept both shapes.
function varRecord(raw: unknown): Record<string, unknown> | null {
  if (raw instanceof Map) return Object.fromEntries(raw as Map<string, unknown>);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

// Preset layer of the effective-globals overlay. Host preset blocks are
// evaluated with sourceOwner "host", which skips the macro interceptor that
// records the per-chat snapshot, so prefer the snapshot the host resolved for
// this evaluation and use the recorded one only when this evaluation carries
// no snapshot.
function presetToggleLayer(
  ctx: unknown,
  promptVariables: Record<string, unknown> | null,
  userId: string,
): Record<string, string> {
  if (promptVariables) return collectLegacyGlobals({ promptVariables });
  const chatId = readChatId(ctx);
  return chatId ? presetToggleValues(chatId, userId) : {};
}

// `env.chat.id` is the chat this evaluation belongs to; the worker host also
// mirrors it onto the invocation context it posts to the extension.
function readChatId(ctx: unknown): string {
  const c = ctx as { chatId?: unknown; env?: { chat?: { id?: unknown } } };
  for (const candidate of [c?.env?.chat?.id, c?.chatId]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

/**
 * Read one global variable with the same effective-globals overlay LumiRealm's
 * own engine applies to `{{getglobalvar::…}}`: the preset values the host
 * resolved for this evaluation, then the chat globals
 * (`macro_variables.global`), then the user's persisted State → Toggles
 * preferences.
 *
 * Preset blocks are evaluated by the HOST macro engine (sourceOwner: "host"),
 * which cannot see the extension's preference store, so translated global
 * lookups must be resolved here. Unset names resolve to the literal `null`
 * (Risu chatVar parity, matching `interpreter/evaluator/context.ts`).
 */
async function resolveGlobalVarMacro(ctx: unknown): Promise<string> {
  const key = getArg(ctx, 0).trim();
  if (!key) return '';
  const env = (ctx as { env?: { variables?: Record<string, unknown>; extra?: Record<string, unknown> } })?.env;
  const promptVariables = varRecord(env?.extra?.['promptVariables']);
  const legacy = collectLegacyGlobals({
    global: varRecord(env?.variables?.['global']),
    local: varRecord(env?.variables?.['local']),
    promptVariables,
  });
  const userId = typeof env?.extra?.['userId'] === 'string' ? (env.extra['userId'] as string) : '';
  if (!userId) return legacy[key] ?? 'null';
  try {
    const presetToggles = presetToggleLayer(ctx, promptVariables, userId);
    return mergeEffectiveGlobals(legacy, await readPreferencesCached(userId), presetToggles)[key] ?? 'null';
  } catch (err) {
    log.warn(
      `risuGlobalVar(${key}): toggle preference read failed, using chat globals: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return legacy[key] ?? 'null';
  }
}

// ─── Chat author's note (`{{authornote}}`) ───────────────────────────────────

// The host engine has no author's-note slot, so the translated `{{authornote}}`
// needs one. The reader and its per-chat memo live in state/authors-note-cache,
// which LumiRealm's own author's-note writer also invalidates.
async function resolveAuthornoteMacro(ctx: unknown): Promise<string> {
  const chatId = readChatId(ctx);
  if (!chatId) return '';
  const env = (ctx as { env?: { extra?: Record<string, unknown> } })?.env;
  const userId = typeof env?.extra?.['userId'] === 'string' ? (env.extra['userId'] as string) : '';
  try {
    return await readChatAuthorsNote(chatId, userId);
  } catch (err) {
    // A failed metadata read must not break the host engine: an unresolved slot
    // is worse than a note-less prompt.
    log.warn(
      `authornote(${chatId}): chat metadata read failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
}

// ─── Chat history reads (`{{previous_chat_log::N}}`) ─────────────────────────

// Risu's previouschatlog reads chat.message[Number(arg)] (cbs.ts), the same
// array its lastmessageid counts. The host already serializes that array onto
// env.extra.messages, so the read is served from it: one frame with
// {{lastmessageid}}, one source of truth, and no RPC per occurrence.
function resolveChatLogMacro(ctx: unknown): string {
  const env = (ctx as { env?: { extra?: Record<string, unknown> } })?.env;
  const messages = env?.extra?.['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    const userId = typeof env?.extra?.['userId'] === 'string' ? (env.extra['userId'] as string) : '';
    log.warn(
      `previous_chat_log(${readChatId(ctx) || 'no-chat'}/${userId || 'no-user'}): ` +
        'no chat history in this evaluation',
    );
    return '';
  }
  // Risu indexes with Number(args[0]): a bare macro and a non numeric argument
  // are NaN, which selects no message, and a negative index is not wrapped to
  // the end of the list. A message that does not exist yields "" rather than
  // Risu's "Out of range" sentinel, so a caller's {{contains::}} gate still
  // evaluates and no sentinel text can reach the prompt.
  const args = (ctx as { args?: unknown[] })?.args;
  const index = Array.isArray(args) && args.length > 0 ? Number(args[0]) : Number.NaN;
  const content = (messages as ReadonlyArray<{ content?: unknown } | null>)[index]?.content;
  return typeof content === 'string' ? content : '';
}

export function registerSpindleMacros(): void {
  const MACRO_CATEGORY = 'extension:lumirealm';

  const macros = [
    {
      name: 'risuGlobalVar',
      aliases: ['lumirealmGlobalVar'],
      category: MACRO_CATEGORY,
      description: "Reads a Risu global variable, overlaying the user's persisted State → Toggles preferences on the chat globals.",
      returnType: 'string',
      handler: (ctx: unknown) => resolveGlobalVarMacro(ctx),
    },
    {
      name: 'risuCalc',
      aliases: ['cbsCalc', 'littleDevilCalc'],
      category: MACRO_CATEGORY,
      description: 'Evaluates RisuAI math/boolean expressions (+, -, *, /, ^, %, <, >, <=, >=, =, !=, &, |, !).',
      returnType: 'number',
      handler: (ctx: unknown) => evalRisuCalc(ctx),
    },
    {
      name: 'risuContains',
      aliases: ['littleDevilContains'],
      category: MACRO_CATEGORY,
      description: 'Case-sensitive substring matching (returns 1 or 0).',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        const text = getArg(ctx, 0);
        const needle = getArg(ctx, 1);
        return text.includes(needle) ? '1' : '0';
      },
    },
    {
      name: 'risuLength',
      aliases: ['littleDevilLength'],
      category: MACRO_CATEGORY,
      description: 'Returns length of string.',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        return String(getArg(ctx, 0).length);
      },
    },
    {
      name: 'risuNot',
      aliases: ['littleDevilNot'],
      category: MACRO_CATEGORY,
      description: 'Boolean negation (returns 1 or 0).',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        return isTruthy(getArg(ctx, 0)) ? '0' : '1';
      },
    },
    {
      name: 'risuAnd',
      aliases: ['littleDevilAnd'],
      category: MACRO_CATEGORY,
      description: 'Variadic boolean AND (returns 1 or 0).',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        const args = getArgs(ctx);
        return args.length === 0 || args.every(isTruthy) ? '1' : '0';
      },
    },
    {
      name: 'risuOr',
      aliases: ['littleDevilOr'],
      category: MACRO_CATEGORY,
      description: 'Variadic boolean OR (returns 1 or 0).',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        return getArgs(ctx).some(isTruthy) ? '1' : '0';
      },
    },
    {
      name: 'risuAny',
      category: MACRO_CATEGORY,
      description: 'Variadic boolean OR / any truthy (returns 1 or 0).',
      returnType: 'integer',
      handler: (ctx: unknown) => {
        return getArgs(ctx).some(isTruthy) ? '1' : '0';
      },
    },
    {
      name: 'previous_chat_log',
      // Risu's primary spelling for the same macro (cbs.ts previouschatlog).
      aliases: ['previouschatlog'],
      category: MACRO_CATEGORY,
      description: 'Reads one message of the chat history by index, like Risu chat.message[INDEX].',
      returnType: 'string',
      handler: (ctx: unknown) => resolveChatLogMacro(ctx),
    },
    {
      name: 'authornote',
      // Risu's own alias for the same macro (cbs.ts authornote/author_note).
      aliases: ['author_note'],
      category: MACRO_CATEGORY,
      description: "Reads the chat's author's note (chat metadata authors_note.content).",
      returnType: 'string',
      handler: (ctx: unknown) => resolveAuthornoteMacro(ctx),
    },
  ];

  for (const m of macros) {
    try {
      spindle.registerMacro({
        name: m.name,
        category: m.category,
        description: m.description,
        returnType: m.returnType,
        handler: m.handler,
      });
      if (m.aliases) {
        for (const alias of m.aliases) {
          spindle.registerMacro({
            name: alias,
            category: m.category,
            description: m.description,
            returnType: m.returnType,
            handler: m.handler,
          });
        }
      }
    } catch (err) {
      log.warn(`Failed to register macro ${m.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info(`Registered ${macros.length} Spindle compatibility macros for Lumiverse prompt assembly`);
}
