declare const spindle: any;

// Spindle macro registrations for Risu compatibility macros in Lumiverse prompt assembly.
// Allows Lumiverse native prompt assembly and Loom blocks to evaluate Risu-style expressions,
// calculations, boolean operators, and string utilities.

import { calcString } from '../risu-compat/risu-helpers.js';
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

export function registerSpindleMacros(): void {
  const MACRO_CATEGORY = 'extension:lumirealm';

  const macros = [
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
