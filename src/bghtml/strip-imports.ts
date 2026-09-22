
const IMPORT_RULE_RE = /@import\s+(?:url\(\s*["']?[^)"']*["']?\s*\)|["'][^"']*["'])[^;]*;/gi;

/** Remove every top-level `@import` rule from `css`. Idempotent. */
export function stripCssImports(css: string): string {
  if (!css || !/@import/i.test(css)) return css;
  return css.replace(IMPORT_RULE_RE, "");
}

export function splitCssImports(css: string): { imports: string; rest: string } {
  if (!css || css.indexOf("@import") < 0) return { imports: "", rest: css };
  const imports: string[] = [];
  const rest = css.replace(IMPORT_RULE_RE, (match) => {
    imports.push(match.trim());
    return "";
  });
  return { imports: imports.join("\n"), rest };
}
