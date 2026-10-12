import type { NativeRegexAction } from './regex-actions.js';

export type FeRegexMode = 'none' | 'find' | 'raw' | 'after' | 'escaped';

export interface FeRegexScript {
  readonly id: string;
  readonly name?: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly placement: readonly string[];
  readonly scope?: 'global' | 'character' | 'chat';
  readonly substitute_macros: FeRegexMode;
  readonly trim_strings: readonly string[];
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly disabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly preset_id?: string | null;
  readonly actions?: readonly NativeRegexAction[];
}

export interface FeRegexMatch {
  readonly fullMatch: string;
  readonly index: number;
  readonly groups: (string | undefined)[];
  readonly namedGroups?: Record<string, string | undefined>;
}

export function isRisuRegexScript(script: FeRegexScript): boolean {
  const source = script.metadata?.['_risu'];
  return source !== null && typeof source === 'object' && !Array.isArray(source);
}

export function compileRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function substituteRegexCaptures(
  template: string,
  fullMatch: string,
  groups: (string | undefined)[],
  offset: number,
  input: string,
  namedGroups?: Record<string, string | undefined>,
): string {
  return template.replace(
    /\$(?:(\$)|(&)|(`)|(')|(\d{1,2})|<([^>]*)>)/g,
    (token, dollar, amp, backtick, quote, digits, name) => {
      if (dollar !== undefined) return '$';
      if (amp !== undefined) return fullMatch;
      if (backtick !== undefined) return input.slice(0, offset);
      if (quote !== undefined) return input.slice(offset + fullMatch.length);
      if (digits !== undefined) {
        const idx = Number.parseInt(digits, 10);
        if (idx >= 1 && idx <= groups.length) return groups[idx - 1] ?? '';
        return token;
      }
      if (name !== undefined && namedGroups) {
        return Object.prototype.hasOwnProperty.call(namedGroups, name)
          ? namedGroups[name] ?? ''
          : token;
      }
      return token;
    },
  );
}

export function applyTrimStrings(result: string, trims: readonly string[]): string {
  let out = result;
  for (const trim of trims) {
    if (!trim) continue;
    while (out.includes(trim)) out = out.replaceAll(trim, '');
  }
  return out;
}
