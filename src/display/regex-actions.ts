import { substituteRegexCaptures, type FeRegexMatch } from './regex-apply.js';

export interface NativeRegexAction {
  readonly id: string;
  readonly type: 'send' | 'append' | 'effects';
  readonly multi_select: boolean;
  readonly cost: string;
  readonly limit: string;
  readonly title: string;
  readonly subtitle: string;
  readonly content: string;
  readonly effects?: readonly (
    | { readonly type: 'set_state'; readonly key: string; readonly value: string }
    | { readonly type: 'draft'; readonly content: string; readonly mode: 'replace' | 'append' }
    | { readonly type: 'fork' }
  )[];
}

const ACTION_ATTR_RE = /\b(?:data-regex-action|id)\s*=\s*(["'])(.*?)\1/i;
const OPEN_TAG_RE = /<([A-Za-z][\w:-]*)(\s[^<>]*?)?\s*\/?>/g;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Matches Lumiverse's decorateMatchReplacement payload contract. The host still
// validates and executes actions; display evaluation only binds match captures.
export function decorateNativeRegexActions(
  html: string,
  scriptId: string,
  actions: readonly NativeRegexAction[],
  match: FeRegexMatch,
  input: string,
): string {
  if (actions.length === 0 || !html.includes('<')) return html;
  const capture = (text: string): string => substituteRegexCaptures(
    text, match.fullMatch, match.groups, match.index, input, match.namedGroups,
  );
  const resolved = actions.map((action) => ({
    ...action,
    title: capture(action.title), subtitle: capture(action.subtitle), content: capture(action.content),
    cost: capture(action.cost), limit: capture(action.limit),
    ...(action.effects?.length ? {
      effects: action.effects.map((effect) => ({
        ...effect,
        ...(effect.type === 'set_state' ? { value: capture(effect.value) }
          : effect.type === 'draft' ? { content: capture(effect.content) } : {}),
      })),
    } : {}),
    scriptId,
    instanceId: `${scriptId}:${match.index}:${match.index + match.fullMatch.length}`,
  }));
  const limits = resolved.filter((action) => action.multi_select)
    .map((action) => Number(action.limit.trim()))
    .filter((limit) => Number.isFinite(limit) && limit > 0);
  const limit = limits.length > 0 ? Math.min(...limits) : 0;
  const byId = new Map(resolved.map((action) => [action.id, action]));
  return html.replace(OPEN_TAG_RE, (tag) => {
    if (/\bdata-lumiverse-regex-action\s*=/.test(tag)) return tag;
    const association = tag.match(ACTION_ATTR_RE)?.[2];
    const action = association ? byId.get(association) : undefined;
    if (!action) return tag;
    const cost = Number(action.cost.trim());
    const payload = encodeURIComponent(JSON.stringify({
      ...action, cost: Number.isFinite(cost) && cost > 0 ? cost : 1, limit,
    }));
    const label = [action.title, action.subtitle].filter(Boolean).join(' — ');
    const attrs = [
      `data-lumiverse-regex-action="${payload}"`,
      action.multi_select ? 'data-lumiverse-regex-action-multi="true"' : '',
      'role="button"', 'tabindex="0"',
      label ? `aria-label="${escapeAttribute(label)}"` : '',
      action.title ? `title="${escapeAttribute(action.title)}"` : '',
    ].filter(Boolean).join(' ');
    return tag.replace(/\s*\/>$/, ` ${attrs} />`).replace(/(?<!\/)\s*>$/, ` ${attrs}>`);
  });
}
