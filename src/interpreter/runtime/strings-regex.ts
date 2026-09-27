// String operations and their Risu trigger evaluation boundaries.

import { toStr } from '../../util/coerce.js';
import type { TriggerEffect } from '../../core/schemas/triggerscript.js';
import type { VarsApi } from './vars.js';

// Risu runTrigger substitutes the result in three passes, unlike String.replace templates.
function formatResult(template: string, capture: (index: number) => string): string {
  return template.replace(/\$[0-9]+/g, token => capture(Number(token.slice(1))))
    .replace(/\$&/g, capture(0)).replace(/\$\$/g, '$');
}

export function extractRegex(value: unknown, regex: unknown, flags: unknown, result: unknown, v1 = false): string {
  const match = new RegExp(toStr(regex), toStr(flags)).exec(toStr(value));
  return formatResult(toStr(typeof result === 'function' ? result() : result), index => v1 ? match![index]! : match?.[index] || '');
}

export function regexTest(value: unknown, regex: unknown, flags: unknown): boolean {
  return new RegExp(toStr(regex), toStr(flags)).test(toStr(value));
}

export function replaceString(
  source: unknown, regex: unknown, result: unknown, replacement: unknown, flags: unknown,
): string {
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
}

// Risu runTrigger catches operand and destination errors, and re-reads the source on replacement failure.
export function runRegexEffect(vars: VarsApi, effect: TriggerEffect): void {
  const e = effect as Record<string, string>;
  const value = (key: string) => vars.resolve(e[key], e[key + 'Type'] === 'value' ? 'value' : 'var');
  const output = () => vars.resolve(e.outputVar, 'value');
  try {
    const result = effect.type === 'v2RegexTest'
      ? (regexTest(value('value'), value('regex'), value('flags')) ? '1' : '0')
      : replaceString(value('source'), value('regex'), value('result'), value('replacement'), value('flags'));
    vars.setVar(output(), result);
  } catch {
    const result = effect.type === 'v2RegexTest' ? '0' : value('source');
    vars.setVar(output(), result);
  }
}

export function random(min: unknown, max: unknown): number {
  const a = Number(min);
  const b = Number(max);
  return Math.floor(Math.random() * (b - a + 1) + a);
}

export function setCharAt(source: unknown, index: unknown, value: unknown): string {
  const chars = [...toStr(source)];
  chars[Number(index)] = toStr(value);
  return chars.join('');
}

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
