// LumiAgent phone-line provider.
//
// One rpcPool handler at `lumirealm.phoneline` answers six ops on a
// discriminated union: describe (manifest), system_prompt (per-character
// agent guidance), check_write (path-rule guard for `character.extensions.
// lumirealm.*`), list_items / read_item / write_field (module-envelope
// surface). Caller publishes the request envelope at
// `<callerExtId>.phoneline_request` before reading our endpoint; rpcPool
// is pull-only so this stays serial within a turn.

import type { SpindleAPI, CharacterDTO } from 'lumiverse-spindle-types';
import { readEnvelope, writeEnvelope, listModules, type ModuleEnvelope, type UserStorageLike } from './state/modules-store.js';

interface SurfaceDescriptor {
  id: string;
  label: string;
  description: string;
  scope: 'global' | 'per_character';
}

interface SurfaceManifest {
  // `id` is overridden by the caller using the host-attested channel
  // namespace; `name` and `version` are self-declared and the caller treats
  // them as untrusted.
  extension: { id: string; name: string; version: string };
  surfaces: SurfaceDescriptor[];
  // Path prefixes under character.extensions.* that the caller's find tools
  // should skip (derived projections, frozen snapshots). Same coverage as
  // checkLumirealmWritePath's refusal set, just declared statically so the
  // caller doesn't have to dial check_write per leaf during a search walk.
  excludeFromSearch: string[];
}

// Discipline: every path NOT listed here is part of the agent's default
// view and is treated as an editable, user-visible authoring surface.
const EXCLUDE_FROM_SEARCH: readonly string[] = [
  'lumirealm.source',
  'lumirealm.regex_scripts',
  'lumirealm.payload.background_html',
  'lumirealm.payload.lua_scripts',
  'lumirealm.payload.first_mes',
  'lumirealm.payload.description',
  'lumirealm.payload.personality',
  'lumirealm.payload.scenario',
  'lumirealm.payload.system_prompt',
  'lumirealm.payload.post_history_instructions',
  'lumirealm.payload.mes_example',
  'lumirealm.payload.additional_assets',
  'lumirealm.payload.emotion_images',
  'lumirealm.payload.portal_candidates',
  'lumirealm.payload.asset_refs',
  // asset_index / emotion_index store {name -> {imageIds[], ext?}}. Names live
  // in the object keys (not leaves), and the imageIds are UUIDs. Walking emits
  // noise without surfacing the user-visible names.
  'lumirealm.payload.asset_index',
  'lumirealm.payload.emotion_index',
  'lumirealm.user_overrides',
  'lumirealm.translator_schema_version',
];

const MANIFEST: SurfaceManifest = {
  extension: { id: 'lumirealm', name: 'LumiRealm', version: '0.1.0' },
  excludeFromSearch: [...EXCLUDE_FROM_SEARCH],
  surfaces: [
    {
      id: 'module_envelope',
      label: 'Risu modules',
      scope: 'per_character',
      description:
        'Pre-translate Risu module envelopes. Each module carries its own triggers, lua scripts, background HTML, regex projection, and asset indexes. ' +
        'The lorebook + regex_scripts of an ATTACHED module are also installed as Lumi-level entities (character world books / regex scripts) and editable through the normal LumiAgent tools, this surface gives you access to the source-of-truth envelope, which survives translator schema migrations.',
    },
  ],
};

type PathSeg = { kind: 'key'; value: string } | { kind: 'index'; value: number };

function parsePath(path: string): PathSeg[] {
  const segments: PathSeg[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === '.') { i++; continue; }
    if (ch === '[') {
      const end = path.indexOf(']', i);
      if (end < 0) throw new Error(`unclosed bracket in path at index ${i}`);
      const inner = path.slice(i + 1, end);
      if (/^\d+$/.test(inner)) {
        segments.push({ kind: 'index', value: parseInt(inner, 10) });
      } else if ((inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) ||
                 (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)) {
        segments.push({ kind: 'key', value: inner.slice(1, -1) });
      } else {
        throw new Error(`bracket contents must be a number or quoted string: [${inner}]`);
      }
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
    const key = path.slice(i, j);
    if (key.length === 0) throw new Error(`empty key at index ${i}`);
    segments.push({ kind: 'key', value: key });
    i = j;
  }
  return segments;
}

function getAtPath(obj: unknown, segments: readonly PathSeg[]): unknown {
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (seg.kind === 'key') {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg.value];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.value];
    }
  }
  return cur;
}

