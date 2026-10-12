import type { FeRegexMatch } from '../../src/display/regex-apply.js';
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
