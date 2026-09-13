declare const spindle: any;

// Spindle macro registrations for Risu compatibility macros in Lumiverse prompt assembly.
// Allows Lumiverse native prompt assembly and Loom blocks to evaluate Risu-style expressions,
// calculations, boolean operators, and string utilities.

import { calcString } from '../risu-compat/risu-helpers.js';
import { collectLegacyGlobals, mergeEffectiveGlobals, readTogglePreferences } from '../state/toggle-preferences.js';
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

/**
 * Read one global variable with the same effective-globals overlay LumiRealm's
 * own engine applies to `{{getglobalvar::…}}`: the chat globals
 * (`macro_variables.global`) overlaid with the user's persisted
 * State → Toggles preferences.
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
  const legacy = collectLegacyGlobals({
    global: varRecord(env?.variables?.['global']),
    local: varRecord(env?.variables?.['local']),
    promptVariables: varRecord(env?.extra?.['promptVariables']),
  });
  const userId = typeof env?.extra?.['userId'] === 'string' ? (env.extra['userId'] as string) : '';
  if (!userId) return legacy[key] ?? 'null';
  try {
    return mergeEffectiveGlobals(legacy, await readPreferencesCached(userId))[key] ?? 'null';
  } catch (err) {
    log.warn(
      `risuGlobalVar(${key}): toggle preference read failed, using chat globals: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return legacy[key] ?? 'null';
  }
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
