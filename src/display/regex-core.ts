import {
  compileRegex,
  substituteRegexCaptures,
  applyTrimStrings,
  type FeRegexMatch,
} from './regex-apply.js';

export interface RegexCoreScript {
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly substitute_macros: 'none' | 'find' | 'escaped' | 'after' | 'raw';
  readonly placement: readonly string[];
  readonly target: string;
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly trim_strings: readonly string[];
  readonly disabled?: boolean;
  readonly preResolvedFind?: string;
  readonly preResolvedReplace?: string;
  readonly reResolveAfterRule?: boolean;
  readonly risuActions?: readonly string[];
  readonly evalTemplate?: (text: string) => string;
  readonly matchActions?: readonly (
    | 'move_top'
    | 'move_bottom'
    | 'repeat_back'
  )[];
  readonly repeatPosition?: string;
  readonly repeatRawMatch?: boolean;
  readonly decorateReplacement?: (replacement: string, match: FeRegexMatch, input: string) => string;
}

export interface ApplyRegexCoreOptions {
  readonly placement: string;
  readonly depth: number | undefined;
  readonly evalTemplate: (text: string) => string;
  // Reparse changed output for callers using the host substitution modes.
  readonly reResolveAfterRule?: boolean;
  /** Nearest earlier same-role message, or the greeting when none exists. */
  readonly previousContent?: string;
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
  const {
    placement,
    depth,
    evalTemplate: defaultEvalTemplate,
    reResolveAfterRule,
    previousContent,
  } = opts;
  let result = content;

