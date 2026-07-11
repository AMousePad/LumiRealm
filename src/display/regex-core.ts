import {
  compileRegex,
  collectMatches,
  substituteRegexCaptures,
  rebuildFromMatches,
  applyTrimStrings,
} from './regex-apply.js';

export interface RegexCoreScript {
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly substitute_macros: 'none' | 'escaped' | 'after' | 'raw';
  readonly placement: readonly string[];
  readonly target: string;
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly trim_strings: readonly string[];
  readonly disabled?: boolean;
  readonly preResolvedFind?: string;
  readonly preResolvedReplace?: string;
}

export interface ApplyRegexCoreOptions {
  readonly placement: string;
  readonly depth: number | undefined;
  readonly evalTemplate: (text: string) => string;
  // Risu re-parses CBS after every script. Fires only when the rule changed
  // the text and the result carries CBS syntax.
  readonly reResolveAfterRule?: boolean;
}

const LEGACY_NAME_TAG_RE = /<(user|char|bot)>/i;

// Mirrors the evaluator's trigger set, including tags it normalizes at entry.
function hasCbsSyntax(s: string): boolean {
  return s.includes("{{") || s.includes("{#") || LEGACY_NAME_TAG_RE.test(s);
}

export function applyRegexScriptsCore(
  content: string,
  scripts: readonly RegexCoreScript[],
  opts: ApplyRegexCoreOptions,
): string {
  const { placement, depth, evalTemplate, reResolveAfterRule } = opts;
  let result = content;

  for (const script of scripts) {
    if (script.disabled === true) continue;
    if (!script.placement.includes(placement)) continue;
    if (depth !== undefined) {
      if (script.min_depth !== null && depth < script.min_depth) continue;
      if (script.max_depth !== null && depth > script.max_depth) continue;
    }

    const before = result;
    let findRegex = script.find_regex;
    if (script.preResolvedFind !== undefined) {
      findRegex = script.preResolvedFind;
    } else if (script.substitute_macros !== 'none') {
      findRegex = evalTemplate(findRegex);
    }

    const regex = compileRegex(findRegex, script.flags);
    if (!regex) continue;

    try {
      if (script.substitute_macros === 'raw') {
        const matches = collectMatches(result, regex);
        if (matches.length > 0) {
          const replacements = matches.map((m) => {
            const withCaptures = substituteRegexCaptures(
              script.replace_string, m.fullMatch, m.groups, m.index, result, m.namedGroups,
            );
            return evalTemplate(withCaptures);
          });
          result = rebuildFromMatches(result, matches, replacements);
        }
      } else if (script.substitute_macros === 'after') {
        const substituted = result.replace(regex, script.replace_string);
        result = evalTemplate(substituted);
      } else {
        let replaceString = script.replace_string;
        if (script.preResolvedReplace !== undefined) {
          replaceString = script.substitute_macros === 'escaped'
            ? script.preResolvedReplace.replace(/\$/g, '$$$$')
            : script.preResolvedReplace;
        } else if (script.substitute_macros !== 'none') {
          const resolved = evalTemplate(replaceString);
          replaceString = script.substitute_macros === 'escaped'
            ? resolved.replace(/\$/g, '$$$$')
            : resolved;
        }
        result = result.replace(regex, replaceString);
      }

      result = applyTrimStrings(result, script.trim_strings);

      if (
        reResolveAfterRule
        && script.substitute_macros !== 'after'
        && script.substitute_macros !== 'raw'
        && result !== before
        && hasCbsSyntax(result)
      ) {
        result = evalTemplate(result);
      }
    } catch {
      continue;
    }
  }

  return result;
}
