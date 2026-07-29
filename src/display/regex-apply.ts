export type FeRegexMode = 'none' | 'raw' | 'after' | 'escaped';

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

export function compileRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function collectMatches(content: string, regex: RegExp): FeRegexMatch[] {
  const re = new RegExp(regex.source, regex.flags);
  const matches: FeRegexMatch[] = [];
  const push = (m: RegExpExecArray): void => {
    matches.push({
      fullMatch: m[0],
      index: m.index,
      groups: Array.from(m).slice(1),
      ...(m.groups ? { namedGroups: m.groups } : {}),
    });
  };
  if (re.global || re.sticky) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      push(m);
      if (m[0].length === 0) re.lastIndex++;
    }
  } else {
    const m = re.exec(content);
    if (m) push(m);
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
