
export interface PreviewSubstitutionContext {
  readonly userName?: string;
  readonly charName?: string;
  readonly defaults?: Readonly<Record<string, string>>;
}

const CAPTURE_REF_RE = /\$(?:&|\$|<([^>]+)>|(\d+))/g;
const MACRO_RE = /\{\{([^{}]+?)\}\}/g;

export function substituteForPreview(template: string, ctx: PreviewSubstitutionContext = {}): string {
  if (!template) return template;
  const userName = ctx.userName && ctx.userName.length > 0 ? ctx.userName : 'User';
  const charName = ctx.charName && ctx.charName.length > 0 ? ctx.charName : 'Character';
  const defaults = ctx.defaults ?? {};

  let out = template.replace(CAPTURE_REF_RE, (match, namedGroup: string | undefined, numberedGroup: string | undefined) => {
    if (match === '$&' || match === '$$') return match;
    if (typeof namedGroup === 'string') return `‹$${namedGroup}›`;
    if (typeof numberedGroup === 'string') return `‹$${numberedGroup}›`;
    return match;
  });

  out = out.replace(MACRO_RE, (match, body: string) => {
    const trimmed = body.trim();
    const parts = trimmed.split('::');
    const name = (parts[0] ?? '').toLowerCase();
    if (name === 'user') return userName;
    if (name === 'char' || name === 'character') return charName;
    if (name === 'getvar') {
      const key = parts[1] ?? '';
      const value = defaults[key];
      if (typeof value === 'string') return value;
      return match;
    }
    return match;
  });

  return out;
}