  for (const script of scripts) {
    if (script.disabled === true) continue;
    if (!script.placement.includes(placement)) continue;
    if (depth !== undefined) {
      if (script.min_depth !== null && depth < script.min_depth) continue;
      if (script.max_depth !== null && depth > script.max_depth) continue;
    }

    const before = result;
    const evalTemplate = script.evalTemplate ?? defaultEvalTemplate;
    let findRegex = script.find_regex;
    if (script.preResolvedFind !== undefined) {
      findRegex = script.preResolvedFind;
    } else if (script.risuActions !== undefined
      ? script.risuActions.includes('cbs')
      : script.substitute_macros !== 'none') {
      findRegex = evalTemplate(findRegex);
    }

    const movesMatch = script.matchActions?.includes('move_top') === true
      || script.matchActions?.includes('move_bottom') === true;
    const effectiveFlags = movesMatch
      ? script.flags.replace(/g/g, '') || 'u'
      : script.flags;
    const regex = compileRegex(findRegex, effectiveFlags);
    if (!regex) continue;

    try {
      if (script.risuActions !== undefined) {
        result = applyRisuRule(result, regex, script, evalTemplate, previousContent);
        continue;
      }
      const behaviorResult = applyMatchActions(
        result,
        regex,
        script,
        previousContent,
        evalTemplate,
      );
      if (behaviorResult.handled) {
        result = applyTrimStrings(behaviorResult.content, script.trim_strings);
        continue;
      }

      if (script.substitute_macros === 'raw') {
        result = replaceWithDecoration(result, regex, script.replace_string, script.decorateReplacement, evalTemplate);
      } else if (script.substitute_macros === 'after') {
        const substituted = replaceWithDecoration(result, regex, script.replace_string, script.decorateReplacement);
        result = evalTemplate(substituted);
      } else {
        let replaceString = script.replace_string;
        if (script.preResolvedReplace !== undefined) {
          replaceString = script.substitute_macros === 'escaped'
            ? script.preResolvedReplace.replace(/\$/g, '$$$$')
            : script.preResolvedReplace;
        } else if (
          script.substitute_macros !== 'none'
          && script.substitute_macros !== 'find'
        ) {
          const resolved = evalTemplate(replaceString);
          replaceString = script.substitute_macros === 'escaped'
            ? resolved.replace(/\$/g, '$$$$')
            : resolved;
        }
        result = replaceWithDecoration(result, regex, replaceString, script.decorateReplacement);
      }

      result = applyTrimStrings(result, script.trim_strings);

      if (
        (script.reResolveAfterRule ?? reResolveAfterRule)
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

function applyRisuRule(
  content: string,
  regex: RegExp,
  script: RegexCoreScript,
  evalTemplate: (text: string) => string,
  previousContent: string | undefined,
): string {
  const movesTop = script.matchActions?.includes('move_top');
  const movesBottom = script.matchActions?.includes('move_bottom');
  const requiresMatch = script.risuActions!.length > 0
    || (script.matchActions?.length ?? 0) > 0 || script.replace_string.startsWith('@@');
  // Risu's processScriptFull reuses lastIndex after its metadata-branch probe.
  if (requiresMatch && !regex.test(content)) {
    return script.matchActions?.includes('repeat_back')
      ? applyMatchActions(content, regex, script, previousContent, evalTemplate).content
      : content;
  }
  if (movesTop || movesBottom) {
    const match = content.match(regex);
    const remainder = content.replace(regex, '');
    if (!match) return remainder;
    const replacement = script.replace_string
      .replace(/(?<!\$)\$[0-9]+/g, token => {
        const index = Number.parseInt(token.slice(1), 10);
        return index < match.length ? String(match[index]) : token;
      })
      .replace(/\$&/g, match[0]!)
      .replace(/(?<!\$)\$<([^>]+)>/g, token => {
        const name = Number.parseInt(token.slice(2, -1), 10);
        return match.groups?.[name] || token;
      });
    return applyTrimStrings(movesTop ? `${replacement}\n${remainder}` : `${remainder}\n${replacement}`, script.trim_strings);
  }
  const replaced = replaceWithDecoration(content, regex, script.replace_string, script.decorateReplacement);
  const trimmed = applyTrimStrings(replaced, script.trim_strings);
  return hasCbsSyntax(trimmed) ? evalTemplate(trimmed) : trimmed;
}

function replaceWithDecoration(
  input: string,
  regex: RegExp,
  replacement: string,
  decorate: RegexCoreScript['decorateReplacement'],
  evalReplacement?: (text: string) => string,
): string {
  if (!decorate && !evalReplacement) return input.replace(regex, replacement);
  // Native replace owns match iteration, including sticky and Unicode empty
  // matches, so adding actions cannot change which occurrences are replaced.
  return input.replace(regex, (fullMatch: string, ...args: unknown[]) => {
    const tail = args[args.length - 1];
    const namedGroups = typeof tail === 'object' && tail !== null
      ? tail as Record<string, string | undefined> : undefined;
    const offsetIndex = args.length - (namedGroups ? 3 : 2);
    const match: FeRegexMatch = {
      fullMatch,
      index: args[offsetIndex] as number,
      groups: args.slice(0, offsetIndex) as (string | undefined)[],
      ...(namedGroups ? { namedGroups } : {}),
    };
    const substituted = substituteRegexCaptures(
      replacement, fullMatch, match.groups, match.index, input, namedGroups,
    );
    const resolved = evalReplacement ? evalReplacement(substituted) : substituted;
    return decorate ? decorate(resolved, match, input) : resolved;
  });
}

function applyMatchActions(
  content: string,
  regex: RegExp,
  script: RegexCoreScript,
  previousContent: string | undefined,
  evalTemplate: (text: string) => string,
): { readonly handled: boolean; readonly content: string } {
  const actions = script.matchActions;
  if (!actions || actions.length === 0) {
    return { handled: false, content };
  }
  const movesTop = actions.includes('move_top');
  const movesBottom = actions.includes('move_bottom');

  const match = regex.exec(content);
  regex.lastIndex = 0;

  if (!match) {
    if (
      !actions.includes('repeat_back')
      || previousContent === undefined
    ) {
      return { handled: true, content };
    }
    const priorMatch = regex.exec(previousContent);
    regex.lastIndex = 0;
    if (!priorMatch) return { handled: true, content };
    const position = script.repeatPosition
      ?? script.replace_string.split(' ', 2)[1];
    const groups = Array.from(priorMatch).slice(1);
    let piece = priorMatch[0];
    if (script.repeatRawMatch !== true) {
      if (script.substitute_macros === 'raw' || script.substitute_macros === 'after') {
        piece = substituteRegexCaptures(
          script.replace_string,
          priorMatch[0],
          groups,
          priorMatch.index,
          previousContent,
          priorMatch.groups,
        );
        piece = evalTemplate(piece);
      } else {
        let replacement = script.replace_string;
        if (script.preResolvedReplace !== undefined) {
          replacement = script.substitute_macros === 'escaped'
            ? script.preResolvedReplace.replace(/\$/g, '$$$$')
            : script.preResolvedReplace;
        } else if (
          script.substitute_macros !== 'none'
          && script.substitute_macros !== 'find'
        ) {
          const resolved = evalTemplate(replacement);
          replacement = script.substitute_macros === 'escaped'
            ? resolved.replace(/\$/g, '$$$$')
            : resolved;
        }
        piece = substituteRegexCaptures(
          replacement,
          priorMatch[0],
          groups,
          priorMatch.index,
          previousContent,
          priorMatch.groups,
        );
      }
      if (script.decorateReplacement) {
        piece = script.decorateReplacement(piece, {
          fullMatch: priorMatch[0], index: priorMatch.index, groups,
          ...(priorMatch.groups ? { namedGroups: priorMatch.groups } : {}),
        }, previousContent);
      }
    }
    if (!position) return { handled: true, content: content + piece };
    if (position === 'start') return { handled: true, content: piece + content };
    if (position === 'end') return { handled: true, content: content + piece };
    if (position === 'start_nl') return { handled: true, content: `${piece}\n${content}` };
    if (position === 'end_nl') return { handled: true, content: `${content}\n${piece}` };
    return { handled: true, content };
  }

  if (movesTop || movesBottom) {
    const replacement = substituteRegexCaptures(
      script.replace_string,
      match[0],
      Array.from(match).slice(1),
      match.index,
      content,
      match.groups,
    );
    const remainder = content.replace(regex, '');
    return {
      handled: true,
      content: movesTop
        ? `${replacement}\n${remainder}`
        : `${remainder}\n${replacement}`,
    };
  }

  // Repeat-back is an ordinary replacement when the current text matches.
  return { handled: false, content };
}
