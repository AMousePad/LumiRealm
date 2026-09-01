import { describe, expect, test } from 'bun:test';
import { rescopeRisuEnvironment } from '../../src/bghtml/island-styles.js';

// Pin the systematic class+selector rewrite that turns Risu's compiled
// chat-shell-scoped CSS into shadow-root-applicable CSS.
//
// Source-ground: `Risu's Chat.svelte:400-409`
// (the chat-shell wrapper class set + inline styles) and
// `Risu's styles.css:163-303` (`:root` defaults + `.chattext`
// descendant rules).

describe('rescopeRisuEnvironment — chat-shell class rewrites', () => {
  test('.prose → :host (and counted)', () => {
    const out = rescopeRisuEnvironment('.prose{color:red}');
    expect(out.css).toContain(':host{color:red}');
    expect(out.proseHits).toBe(1);
  });

  test('.prose-invert rewritten BEFORE .prose so its rules survive', () => {
    const css = '.prose{--x:lightval}.prose-invert{--x:darkval}';
    const out = rescopeRisuEnvironment(css);
    // Both become :host. Adoption order matters: invert appears AFTER
    // .prose in source → its :host rule is later in the sheet → wins
    // cascade. Concretely: --x ends up = darkval at runtime.
    expect(out.css).toContain(':host{--x:lightval}');
    expect(out.css).toContain(':host{--x:darkval}');
    expect(out.proseHits).toBe(1);
    expect(out.proseInvertHits).toBe(1);
  });

  test('.prose-gray (variant) NOT rewritten — left as literal class', () => {
    const out = rescopeRisuEnvironment('.prose-gray{--x:gray}');
    expect(out.css).toContain('.prose-gray{--x:gray}');
    expect(out.proseHits).toBe(0);
  });

  test('.chattext → :host', () => {
    const out = rescopeRisuEnvironment('.chattext p{color:var(--FontColorStandard)}');
    expect(out.css).toContain(':host p{color:var(--FontColorStandard)}');
    expect(out.chattextHits).toBe(1);
  });

  test('.chattext mark[risu-mark=quote1] → :host mark[risu-mark=quote1]', () => {
    const out = rescopeRisuEnvironment('.chattext mark[risu-mark=quote1]{color:cyan}');
    expect(out.css).toContain(':host mark[risu-mark=quote1]{color:cyan}');
  });

  test('.chat-width → :host', () => {
    const out = rescopeRisuEnvironment('.chat-width{word-break:normal}');
    expect(out.css).toContain(':host{word-break:normal}');
    expect(out.chatWidthHits).toBe(1);
  });
});

describe('rescopeRisuEnvironment — :root rewrite', () => {
  test(':root{...} → :root,:host{...} so vars apply inside shadow', () => {
    const out = rescopeRisuEnvironment(':root{--FontColorStandard:#fafafa}');
    expect(out.css).toContain(':root,:host{--FontColorStandard:#fafafa}');
    expect(out.rootHits).toBe(1);
  });

  test('already-paired :root,:host{...} (Tailwind v4 @theme output) NOT double-paired', () => {
    const css = ':root,:host{--font-sans:foo}';
    const out = rescopeRisuEnvironment(css);
    // Should NOT become `:root,:root,:host,:host{...}`. The negative
    // lookahead `(?!,)` skips :root when followed by a comma.
    expect(out.css).toContain(':root,:host{--font-sans:foo}');
    expect(out.css).not.toContain(':root,:root');
    expect(out.rootHits).toBe(0);
  });

  test('mixed :root and :root,:host blocks: only the unpaired one is rewritten', () => {
    const css = ':root,:host{--a:1}:root{--b:2}';
    const out = rescopeRisuEnvironment(css);
    expect(out.css).toContain(':root,:host{--a:1}');
    expect(out.css).toContain(':root,:host{--b:2}');
    expect(out.rootHits).toBe(1);
  });
});

describe('rescopeRisuEnvironment — chat-shell baseline append', () => {
  test('appends :host{overflow:visible !important} so card content can paint outside the island host clip', () => {
    const out = rescopeRisuEnvironment('.foo{}');
    expect(out.css).toContain(':host{overflow:visible !important}');
  });

  test('overflow uses !important so it beats Lumi\'s outside-shadow `_htmlIsland_*{overflow:hidden}`', () => {
    const out = rescopeRisuEnvironment('');
    expect(out.css).toContain('overflow:visible !important');
  });

  test('font-size and line-height are NOT pinned, so --lumiverse-font-scale inheritance reaches card content', () => {
    const out = rescopeRisuEnvironment('.foo{}');
    expect(out.css).not.toContain(':host{font-size');
    expect(out.css).not.toContain('line-height:1.25rem');
  });

  test('baseline appears at END so Risu defaults can establish first', () => {
    const out = rescopeRisuEnvironment(':root{--x:y}');
    const baselineIdx = out.css.indexOf(':host{overflow:visible');
    const rootIdx = out.css.indexOf(':root,:host{--x:y}');
    expect(baselineIdx).toBeGreaterThan(rootIdx);
  });
});

describe('rescopeRisuEnvironment — empty / minimal inputs', () => {
  test('empty input → minimal baseline-only output', () => {
    const out = rescopeRisuEnvironment('');
    expect(out.css).toContain(':host{overflow:visible !important}');
    expect(out.rootHits).toBe(0);
    expect(out.proseHits).toBe(0);
    expect(out.proseInvertHits).toBe(0);
    expect(out.chattextHits).toBe(0);
    expect(out.chatWidthHits).toBe(0);
  });

  test('input with no chat-shell classes is passed through (plus baseline)', () => {
    const css = '.my-card{color:red}';
    const out = rescopeRisuEnvironment(css);
    expect(out.css).toContain('.my-card{color:red}');
    expect(out.css).toContain(':host{overflow:visible');
  });
});

describe('rescopeRisuEnvironment — descendant + pseudo combinators', () => {
  test('.prose :where(p):not(...) rewrite preserves descendant combinator', () => {
    const out = rescopeRisuEnvironment(
      '.prose :where(p):not(:where([class~=not-prose])){color:red}',
    );
    expect(out.css).toContain(
      ':host :where(p):not(:where([class~=not-prose])){color:red}',
    );
  });

  test('.prose img scoped to :host img (matches all imgs in shadow)', () => {
    const out = rescopeRisuEnvironment('.prose img{margin-top:2em}');
    expect(out.css).toContain(':host img{margin-top:2em}');
  });

  test('not-prose opt-out class survives unchanged (used in :not() guards)', () => {
    const out = rescopeRisuEnvironment(':where([class~=not-prose])');
    expect(out.css).toContain(':where([class~=not-prose])');
  });
});
