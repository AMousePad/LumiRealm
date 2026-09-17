// Pure string, regex, and arithmetic helpers.

import { toStr } from '../../util/coerce.js';
import { calcString } from './calc.js';

// Risu runTrigger substitutes the result in three passes, unlike String.replace templates.
function formatResult(template: string, capture: (index: number) => string): string {
  return template.replace(/\$[0-9]+/g, token => capture(Number(token.slice(1))))
    .replace(/\$&/g, capture(0)).replace(/\$\$/g, '$');
}

export function extractRegex(value: unknown, regex: unknown, flags: unknown, result: unknown, v1 = false): string {
  const match = new RegExp(toStr(regex), toStr(flags)).exec(toStr(value));
  return formatResult(toStr(result), index => v1 ? match![index]! : match?.[index] || '');
}

export function regexTest(value: unknown, regex: unknown, flags: unknown): boolean {
  try { return new RegExp(toStr(regex), toStr(flags)).test(toStr(value)); }
  catch { return false; }
}

export function replaceString(
  source: unknown, regex: unknown, result: unknown, replacement: unknown, flags: unknown,
): string {
  try {
    const reg = new RegExp(toStr(regex), toStr(flags));
    const str = toStr(source);
    const format = toStr(result);
    return str.replace(reg, (...args) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2);
      const target = format.match(/^\$(\d+)$/);
      if (target) {
        const index = Number(target[1]);
        if (index === 0) return toStr(replacement);
        if (groups[index - 1]) return match.replace(groups[index - 1], toStr(replacement));
      }
      return formatResult(format, index => index === 0 ? match : groups[index - 1] || '');
    });
  } catch { return toStr(source); }
}

export function random(min: unknown, max: unknown): number {
  const a = Number(min) || 0;
  const b = Number(max) || 0;
  if (a === b) return a;
  return Math.floor(a + Math.random() * (b - a + 1));
}

export function setCharAt(source: unknown, index: unknown, value: unknown): string {
  const chars = [...toStr(source)];
  chars[Number(index)] = toStr(value);
  return chars.join('');
}

export function calculate(expr: unknown): string { return calcString(toStr(expr)); }

export function splitString(source: unknown, delimiter: unknown, kind?: string): readonly string[] {
  let d: string | RegExp = toStr(delimiter);
  if (kind === 'regex') {
    try {
      const literal = d.match(/^\/(.+)\/([gimuy]*)$/);
      d = literal ? new RegExp(literal[1]!, literal[2]) : new RegExp(d);
    } catch { return [toStr(source)]; }
  }
  return toStr(source).split(d);
}
