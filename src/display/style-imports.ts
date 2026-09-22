import { stripCssImports } from '../bghtml/strip-imports.js';

// Unlike Risu ParseMarkdown, the host blocks CSS imports. Remove whole rules
// before its sanitizer can split a quoted URL and invalidate the next rule.
export function stripDisplayStyleImports(content: string): string {
  if (!/@import/i.test(content)) return content;
  return content.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_match, open: string, css: string, close: string) => open + stripCssImports(css) + close);
}