function setAtPath(root: unknown, segments: readonly PathSeg[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (head!.kind === 'index') {
    const arr = Array.isArray(root) ? [...root] : [];
    arr[head!.value] = setAtPath(arr[head!.value], rest, value);
    return arr;
  }
  const obj = (root && typeof root === 'object' && !Array.isArray(root)) ? { ...(root as Record<string, unknown>) } : {};
  obj[head!.value] = setAtPath(obj[head!.value], rest, value);
  return obj;
}

async function getAttachedModuleIdsForCharacter(spindle: SpindleAPI, userId: string, characterId: string): Promise<string[]> {
  try {
    const c = await spindle.characters.get(characterId, userId);
    const lumi = (c?.extensions as Record<string, unknown> | undefined)?.['lumirealm'] as Record<string, unknown> | undefined;
    const overrides = lumi?.['user_overrides'] as Record<string, unknown> | undefined;
    const ids = overrides?.['attached_module_ids'];
    if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

// ─── op: check_write ────────────────────────────────────────────────────
//
// Refuses writes to layers LumiRealm regenerates (source, translator
// projections, payload mirrors of canonical character fields, user-UI
// configuration). Each refusal redirects to the right authoring surface.
// Migrated verbatim from LumiAgent's former in-tree `_lumirealm-gates.ts`,
// so future authoring-rule changes happen here, not there.

const CANONICAL_MIRROR_FIELDS: readonly string[] = [
  'first_mes',
  'description',
  'personality',
  'scenario',
  'system_prompt',
  'post_history_instructions',
  'mes_example',
];

const COUPLING_REMINDER =
  'REMEMBER: card content is deeply coupled across surfaces. A change here may propagate to UI (bg-html, status panels, portals), Lore (world book entries that key on names or phrases), Prose (greetings, mes_example, persona-facing fields), and Regex (find_regex patterns that anchor on shape, replace_string content that injects HTML or text). After ANY edit, scan for collisions with: regex find_regex patterns, world book key arrays, alternate_greetings parallel forms, payload.additional_assets references, portal_candidates, and any in-bg CSS classes referenced by regex display rules.';

function checkWritePath(extPath: string): { ok: boolean; message?: string } {
  if (extPath !== 'lumirealm' && !extPath.startsWith('lumirealm.') && !extPath.startsWith('lumirealm[')) {
    return { ok: true };
  }

  if (extPath === 'lumirealm.source' || extPath.startsWith('lumirealm.source.') || extPath.startsWith('lumirealm.source[')) {
    return {
      ok: false,
      message:
        'lumirealm.source.* is a FROZEN .charx import snapshot. It is the input to the translator pipeline, never the authoring surface. The translator regenerates payload.* and the top-level regex_scripts from it on every schema bump; writes here are pointless and the wrong layer to reach for.\n\n' +
        'Use the AUTHORING surface that matches your content kind:\n' +
        '- HTML / status panel CSS → edit on char/extensions/lumirealm.payload.background_html_source\n' +
        "- Trigger Lua / JS → edit on char/extensions/lumirealm.payload.triggers[i].effect[k].code where effect.type is 'triggerlua' or 'triggercode'\n" +
        '- Character-scoped regex → edit / rewrite on rx/<scriptId>/find_regex or rx/<scriptId>/replace_string; metadata via update_regex_script\n' +
        '- Lorebook → edit / rewrite on wb/<entryId>/content or /comment; metadata via update_world_book_entry\n' +
        '- Canonical character fields (first_mes, description, etc.) → update_character({patch}) for multi-field, or edit / rewrite on char/<field>\n\n' +
        COUPLING_REMINDER,
    };
  }

  if (
    extPath === 'lumirealm.regex_scripts' ||
    extPath.startsWith('lumirealm.regex_scripts.') ||
    extPath.startsWith('lumirealm.regex_scripts[')
  ) {
    return {
      ok: false,
      message:
        'lumirealm.regex_scripts is a translator-projection CACHE; it is not what fires at runtime. The LIVE regex scripts that actually run live at the top-level regex_scripts surface. Use list({path:"rx"}) to enumerate, read / edit on rx/<scriptId>/find_regex or /replace_string for content, update_regex_script for metadata. Edits to this cache get clobbered on the next translator schema bump.\n\n' +
        COUPLING_REMINDER,
    };
  }

  if (extPath === 'lumirealm.payload.background_html') {
    return {
      ok: false,
      message:
        'lumirealm.payload.background_html is the TRANSLATED runtime output; LumiRealm regenerates it from lumirealm.payload.background_html_source on every save and on every translator schema bump. Edits here are clobbered.\n\n' +
        'Edit char/extensions/lumirealm.payload.background_html_source instead (use edit / rewrite / set on that path). LumiRealm seeds it from the card-side baseline at import, so the path always resolves on a card that has bg-html.\n\n' +
        'Bg-html / CSS content is the most cross-coupled surface on the card. ' + COUPLING_REMINDER,
    };
  }

  if (
    extPath === 'lumirealm.payload.lua_scripts' ||
    extPath.startsWith('lumirealm.payload.lua_scripts.') ||
    extPath.startsWith('lumirealm.payload.lua_scripts[')
  ) {
    return {
      ok: false,
      message:
        'lumirealm.payload.lua_scripts is a translator-derived per-trigger projection, NOT an authoring surface. lua_scripts[i] is the joined triggerlua effect code from triggers[i], parallel-indexed (empty string when triggers[i] uses v1/v2 opcodes instead of Lua). The translator regenerates it from triggers on every save.\n\n' +
        "Edit the SOURCE on the trigger: char/extensions/lumirealm.payload.triggers[i].effect[k].code where effect.type === 'triggerlua' (or 'triggercode' for JS). Same trigger index. Read the trigger first to locate the right effect index.\n\n" +
        COUPLING_REMINDER,
    };
  }

  for (const f of CANONICAL_MIRROR_FIELDS) {
    if (extPath === `lumirealm.payload.${f}`) {
      return {
        ok: false,
        message:
          `lumirealm.payload.${f} is a translator-output mirror of the canonical character field. The LIVE field that the LLM actually sees in the prompt is character.${f} at the top level.\n\n` +
          `Use update_character({ patch: { ${f}: <new text> } }) for wholesale replacement, or edit({ path: "char/${f}", find, replace }) for find/replace.\n\n` +
          (f === 'first_mes'
            ? 'For greetings: first_mes is greeting #1 at path char/first_mes; alternate_greetings[0..N-2] are greetings #2..#N at char/alternate_greetings/<idx>. Use rewrite({path, new_content}) for whole-greeting overwrites.\n\n'
            : '') +
          COUPLING_REMINDER,
      };
    }
  }

  if (
    extPath === 'lumirealm.payload.asset_index' ||
    extPath.startsWith('lumirealm.payload.asset_index.') ||
    extPath.startsWith('lumirealm.payload.asset_index[') ||
    extPath === 'lumirealm.payload.emotion_index' ||
    extPath.startsWith('lumirealm.payload.emotion_index.') ||
    extPath.startsWith('lumirealm.payload.emotion_index[')
  ) {
    return {
      ok: false,
      message:
        'lumirealm.payload.asset_index / emotion_index map asset NAMES (the user-facing handles referenced by `{{img::name}}` / `{{emotion::name}}` / `<img="name">` in regex replace_string and bg-html) to their underlying image ids. Writing through a path bypasses the refresh hooks (`refreshRisuAssetMap`, attached-character invalidation) and leaves the runtime out of sync.\n\n' +
        'Use the dedicated tools, NOT a path write: `asset_rename` and `asset_delete` wrap the rename / delete wire ops with the refresh hooks fired correctly. `asset_delete` takes `assetNames` (an array): pass every name in ONE call rather than looping, since each call rewrites the envelope and runs an image-reclaim sweep. Deleting an asset also deletes its image file unless something else still references it. Adding a NEW asset (`add_assets`) has no agent tool: surface that asset upload is a LumiRealm Viewer → Assets tab action. ' + COUPLING_REMINDER,
    };
  }

  if (
    extPath === 'lumirealm.user_overrides.default_variables_overrides' ||
    extPath.startsWith('lumirealm.user_overrides.default_variables_overrides.') ||
    extPath.startsWith('lumirealm.user_overrides.default_variables_overrides[') ||
    extPath === 'lumirealm.user_overrides.default_variables_text'
  ) {
    return {
      ok: false,
      message:
        'lumirealm.user_overrides.default_variables_text and .default_variables_overrides are PER-USER overrides of the card-side `payload.scriptstate_defaults`. Do NOT path-write them.\n\n' +
        'For a per-user override for THIS user only, use the `set_default_variables_text` tool (`null` reverts to the card-side baseline). To change the value EVERY user of this card sees, edit `char/extensions/lumirealm.payload.scriptstate_defaults` (the card-side baseline) instead. Reading the user_overrides values for diagnostic context is fine.',
    };
  }

  if (extPath === 'lumirealm.user_overrides' || extPath.startsWith('lumirealm.user_overrides.') || extPath.startsWith('lumirealm.user_overrides[')) {
    return {
      ok: false,
      message:
        'lumirealm.user_overrides.* is per-user UI configuration (attached module ids, portal decisions, low-level-access consent, etc.). Do NOT path-write it. Module attach / detach has dedicated tools (`module_attach` / `module_detach`) that write attached_module_ids with the refresh hooks fired. The other user_overrides (portal decisions, low-level-access consent) have no agent tool: reading for diagnostic context is fine, otherwise surface that the relevant LumiRealm tab handles it.',
    };
  }

  return { ok: true };
}

// ─── op: check_read ─────────────────────────────────────────────────────
//
// Refuses reads to layers that are stale-by-definition mirrors or pure
// projections of a live surface elsewhere. The principle: if you wouldn't let
// the agent write here (because it's a cache / projection / mirror), don't
// let them read here either, because the bytes they'd see are stale relative
// to the live data. Exceptions are paths whose READ has different semantics
// than write (asset_index/emotion_index where names live in KEYS, user_overrides
// for UI-state diagnostics) -- those stay readable.

function checkReadPath(extPath: string): { ok: boolean; message?: string } {
  if (extPath !== 'lumirealm' && !extPath.startsWith('lumirealm.') && !extPath.startsWith('lumirealm[')) {
    return { ok: true };
  }
  if (extPath === 'lumirealm.source' || extPath.startsWith('lumirealm.source.') || extPath.startsWith('lumirealm.source[')) {
    return {
      ok: false,
      message:
        'lumirealm.source.* is a FROZEN .charx import snapshot, opaque to the agent. LumiRealm regenerates payload.* and the top-level regex_scripts from it on every schema bump; reading it gives stale bytes that the agent should never use.\n\n' +
        'Use the LIVE surface that matches your content kind:\n' +
        '- HTML / status panel CSS -> char/extensions/lumirealm.payload.background_html_source\n' +
        "- Trigger Lua / JS -> char/extensions/lumirealm.payload.triggers[i].effect[k].code where effect.type is 'triggerlua' or 'triggercode'\n" +
        '- Character-scoped regex -> rx/<scriptId>/find_regex or rx/<scriptId>/replace_string\n' +
        '- Lorebook -> wb/<entryId>/content or /comment\n' +
        '- Canonical character fields (first_mes, description, etc.) -> char/<field>',
    };
  }
  if (extPath === 'lumirealm.payload.background_html') {
    return {
      ok: false,
      message:
        'lumirealm.payload.background_html is the TRANSLATED runtime output of the bg-html pipeline; the agent never wants to read it directly. Read char/extensions/lumirealm.payload.background_html_source instead, that is the authoring surface and LumiRealm seeds it from the card-side baseline at import.',
    };
  }
  if (
    extPath === 'lumirealm.regex_scripts' ||
    extPath.startsWith('lumirealm.regex_scripts.') ||
    extPath.startsWith('lumirealm.regex_scripts[')
  ) {
    return {
      ok: false,
      message:
        'lumirealm.regex_scripts is a translator-projection CACHE, not the live regex. The runtime fires the top-level regex_scripts surface. Use list({path:"rx"}) to enumerate, read/edit on rx/<scriptId>/find_regex or /replace_string, update_regex_script for metadata.',
    };
  }
  if (
    extPath === 'lumirealm.payload.lua_scripts' ||
    extPath.startsWith('lumirealm.payload.lua_scripts.') ||
    extPath.startsWith('lumirealm.payload.lua_scripts[')
  ) {
    return {
      ok: false,
      message:
        'lumirealm.payload.lua_scripts is a translator-derived per-trigger projection (joined triggerlua effect code, parallel-indexed with payload.triggers). Source-of-truth is char/extensions/lumirealm.payload.triggers[i].effect[k].code where effect.type is triggerlua or triggercode. Read the trigger directly.',
    };
  }
  for (const f of CANONICAL_MIRROR_FIELDS) {
    if (extPath === `lumirealm.payload.${f}`) {
      return {
        ok: false,
        message:
          `lumirealm.payload.${f} is a translator-output mirror of the canonical character field. Read char/${f} instead, that's the live value the LLM actually sees in the prompt. The mirror exists for translator state; reading it gives stale bytes once the canonical has been edited.`,
      };
    }
  }
  return { ok: true };
}

// ─── op: system_prompt ──────────────────────────────────────────────────
//
// Builds the LumiRealm card-authoring guidance section that LumiAgent
// stitches into its system prompt when this character has LumiRealm
// extension data. Detection + section text migrated verbatim from
// LumiAgent's former in-tree `buildLumiRealmSection` plus the
// `detectLumiRealmContext` helper.

interface TriggerSurfaceSummary {
  total: number;
  withCode: number;
  withSetvarLike: number;
  withAlert: number;
  withRunLLM: number;
  sampleCommentLabels: string[];
  hasCjkInEffectStrings: boolean;
}

interface LumiRealmContext {
  payloadDualKeys: string[];
  hasBgHtml: boolean;
  hasBgHtmlSource: boolean;
  hasTriggers: boolean;
  hasScriptstateDefaults: boolean;
  attachedModuleCount: number;
  translatorSchemaVersion: number | null;
  storedRegexScriptCount: number;
  hasUserOverrides: boolean;
  triggerSurfaces: TriggerSurfaceSummary | null;
}

const SETVAR_LIKE_TYPES: ReadonlySet<string> = new Set([
  'setvar', 'addvar', 'setdefaultvar', 'v2SetVar', 'v2DeclareLocalVar', 'settempvar',
]);
const ALERT_LIKE_TYPES: ReadonlySet<string> = new Set([
  'alertNormal', 'alertError', 'alertSelect', 'alertInput', 'alertConfirm', 'alert',
]);
const CODE_EFFECT_TYPES: ReadonlySet<string> = new Set(['triggerlua', 'triggercode']);
const CJK_PROBE_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿가-힣]/;

function summariseTriggers(triggers: readonly unknown[]): TriggerSurfaceSummary {
  let withCode = 0, withSetvarLike = 0, withAlert = 0, withRunLLM = 0;
  let hasCjkInEffectStrings = false;
  const comments: string[] = [];
  for (const tr of triggers) {
    if (!tr || typeof tr !== 'object') continue;
    const t = tr as Record<string, unknown>;
    const comment = typeof t['comment'] === 'string' ? (t['comment'] as string).trim() : '';
    if (comment.length > 0 && comments.length < 12) comments.push(comment);
    const effects = Array.isArray(t['effect']) ? (t['effect'] as unknown[]) : [];
    let sawCode = false, sawSetvar = false, sawAlert = false, sawRunLLM = false;
    for (const ef of effects) {
      if (!ef || typeof ef !== 'object') continue;
      const e = ef as Record<string, unknown>;
      const etype = typeof e['type'] === 'string' ? (e['type'] as string) : '';
      if (CODE_EFFECT_TYPES.has(etype)) sawCode = true;
      else if (SETVAR_LIKE_TYPES.has(etype)) sawSetvar = true;
      else if (ALERT_LIKE_TYPES.has(etype)) sawAlert = true;
      else if (etype === 'runLLM' || etype === 'v2RunLLM') sawRunLLM = true;
      if (!hasCjkInEffectStrings) {
        const v = e['value'], d = e['display'];
        if (typeof v === 'string' && CJK_PROBE_RE.test(v)) hasCjkInEffectStrings = true;
        else if (typeof d === 'string' && CJK_PROBE_RE.test(d)) hasCjkInEffectStrings = true;
      }
    }
    if (sawCode) withCode++;
    if (sawSetvar) withSetvarLike++;
    if (sawAlert) withAlert++;
    if (sawRunLLM) withRunLLM++;
  }
  return {
    total: triggers.length,
    withCode, withSetvarLike, withAlert, withRunLLM,
    sampleCommentLabels: comments,
    hasCjkInEffectStrings,
  };
}

const LUMIREALM_DUAL_KEYS = ['first_mes', 'description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'mes_example'] as const;

function detectContext(c: CharacterDTO): LumiRealmContext | null {
  const ext = c.extensions ?? {};
  const lumi = (ext as Record<string, unknown>)['lumirealm'] as Record<string, unknown> | undefined;
  if (!lumi || typeof lumi !== 'object') return null;
  const payload = (lumi['payload'] ?? null) as Record<string, unknown> | null;
  const dualKeys: string[] = [];
  let hasBgHtml = false;
  let hasBgHtmlSource = false;
  let hasTriggers = false;
  let hasScriptstateDefaults = false;
  let triggerSurfaces: TriggerSurfaceSummary | null = null;
  if (payload && typeof payload === 'object') {
    for (const k of LUMIREALM_DUAL_KEYS) {
      if (typeof payload[k] === 'string' && (payload[k] as string).length > 0) dualKeys.push(k);
    }
    hasBgHtml = typeof payload['background_html'] === 'string' && (payload['background_html'] as string).length > 0;
    hasBgHtmlSource = typeof payload['background_html_source'] === 'string' && (payload['background_html_source'] as string).length > 0;
    const triggers = Array.isArray(payload['triggers']) ? (payload['triggers'] as unknown[]) : null;
    hasTriggers = triggers !== null && triggers.length > 0;
    if (triggers !== null) triggerSurfaces = summariseTriggers(triggers);
    const ssd = payload['scriptstate_defaults'];
    hasScriptstateDefaults = ssd !== null && typeof ssd === 'object' && Object.keys(ssd as Record<string, unknown>).length > 0;
  }
  const overrides = (lumi['user_overrides'] ?? null) as Record<string, unknown> | null;
  const attachedModuleCount = overrides && Array.isArray(overrides['attached_module_ids'])
    ? (overrides['attached_module_ids'] as unknown[]).length
    : 0;
  const tsv = lumi['translator_schema_version'];
  const translatorSchemaVersion = typeof tsv === 'number' ? tsv : null;
  const storedRegex = lumi['regex_scripts'];
  const storedRegexScriptCount = Array.isArray(storedRegex) ? storedRegex.length : 0;
  return {
    payloadDualKeys: dualKeys,
    hasBgHtml,
    hasBgHtmlSource,
    hasTriggers,
    hasScriptstateDefaults,
    attachedModuleCount,
    translatorSchemaVersion,
    storedRegexScriptCount,
    hasUserOverrides: overrides !== null && typeof overrides === 'object' && Object.keys(overrides).length > 0,
    triggerSurfaces,
  };
}

const LUMIREALM_DUAL_KEYS_LIST = 'first_mes, description, personality, scenario, system_prompt, post_history_instructions, mes_example';

const STATIC_SECTION = `# LumiRealm card — authoring map

This character was imported from Risu. Layered storage:

\`source.*\` (frozen .charx snapshot) -> \`payload.*\` (translator runtime layer) -> canonical character fields + top-level \`regex_scripts.*\` (the live surfaces).

Multiple layers carry related content; only ONE per content kind is the AUTHORING surface. Every other layer is a translator-regenerated mirror that gets clobbered on the next schema bump and on every save. The frozen \`lumirealm.source.*\` snapshot and the \`payload.background_html\` rasterized mirror are OPAQUE: reads and writes both return an error redirecting you to the live surface. Other translator-derived projections (\`payload.lua_scripts\`, the canonical-mirror payload fields like \`payload.first_mes\`) stay readable for diagnostics but refused on write. The walker also filters them all out of \`survey_cjk\`, \`grep\`, and \`audit_card_coverage\` so they don't waste sample budget.

## User-visible authoring surfaces

Every row here can be edited. Translation work, UI rewrites, and content edits all start from this table.

| Surface | Path(s) | What the user sees | Notes |
|---|---|---|---|
| Character canonical fields | \`char/<field>\` for ${LUMIREALM_DUAL_KEYS_LIST}, plus \`creator_notes\`, \`creator\`, \`name\` | Prose injected into the LLM prompt; greetings + persona shown in chat history | \`update_character({patch})\` for multi-field, or \`edit\` / \`rewrite\` per field. The \`payload.<same>\` mirrors are refused on write. |
| Alternate greetings | \`char/alternate_greetings/<idx>\` | Greeting #2..#N shown in the chat-start picker | \`rewrite\` for whole-greeting overwrites; \`create({path:"char/alternate_greetings"})\` / \`delete({path:"char/alternate_greetings/<idx>"})\` for shape changes. |
| Regex replace_string | \`rx/<scriptId>/replace_string\` | HTML / CSS / text injected into the rendered message DOM — status panels, settings UI, buttons, popups, scene backgrounds | THIS is where most card UI HTML lives on Risu-imported cards. Look here first for UI labels. |
| Regex find_regex | \`rx/<scriptId>/find_regex\` | Not user-visible, but anchors the rule: matches against LLM output / message text | Don't translate the pattern. Touch only if the LLM's output shape genuinely changed. |
| Lorebook content / comment | \`wb/<entryId>/content\` and \`wb/<entryId>/comment\` | Lore text injected into the LLM prompt when keys hit | \`update_world_book_entry\` for metadata (key arrays, decorators, disabled, priority). |
| Bg-HTML source | \`char/extensions/lumirealm.payload.background_html_source\` | Persistent overlay rendered behind every message in the chat: ambient animations, fixed status panels, scene art | **THE authoring surface for bg-html.** Always \`inspect\` and \`read\` this path on translation / UI / styling tasks. LumiRealm seeds it from the card-side baseline at import so it always resolves on cards that have bg-html. The post-translator \`payload.background_html\` mirror is hidden from the agent's view (refused on read and write); always use \`_source\`. |
| Trigger button labels | \`char/extensions/lumirealm.payload.triggers[i].comment\` | The \`risu-trigger="<comment>"\` attribute on HTML buttons inside regex \`replace_string\`. Clicking the button fires this trigger. The comment string itself surfaces in the UI as the button's identifier and often as its visible label too. | Renaming requires updating every \`risu-trigger="..."\` reference in regex \`replace_string\` AND in bg-html. Use \`grep\` to find all callers before renaming. |
| Trigger Lua / JS code | \`char/extensions/lumirealm.payload.triggers[i].effect[k].code\` where \`effect.type == 'triggerlua'\` or \`'triggercode'\` | Behaviour code that runs at trigger time. String literals inside it (button-fed dialog text, popup messages, choice labels) surface to the user via \`alertNormal\` / \`alertSelect\` / DOM rewrites. | For translation: edit only string LITERALS inside \`"..."\` / \`'...'\` / \`[[...]]\`; never touch surrounding control flow, function/variable names, table keys, or operators. Read the trigger with \`read({path: '...triggers[i]'})\` first to locate the right effect index. |
| Trigger setvar / addvar / setdefaultvar value | \`char/extensions/lumirealm.payload.triggers[i].effect[k].value\` where \`effect.type\` is \`setvar\` / \`addvar\` / \`setdefaultvar\` / \`v2SetVar\` / \`settempvar\` / \`v2DeclareLocalVar\` | **User-visible UI label.** Surfaces via \`{{getvar::<target>}}\` macros embedded in regex \`replace_string\` HTML, lorebook content, bg-html, and prose. Example: an effect with \`target="season", value="봄"\` fills the \`{{getvar::season}}\` slot everywhere it appears. | Translate the \`.value\` string. Leave \`.target\` (variable name), \`.type\` (opcode kind), \`.indent\` (V2 control-flow depth) alone. |
| Trigger alert display | \`char/extensions/lumirealm.payload.triggers[i].effect[k].display\` where \`effect.type\` is \`alert\` / \`alertNormal\` / \`alertError\` / \`alertSelect\` / \`alertInput\` / \`alertConfirm\` | **User-visible popup text** shown when the trigger fires (alert modal title / body / prompt). | Edit the \`.display\` string verbatim. |
| Trigger alert option labels | \`char/extensions/lumirealm.payload.triggers[i].effect[k].value\` array entries on \`alertSelect\` effects (often shaped \`[{value, display}, ...]\` or a plain \`string[]\`) | **User-visible choice labels** in a multi-select picker — the user clicks them. | \`set\` on the array or \`edit\` on each \`.display\` leaf depending on shape. |
| Trigger runLLM prompt | \`char/extensions/lumirealm.payload.triggers[i].effect[k].value\` where \`effect.type\` is \`runLLM\` / \`v2RunLLM\` | The sub-prompt sent to the aux / submodel LLM; affects what the user sees indirectly through its output. | Translatable. |
| scriptstate_defaults | \`char/extensions/lumirealm.payload.scriptstate_defaults\` | A flat string→string map of initial chat-var values. Same surfacing path as \`setvar.value\` — these seed \`{{getvar::*}}\` slots before any trigger fires. Visible in State → Variables → Default (card-side column). | \`read\` it, mutate locally, \`set({path, value: <object>})\`. Edits the value EVERY user of this card sees. Per-user overrides live at \`user_overrides.default_variables_*\` and require a UI op the agent doesn't have (see UI-only section below). |
| Module customModuleToggle DSL | \`edit_external\` / \`update_external\` on \`surface_id='module_envelope'\` field \`module.customModuleToggle\` | A string DSL that defines the checkboxes / selects / text inputs / groups shown in State → Toggles when this module is attached. Toggle keys flow into \`{{getvar::toggle_KEY}}\` / Risu \`{{#when::toggle::KEY}}\` macros. | DSL syntax is Risu's \`parseToggleSyntax\` (see ported docs in LumiRealm \`core/toggle-syntax.ts\`). Each line is a directive: \`>group Name\`, \`<\`, \`---\`, \`#caption\`, \`?key|Label\`, \`?key|Label|options,comma,separated\`, \`%key|Label|default\` for text. Translate the labels / captions; never touch the leading directive char or the key name (renaming the key breaks every macro consumer). |
| Module lorebook | \`wb/<id>/content\` and \`wb/<id>/comment\` for the world book named \`Module: <module name>\` | Lore injected into the LLM prompt for every character that has the module attached. The module viewer also reads from this wb directly. | Use the path-based tools (\`read\`, \`edit\`, \`rewrite\`, \`update_world_book_entry\`) on the installed wb. \`list({path: 'wb'})\` shows every world book including the module-installed ones. Edits are shared across every character that has the module attached (one wb per module). \`module.lorebook[i]\` on the envelope is the frozen import bundle and is refused on write. |
| Module envelope (other) | \`list_external\` / \`read_external\` / \`grep_external\` / \`edit_external\` / \`update_external\` with \`surface_id='module_envelope'\` | Module-scoped regex (\`module.regex[i].in\` / \`.out\` / \`.comment\`), triggers (\`module.trigger[i].comment\` / \`.effect[k].(value|display|code)\`), bg-html (\`module.backgroundEmbedding\`). Module regex is ALSO installed as top-level mirrors (editable via \`rx/\` paths) — but for migration-safe edits, use the envelope. | Field paths shown above. |
| Asset name registry (read-only via path) | \`list({path: 'char/extensions/lumirealm.payload.asset_index'})\` then \`read({path: 'char/extensions/lumirealm.payload.asset_index.<name>.ext'})\` (or \`.imageIds[0]\`); same for \`emotion_index\` | The keys of these objects are the asset NAMES referenced by \`{{img::name}}\` / \`{{emotion::name}}\` / \`<img="name">\` macros in regex \`replace_string\` and bg-html. Names are user-visible (they show up in the Viewer → Assets grid). \`survey_cjk\` won't find CJK in asset names because they live in object KEYS, not leaves — explicitly \`list\` this path on translation / UI tasks. | READ only via path. Rename / delete have dedicated tools (\`asset_rename\` / \`asset_delete\`); asset ADD is UI-only. Never path-write asset_index. |

If a path is NOT in this table and NOT a top-level \`char/\` / \`rx/\` / \`wb/\` surface, it's either internal (opcode types, indent depth, ids, schema versions, raw asset arrays) or a derived mirror — leave it alone or write to the redirect target the refusal message gives you.

## Chat-state and module mutations have dedicated tools

These have wired LumiAgent tools. Use the tool, NOT a path write to the underlying storage (path writes bypass refresh hooks / runtime invalidations and the runtime silently diverges):

- Asset rename / delete (character or module): \`asset_rename\` / \`asset_delete\` (\`assetNames\` array, batch in one call).
- Module attach / detach on a character: \`module_attach\` / \`module_detach\`.
- Toggle value for a chat: \`set_toggle\` (key as defined in the module \`customModuleToggle\` DSL, without the \`toggle_\` prefix).
- Chat-scope local variable: \`set_chat_variable\`.
- Per-user default-variables override text: \`set_default_variables_text\` (\`null\` reverts to the card-side baseline).

For the toggle / chat-var / default-var DEFINITIONS the user authors on the card itself, the authoring surfaces remain: \`customModuleToggle\` DSL via \`edit_external\` on the module envelope, and \`payload.scriptstate_defaults\` for the all-users baseline.

## Surfaces the agent still cannot mutate

| Surface | Where the user does it | Wire op (FE→BE) | What to tell the user |
|---|---|---|---|
| Asset ADD (character or module) | Viewer → Assets | \`add_asset\` / \`add_assets\` | "Adding a new asset is a Viewer → Assets thing. I can rename or delete existing assets, and read the current asset_index, but I can't upload a new one from here." |
| Background-html (live SVG raster pipeline) | Viewer → HTML | \`set_background_html\` runs a SVG-raster pipeline after the write | The agent's path-based \`set\` / \`edit\` on \`payload.background_html_source\` writes the source but won't fire the SVG-raster dispatch. For HTML that contains \`<svg>\` blocks the user wants rasterized, surface that the Viewer → HTML save button is what triggers raster. Plain HTML / CSS edits via the agent path are fine. |

The pattern: **when a tab in the LumiRealm UI exists for a thing, that's the user's authoritative entry point.** The agent supplements (read for diagnostic context, edit for the surfaces it can reach correctly), it does not replace.

## Cross-surface coupling

Card content is deeply interconnected. After ANY edit (even a one-line replace), check for propagation across:

- **Macros + state binding.** \`{{getvar::NAME}}\` in regex HTML / lorebook / bg-html / prose binds to: (a) every \`setvar\` / \`addvar\` / \`setdefaultvar\` effect's \`.target\`, (b) \`scriptstate_defaults\` keys, (c) Lua \`getState\` / \`setState\` / \`getChatVar\` / \`setChatVar\` calls. Renaming a var requires updating ALL of them together. Renaming a \`.value\` (translation) does NOT — only the displayed string changes.
- **Live chat-scope state vs authoring source.** \`{{getvar::NAME}}\` resolves at render time from \`chat.metadata.macro_variables.local\` / \`.chat\` / \`.global\` — the LIVE runtime values, populated by setvar effects firing during play and seeded once from \`scriptstate_defaults\`. For DIAGNOSTIC reads ("why does this label say X in this chat right now?") use \`list_variables({scope:"chat"|"local"|"global"})\` and \`read_variable({scope, key})\` (deferred tools — fetch via \`tool_search\` if their schemas aren't loaded yet). For TRANSLATION and label changes, edit the AUTHORING source instead (the relevant \`triggers[i].effect[k].value\` or the \`scriptstate_defaults\` key) so the new label survives every time triggers re-fire. A direct live-var write would be a one-chat patch that the next trigger run overwrites.
- **Buttons.** A \`risu-trigger="<comment>"\` HTML attribute in regex \`replace_string\` is matched against \`triggers[i].comment\`. Renaming the comment without updating the HTML breaks the button. \`grep\` the comment string before renaming.
- **Lore activation keys.** World book entry \`key\` arrays match on names / phrases / status labels that appear in greetings, prose, bg-html. Renaming an entity in prose without updating keys silently disables the entry.
- **Alternate greetings.** They often share a name / tone / opening pattern. Translating one and not the others leaves the chat picker inconsistent. Greetings are also referenced by regex \`find_regex\` patterns that depend on shape (asterisks, brackets, quoted speech, language markers).
- **Regex find_regex.** Anchors to content shape, not text. A prose rewrite or HTML class rename can de-sync the find side. Translation never touches \`find_regex\`; only structural rewrites do.
- **Trigger ↔ trigger call chain.** \`runTrigger("name")\` in one trigger's Lua calls another by its \`comment\`. Renames cascade.

Workflow rule: **before declaring an edit done, \`grep\` the card for every other place the touched token appears.** \`grep\` walks character + world_books + regex + extensions in one pass; \`grep_external\` covers module envelopes. For translation work, start with \`survey_cjk({scopes:["character","world_books","regex_scripts","extensions"]})\` and treat EVERY hit it returns as a real authoring surface — including hits under \`extensions.lumirealm.payload.triggers[N].effect[K].value\` or \`.display\`, which are user-visible UI strings per the table above, NOT internal state. Use \`apply_glossary\` for coordinated multi-surface replaces (>5 sites for the same token).`;

function buildSection(c: LumiRealmContext): string {
  const tail: string[] = [];
  if (c.hasBgHtmlSource || c.hasBgHtml) {
    tail.push("This card has bg-html. Authoring surface: `payload.background_html_source`. Always `inspect` and `read` it on translation / UI tasks even if `survey_cjk` shows no hits there, English labels and structural content may still be worth knowing about.");
  }
  if (c.hasTriggers && c.triggerSurfaces) {
    const ts = c.triggerSurfaces;
    const parts: string[] = [];
    parts.push(`This card has \`payload.triggers\` (${ts.total} total).`);
    const kindCounts: string[] = [];
    if (ts.withCode > 0) kindCounts.push(`${ts.withCode} carry triggerlua/triggercode \`.code\` (behaviour)`);
    if (ts.withSetvarLike > 0) kindCounts.push(`${ts.withSetvarLike} carry setvar/addvar/setdefaultvar effects (their \`.value\` is user-visible UI text via \`{{getvar::*}}\`)`);
    if (ts.withAlert > 0) kindCounts.push(`${ts.withAlert} carry alert effects (\`.display\` is popup text, \`.value\` may carry option labels)`);
    if (ts.withRunLLM > 0) kindCounts.push(`${ts.withRunLLM} carry runLLM (\`.value\` is a sub-prompt)`);
    if (kindCounts.length > 0) parts.push(`Breakdown: ${kindCounts.join(', ')}.`);
    if (ts.sampleCommentLabels.length > 0) {
      parts.push(`Sample button labels (\`.comment\`): ${ts.sampleCommentLabels.map((s) => `"${s}"`).join(', ')}.`);
    }
    if (ts.hasCjkInEffectStrings) {
      parts.push('Trigger non-code effect strings contain CJK characters on this card. Those are real user-visible UI text per the table above (translatable), not internal state.');
    }
    parts.push("Read the trigger with `read({path: '...triggers[i]'})` first to locate the exact effect index before editing.");
    tail.push(parts.join(' '));
  }
  if (c.hasScriptstateDefaults) {
    tail.push('`payload.scriptstate_defaults` is a flat string->string map for chat-state seeds. `read` it, mutate it locally, write it back with `set({path: "char/extensions/lumirealm.payload.scriptstate_defaults", value: <object>})`. Coupled to: `{{getvar::KEY}}` macros, Lua `getState/setState` calls, regex `replace_string` references.');
  }
  if (c.payloadDualKeys.length > 0) {
    tail.push(`Canonical character fields with payload mirrors on this card: ${c.payloadDualKeys.join(', ')}. Edit the canonical (top-level) side; the payload mirror is a translator output and is refused.`);
  }
  if (c.attachedModuleCount > 0) {
    tail.push('');
    tail.push('## Attached modules');
    tail.push('');
    tail.push(`${c.attachedModuleCount} module(s) attached. Module-scoped content (lorebook, regex, triggers, lua, bg-html, scriptstate defaults) lives in separate envelopes; the lorebook + regex are also installed as top-level mirrors editable via the normal path-based tools. For migration-safe edits, use the envelope: \`list_external\` / \`read_external\` / \`grep_external\` / \`edit_external\` / \`update_external\` with \`surface_id='module_envelope'\`. When the user mentions content you cannot find on this character's surfaces, check the attached modules before saying it is missing.`);
  }
  if (c.translatorSchemaVersion !== null) {
    tail.push('');
    tail.push(`Stored translator schema version: ${c.translatorSchemaVersion}.`);
  }
  return tail.length > 0 ? `${STATIC_SECTION}\n\n${tail.join('\n')}` : STATIC_SECTION;
}

async function buildSystemPromptFragment(spindle: SpindleAPI, userId: string, characterId: string): Promise<string | null> {
  let c: CharacterDTO | null;
  try {
    c = await spindle.characters.get(characterId, userId);
  } catch {
    return null;
  }
  if (!c) return null;
  const ctx = detectContext(c);
  if (!ctx) return null;
  return buildSection(ctx);
}

// ─── ops: list_items / read_item / write_field (module_envelope) ────────

interface PhoneLineRequestBase {
  callId?: string;
  userId: string;
}

interface DescribeRequest { op: 'describe' }
interface SystemPromptRequest extends PhoneLineRequestBase { op: 'system_prompt'; characterId: string }
interface CheckWriteRequest extends PhoneLineRequestBase { op: 'check_write'; characterId: string; extPath: string }
interface CheckReadRequest extends PhoneLineRequestBase { op: 'check_read'; characterId: string; extPath: string }
interface ListItemsRequest extends PhoneLineRequestBase { op: 'list_items'; surfaceId: string; characterId?: string }
interface ReadItemRequest extends PhoneLineRequestBase { op: 'read_item'; surfaceId: string; itemId: string; field?: string }
interface WriteFieldRequest extends PhoneLineRequestBase { op: 'write_field'; surfaceId: string; itemId: string; field: string; value: unknown }
interface GrepItemsRequest extends PhoneLineRequestBase {
  op: 'grep_items';
  surfaceId: string;
  characterId?: string;
  pattern: string;
  ignoreCase?: boolean;
  fieldPrefix?: string;
  head?: number;
}

// Source discriminator shared by mutation ops that can target either a
// character or a module envelope.
type AssetSource =
  | { kind: 'character'; characterId: string }
  | { kind: 'module'; moduleId: string };

interface AssetMutateRequest extends PhoneLineRequestBase {
  op: 'asset_mutate';
  source: AssetSource;
  action:
    | { kind: 'rename'; oldName: string; newName: string }
    | { kind: 'delete'; assetNames: readonly string[] };
}

interface ModuleAttachRequest extends PhoneLineRequestBase {
  op: 'attach_module';
  characterId: string;
  moduleId: string;
}

interface ModuleDetachRequest extends PhoneLineRequestBase {
  op: 'detach_module';
  characterId: string;
  moduleId: string;
}

interface SetToggleRequest extends PhoneLineRequestBase {
  op: 'set_toggle';
  chatId: string;
  key: string;
  value: string | null;
}

interface SetChatVariableRequest extends PhoneLineRequestBase {
  op: 'set_chat_variable';
  chatId: string;
  key: string;
  value: string | null;
}

interface SetDefaultVariablesTextRequest extends PhoneLineRequestBase {
  op: 'set_default_variables_text';
  characterId: string;
  text: string | null;
}

type PhoneLineRequest =
  | DescribeRequest
  | SystemPromptRequest
  | CheckWriteRequest
  | CheckReadRequest
  | ListItemsRequest
  | ReadItemRequest
  | WriteFieldRequest
  | GrepItemsRequest
  | AssetMutateRequest
  | ModuleAttachRequest
  | ModuleDetachRequest
  | SetToggleRequest
  | SetChatVariableRequest
  | SetDefaultVariablesTextRequest;

export type OnModuleEnvelopeWritten = (env: ModuleEnvelope, userId: string) => Promise<void> | void;

type AssetMutationLikeMessage =
  | { type: 'rename_asset'; source: AssetSource; oldName: string; newName: string }
  | { type: 'delete_assets'; source: AssetSource; assetNames: readonly string[] };

export interface MutationDeps {
  // Each is wired to the same internal function the WS handler calls, so the
  // refresh and invalidation side effects happen identically to a UI-driven
  // edit.
  readonly mutateAssetIndex?: (
    msg: AssetMutationLikeMessage,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly attachModuleToCharacter?: (
    characterId: string,
    moduleId: string,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly detachModuleFromCharacter?: (
    characterId: string,
    moduleId: string,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly writeToggleValue?: (
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly writeLocalVariable?: (
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly setDefaultVariablesText?: (
    characterId: string,
    text: string | null,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
}

function* walkEnvelopeStringLeaves(value: unknown, prefix: string): Generator<{ path: string; text: string }> {
  if (typeof value === 'string') {
    if (value.length > 0) yield { path: prefix, text: value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* walkEnvelopeStringLeaves(value[i], prefix.length === 0 ? `[${i}]` : `${prefix}[${i}]`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield* walkEnvelopeStringLeaves(v, prefix.length === 0 ? k : `${prefix}.${k}`);
    }
  }
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

async function doGrepItems(
  spindle: SpindleAPI,
  moduleStorage: () => UserStorageLike,
  req: GrepItemsRequest,
): Promise<unknown> {
  if (req.surfaceId !== 'module_envelope') {
    throw new Error(`unknown surface: ${req.surfaceId}`);
  }
  let re: RegExp;
  try {
    re = new RegExp(req.pattern, req.ignoreCase ? 'i' : '');
  } catch (err) {
    throw new Error(`invalid pattern: ${(err as Error).message}`);
  }
  let allowed: Set<string> | null = null;
  if (req.characterId) {
    const attached = await getAttachedModuleIdsForCharacter(spindle, req.userId, req.characterId);
    allowed = new Set(attached);
  }
  const summaries = await listModules(moduleStorage(), req.userId);
  const filtered = allowed === null ? [...summaries] : summaries.filter((s) => allowed!.has(s.id));
  const head = req.head ?? 200;
  const hits: Array<{ itemId: string; itemLabel: string; fieldPath: string; line: number; match: string; preview: string }> = [];
  let truncated = false;
  outer: for (const s of filtered) {
    if (hits.length >= head) { truncated = true; break; }
    const env = await readEnvelope(moduleStorage(), req.userId, s.id);
    if (!env) continue;
    const label = s.name || s.filename;
    for (const leaf of walkEnvelopeStringLeaves(env, '')) {
      if (isLorebookPath(leaf.path)) continue;
      if (req.fieldPrefix && !pathMatchesPrefix(leaf.path, req.fieldPrefix)) continue;
      const lines = leaf.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const m = re.exec(line);
        if (!m) continue;
        hits.push({
          itemId: s.id,
          itemLabel: label,
          fieldPath: leaf.path,
          line: i + 1,
          match: m[0],
          preview: line.length > 200 ? `${line.slice(0, 200)}...` : line,
        });
        if (hits.length >= head) { truncated = true; break outer; }
      }
    }
  }
  return { hits, truncated };
}

function isLorebookPath(field: string): boolean {
  return field === 'module.lorebook'
    || field.startsWith('module.lorebook.')
    || field.startsWith('module.lorebook[');
}

const MODULE_LOREBOOK_REDIRECT =
  "module.lorebook[] is the frozen import bundle from the .risum upload. The LIVE lorebook for an installed module is its world_book (one wb per module, shared across every character it's attached to). " +
  "Edits to env.module.lorebook[] don't reach the runtime or the viewer. " +
  "Use the path-based tools instead: list({path: 'wb'}) to find the module's wb (`Module: <name>`), then read/edit on wb/<id>/content or wb/<id>/comment. update_world_book_entry for metadata.";

async function dispatchModuleSurface(
  spindle: SpindleAPI,
  moduleStorage: () => UserStorageLike,
  req: ListItemsRequest | ReadItemRequest | WriteFieldRequest,
  onWritten: OnModuleEnvelopeWritten | undefined,
  log: (msg: string) => void,
): Promise<unknown> {
  if (req.surfaceId !== 'module_envelope') {
    throw new Error(`unknown surface: ${req.surfaceId}`);
  }
  if (req.op === 'list_items') {
    let allowed: Set<string> | null = null;
    if (req.characterId) {
      const attached = await getAttachedModuleIdsForCharacter(spindle, req.userId, req.characterId);
      allowed = new Set(attached);
    }
    const summaries = await listModules(moduleStorage(), req.userId);
    const filtered = allowed === null ? [...summaries] : summaries.filter((s) => allowed!.has(s.id));
    const items = filtered.map((s) => ({
      id: s.id,
      label: s.name || s.filename,
      brief: {
        filename: s.filename,
        lorebook_count: s.lorebook_count,
        regex_count: s.regex_count,
        trigger_count: s.trigger_count,
        asset_count: s.asset_count,
        low_level_access: s.low_level_access,
      },
    }));
    return { items, total: items.length };
  }
  if (req.op === 'read_item') {
    const env = await readEnvelope(moduleStorage(), req.userId, req.itemId);
    if (!env) throw new Error(`module ${req.itemId} not found`);
    if (req.field !== undefined && isLorebookPath(req.field)) {
      throw new Error(`[REFUSED_BY_EXTENSION] ${MODULE_LOREBOOK_REDIRECT}`);
    }
    if (!req.field) {
      // Whole-envelope read: strip module.lorebook so it stays opaque whether
      // the agent reads the whole envelope or a specific field.
      const m = env.module as Record<string, unknown> & { lorebook?: unknown };
      if (m && typeof m === 'object' && 'lorebook' in m) {
        const { lorebook: _omit, ...restModule } = m;
        void _omit;
        return {
          value: { ...env, module: restModule },
          meta: { lorebook_redirect: MODULE_LOREBOOK_REDIRECT },
        };
      }
      return { value: env };
    }
    const segs = parsePath(req.field);
    return { value: getAtPath(env, segs) };
  }
  if (isLorebookPath(req.field)) {
    return { ok: false, error: `[REFUSED_BY_EXTENSION] ${MODULE_LOREBOOK_REDIRECT}` };
  }
  const env = await readEnvelope(moduleStorage(), req.userId, req.itemId);
  if (!env) throw new Error(`module ${req.itemId} not found`);
  const segs = parsePath(req.field);
  const next = setAtPath(env, segs, req.value) as ModuleEnvelope;
  if (next.schema_version !== env.schema_version) {
    return { ok: false, error: 'cannot change schema_version via write_field' };
  }
  if (next.id !== env.id) {
    return { ok: false, error: 'cannot change module id via write_field' };
  }
  await writeEnvelope(moduleStorage(), req.userId, next);
  if (onWritten) {
    try {
      await onWritten(next, req.userId);
    } catch (err) {
      log(`lumiagent-phoneline: onModuleEnvelopeWritten threw for module=${next.id}: ${(err as Error).message}`);
    }
  }
  return { ok: true };
}

// Whitelist of extension IDs allowed to dial our phone line. Spindle's
// `rpcPool` has no host-side permission gate, this is the extension's own
// authority check on who can ask. New well-known callers get appended.
const ALLOWED_CALLERS: ReadonlySet<string> = new Set(['lumiagent']);

function notWired(op: string): { ok: false; error: string } {
  return { ok: false, error: `op ${op} not wired on this host (no mutation deps passed to registerLumiagentPhoneline)` };
}

async function dispatchMutation(
  req:
    | AssetMutateRequest
    | ModuleAttachRequest
    | ModuleDetachRequest
    | SetToggleRequest
    | SetChatVariableRequest
    | SetDefaultVariablesTextRequest,
  mutations: MutationDeps,
): Promise<{ ok: boolean; error?: string }> {
  if (req.op === 'asset_mutate') {
    if (!mutations.mutateAssetIndex) return notWired('asset_mutate');
    const msg: AssetMutationLikeMessage = req.action.kind === 'rename'
      ? { type: 'rename_asset', source: req.source, oldName: req.action.oldName, newName: req.action.newName }
      : { type: 'delete_assets', source: req.source, assetNames: req.action.assetNames };
    if (msg.type === 'delete_assets' && msg.assetNames.length === 0) {
      return { ok: false, error: 'asset_delete: assetNames is empty' };
    }
    const r = await mutations.mutateAssetIndex(msg, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  if (req.op === 'attach_module') {
    if (!mutations.attachModuleToCharacter) return notWired('attach_module');
    const r = await mutations.attachModuleToCharacter(req.characterId, req.moduleId, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  if (req.op === 'detach_module') {
    if (!mutations.detachModuleFromCharacter) return notWired('detach_module');
    const r = await mutations.detachModuleFromCharacter(req.characterId, req.moduleId, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  if (req.op === 'set_toggle') {
    if (!mutations.writeToggleValue) return notWired('set_toggle');
    const r = await mutations.writeToggleValue(req.chatId, req.key, req.value, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  if (req.op === 'set_chat_variable') {
    if (!mutations.writeLocalVariable) return notWired('set_chat_variable');
    const r = await mutations.writeLocalVariable(req.chatId, req.key, req.value, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  if (req.op === 'set_default_variables_text') {
    if (!mutations.setDefaultVariablesText) return notWired('set_default_variables_text');
    const r = await mutations.setDefaultVariablesText(req.characterId, req.text, req.userId);
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'failed' };
  }
  return { ok: false, error: 'unknown mutation op' };
}

export interface BridgeStatusBroadcast {
  readonly offline: boolean;
  readonly missingPermissions: readonly string[];
  readonly forCaller?: string;
}

// Per-caller failure state, populated on inheritance-check failures at
// envelope-read time and cleared on the next successful read from that
// caller. Survives between calls so the banner reflects the last outcome.
const lastDialFailure = new Map<string, readonly string[]>();

function parseInheritanceError(message: string): readonly string[] | null {
  // Host throws: 'Shared RPC endpoint "X" requires requester "R" to inherit
  // owner "O" permissions: a, b, c'. We wrap that in 'could not read pending
  // request from <id>: <innerMessage>' on rethrow but the substring we match
  // on is preserved either way.
  const m = /requires requester "[^"]+" to inherit owner "[^"]+" permissions: ([^]+?)$/.exec(message);
  if (!m) return null;
  const perms = m[1]!.split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
  return perms.length > 0 ? perms : null;
}

function buildBridgeBroadcast(): BridgeStatusBroadcast {
  if (lastDialFailure.size === 0) {
    return { offline: false, missingPermissions: [] };
  }
  // Aggregate across callers. If multiple bridges are failing, surface the
  // union of missing perms and tag whichever caller failed most recently
  // (the Map preserves insertion order, last set() wins).
  const perms = new Set<string>();
  let forCaller: string | undefined;
  for (const [caller, missing] of lastDialFailure) {
    forCaller = caller;
    for (const p of missing) perms.add(p);
  }
  return {
    offline: true,
    missingPermissions: [...perms].sort(),
    ...(forCaller ? { forCaller } : {}),
  };
}

export function registerLumiagentPhoneline(
  spindle: SpindleAPI,
  moduleStorage: () => UserStorageLike,
  log: (msg: string) => void = () => {},
  onModuleEnvelopeWritten?: OnModuleEnvelopeWritten,
  mutations: MutationDeps = {},
  notifyBridgeStatus: (payload: BridgeStatusBroadcast) => void = () => {},
): void {
  spindle.rpcPool.handle('lumirealm.phoneline', async (rctx) => {
    const requesterId = rctx.requesterExtensionId;
    if (!requesterId) throw new Error('requester extension id missing');
    if (!ALLOWED_CALLERS.has(requesterId)) {
      log(`lumiagent-phoneline: rejected call from unauthorised extension "${requesterId}"`);
      throw new Error('not authorised');
    }
    let req: PhoneLineRequest;
    try {
      req = await spindle.rpcPool.read<PhoneLineRequest>(`${requesterId}.phoneline_request`);
    } catch (err) {
      const message = (err as Error).message;
      // Confused-deputy defence in the host throws this shape when LumiRealm
      // does not declare every permission the caller does. Record the failure
      // for the banner and rethrow so the caller's dial fails as before.
      const missing = parseInheritanceError(message);
      if (missing) {
        lastDialFailure.set(requesterId, missing);
        log(`lumiagent-phoneline: bridge offline, LumiRealm missing perms the "${requesterId}" caller declares: [${missing.join(',')}]`);
        try { notifyBridgeStatus(buildBridgeBroadcast()); } catch { /* */ }
      }
      throw new Error(`could not read pending request from ${requesterId}: ${message}`);
    }
    // Envelope read succeeded. Only push when this caller's prior dial had
    // failed, so successful calls on a healthy bridge don't fan out a no-op
    // notification per call.
    if (lastDialFailure.delete(requesterId)) {
      log(`lumiagent-phoneline: bridge restored for "${requesterId}"`);
      try { notifyBridgeStatus(buildBridgeBroadcast()); } catch { /* */ }
    }
    if (!req || typeof req !== 'object') throw new Error('malformed request');

    if (req.op === 'describe') return MANIFEST;

    if (!req.userId) throw new Error('request missing userId');

    if (req.op === 'system_prompt') {
      const text = await buildSystemPromptFragment(spindle, req.userId, req.characterId);
      return { text };
    }
    if (req.op === 'check_write') {
      return checkWritePath(req.extPath);
    }
    if (req.op === 'check_read') {
      return checkReadPath(req.extPath);
    }
    if (req.op === 'list_items' || req.op === 'read_item' || req.op === 'write_field') {
      return dispatchModuleSurface(spindle, moduleStorage, req, onModuleEnvelopeWritten, log);
    }
    if (req.op === 'grep_items') {
      return doGrepItems(spindle, moduleStorage, req);
    }
    if (
      req.op === 'asset_mutate' ||
      req.op === 'attach_module' ||
      req.op === 'detach_module' ||
      req.op === 'set_toggle' ||
      req.op === 'set_chat_variable' ||
      req.op === 'set_default_variables_text'
    ) {
      return dispatchMutation(req, mutations);
    }
    throw new Error(`unknown op: ${(req as { op?: string }).op}`);
  });

  log('lumiagent phone line ready (manifest, system_prompt, check_write, check_read, module_envelope, mutations)');
}
