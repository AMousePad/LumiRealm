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
import { parseBridgePermissionError } from './bridge-permissions.js';
import { DOCS_HINT, DOCS_SURFACE, listDocs, readDoc } from './agent-docs.js';

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
    { id: DOCS_SURFACE, label: 'LumiRealm guide', scope: 'global', description: DOCS_HINT },
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
const AUTHORING_HINT = 'Edit canonical char/rx/wb fields, payload.background_html_source, triggers and scriptstate_defaults; never frozen source, derived mirrors or user_overrides. Use dedicated asset/module/state tools for mutations. Check coupled names/keys/buttons before renaming; translations change visible literals, not code or IDs.';

async function buildSystemPromptFragment(spindle: SpindleAPI, userId: string, characterId: string): Promise<string | null> {
  let character: CharacterDTO | null;
  try {
    character = await spindle.characters.get(characterId, userId);
  } catch {
    return null;
  }
  const realm = character?.extensions?.['lumirealm'];
  if (!realm || typeof realm !== 'object') return null;
  return `${DOCS_HINT}\n${AUTHORING_HINT}`;
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
      const message = err instanceof Error ? err.message : String(err);
      const missing = parseBridgePermissionError(message);
      if (missing) {
        lastDialFailure.set(requesterId, missing);
        log(`lumiagent-phoneline: bridge offline, LumiRealm missing permissions: [${missing.join(',')}]`);
        try { notifyBridgeStatus(buildBridgeBroadcast()); } catch { /* */ }
      } else if (lastDialFailure.delete(requesterId)) {
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
      if (req.surfaceId === DOCS_SURFACE) {
        if (req.op === 'list_items') return listDocs();
        if (req.op === 'read_item') return readDoc(req.itemId, req.field);
        return { ok: false, error: 'LumiRealm docs are read-only.' };
      }
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
