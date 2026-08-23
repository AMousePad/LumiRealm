export type FeRegexMode = 'none' | 'find' | 'raw' | 'after' | 'escaped';

export interface FeRegexScript {
  readonly id: string;
  readonly name?: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly placement: readonly string[];
  readonly substitute_macros: FeRegexMode;
  readonly trim_strings: readonly string[];
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly disabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FeRegexMatch {
  readonly fullMatch: string;
  readonly index: number;
  readonly groups: (string | undefined)[];
  readonly namedGroups?: Record<string, string>;
}

// Compiled-regex cache. applyRegexScriptsCore compiles once per script per
// message resolve — O(scripts) regex constructions per streaming token was a
// measurable main-thread cost. Instances are SHARED: callers must not leave
// lastIndex drifted (collectMatches and applyMatchActions both hard-reset it).
const COMPILED_REGEX_CACHE_CAP = 256;
const compiledRegexCache = new Map<string, RegExp | null>();

export function compileRegex(pattern: string, flags: string): RegExp | null {
  const key = `${flags}\u0000${pattern}`;
  const cached = compiledRegexCache.get(key);
  if (cached !== undefined) return cached;
  let re: RegExp | null;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    re = null;
  }
  compiledRegexCache.set(key, re);
  while (compiledRegexCache.size > COMPILED_REGEX_CACHE_CAP) {
    const oldest = compiledRegexCache.keys().next().value;
    if (oldest === undefined) break;
    compiledRegexCache.delete(oldest);
  }
  return re;
}

export function collectMatches(content: string, regex: RegExp): FeRegexMatch[] {
  const matches: FeRegexMatch[] = [];
  const push = (m: RegExpExecArray): void => {
    matches.push({
      fullMatch: m[0],
      index: m.index,
      groups: Array.from(m).slice(1),
      ...(m.groups ? { namedGroups: m.groups } : {}),
    });
  };
  // Exec the shared cached instance in place instead of recompiling a throwaway
  // clone per call. A global/sticky exec loop restores lastIndex to 0 on the
  // terminating failed match; the finally block guarantees it regardless.
  const savedLastIndex = regex.lastIndex;
  regex.lastIndex = 0;
  try {
    if (regex.global || regex.sticky) {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        push(m);
        if (m[0].length === 0) regex.lastIndex++;
      }
    } else {
      const m = regex.exec(content);
      if (m) push(m);
    }
  } finally {
    regex.lastIndex = savedLastIndex;
  }
  return matches;
}

export function substituteRegexCaptures(
  template: string,
  fullMatch: string,
  groups: (string | undefined)[],
  offset: number,
  input: string,
  namedGroups?: Record<string, string>,
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
      if (name !== undefined && namedGroups) return namedGroups[name] ?? token;
      return token;
    },
  );
}

export function rebuildFromMatches(
  content: string,
  matches: readonly FeRegexMatch[],
  replacements: readonly string[],
): string {
  let out = '';
  let lastIdx = 0;
  for (let i = 0; i < matches.length; i++) {
    out += content.slice(lastIdx, matches[i]!.index);
    out += replacements[i]!;
    lastIdx = matches[i]!.index + matches[i]!.fullMatch.length;
  }
  out += content.slice(lastIdx);
  return out;
}

export function applyTrimStrings(result: string, trims: readonly string[]): string {
  let out = result;
  for (const trim of trims) {
    if (!trim) continue;
    while (out.includes(trim)) out = out.replaceAll(trim, '');
  }
  return out;
}
