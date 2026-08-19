import type { LumirealmCharacterData } from '../payload/types.js';
import { prepareBackgroundHtmlForRuntime } from '../core/mappers/background-html.js';
import { extractLuaForTrigger } from './trigger-lua-mutate.js';

// The runtime executes `lua_scripts[i]` and renders `background_html`, both
// compiled at import from the surfaces the agent and the Viewer author
// (`triggers[i].effect[k].code` and `background_html_source`). A path write
// reaches only the source, so the compiled field has to be rebuilt or the edit
// never runs. Viewer saves compile inline and skip this.
export function recompileDerivedPayload(
  cur: LumirealmCharacterData,
): { readonly next: LumirealmCharacterData; readonly changed: readonly string[] } | null {
  const changed: string[] = [];

  const nextLua = cur.payload.triggers.map((t) => extractLuaForTrigger(t));
  const luaStale = nextLua.length !== cur.payload.lua_scripts.length
    || nextLua.some((code, i) => code !== cur.payload.lua_scripts[i]);
  if (luaStale) changed.push('lua_scripts');

  // SVG rasterization stays on the Viewer save: it uploads image assets and
  // rewrites the html to point at them, which a background recompile must not
  // do behind the user's back. Compiling without an indexer leaves <svg>
  // blocks verbatim rather than half-rewritten.
  const source = cur.payload.background_html_source;
  const nextBg = typeof source === 'string'
    ? prepareBackgroundHtmlForRuntime(source, {
        regexReplaceStrings: cur.regex_scripts.map((r) => r.replace_string ?? ''),
      }).translated
    : cur.payload.background_html;
  const bgStale = nextBg !== cur.payload.background_html;
  if (bgStale) changed.push('background_html');

  if (changed.length === 0) return null;

  return {
    next: {
      ...cur,
      payload: {
        ...cur.payload,
        ...(luaStale
          ? {
              lua_scripts: nextLua,
              requires: { ...cur.payload.requires, lua: nextLua.some((s) => s.length > 0) },
            }
          : {}),
        ...(bgStale ? { background_html: nextBg } : {}),
      },
    },
    changed,
  };
}
