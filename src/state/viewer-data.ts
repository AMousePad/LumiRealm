// Pure projections from lumirealm character data or module envelope to ViewerData wire shape.

import type {
  ViewerAssetEntry,
  ViewerData,
  ViewerLorebookEntry,
  ViewerLorebookGroup,
  ViewerRegexEntry,
  ViewerTriggerEffectSummary,
  ViewerTriggerEntry,
} from '../types/messages.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';
import { imageUrlFromId } from '../interpreter/image-cache.js';
import { extractCardSideBackgroundHtml } from '../core/mappers/background-html.js';
import { summarizeEffect } from './viewer-effects.js';
import { loreBookSchema } from '../core/schemas/lorebook.js';
import { mapLoreBookWithStats } from '../core/mappers/lorebook.js';

const imageUrl = (imageId: string) => imageUrlFromId(imageId);

function pickBackgroundHtmlForViewer(data: LumirealmCharacterData): string | null {
  const userRaw = data.payload.background_html_source;
  if (typeof userRaw === 'string') return userRaw.length > 0 ? userRaw : null;
  const cardSideRaw = extractCardSideBackgroundHtml(data);
  if (cardSideRaw !== null) return cardSideRaw;
  const translated = data.payload.background_html;
  return typeof translated === 'string' && translated.length > 0 ? translated : null;
}


function serializeDefaultsToText(rec: Readonly<Record<string, string>>): string {
  const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b));
  return keys.map((k) => `${k}=${rec[k] ?? ''}`).join('\n');
}

function computeDefaultsText(
  cardDefaults: Readonly<Record<string, string>>,
  masterText: string | undefined,
  legacyOverrides: Readonly<Record<string, string>> | undefined,
): { defaultVariablesText: string; defaultVariablesUserEdited: boolean } {
  if (typeof masterText === 'string') {
    return { defaultVariablesText: masterText, defaultVariablesUserEdited: true };
  }
  if (legacyOverrides && Object.keys(legacyOverrides).length > 0) {
    const merged: Record<string, string> = { ...cardDefaults, ...legacyOverrides };
    return { defaultVariablesText: serializeDefaultsToText(merged), defaultVariablesUserEdited: true };
  }
  return { defaultVariablesText: serializeDefaultsToText(cardDefaults), defaultVariablesUserEdited: false };
}


export interface FetchedWorldBook {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly FetchedWorldBookEntry[];
}

export interface FetchedWorldBookEntry {
  readonly id: string;
  readonly key: readonly string[];
  readonly content: string;
  readonly comment?: string;
  readonly disabled?: boolean;
  readonly constant?: boolean;
  readonly orderValue?: number;
  readonly priority?: number;
  readonly position?: number;
  readonly depth?: number;
  readonly extensions?: Readonly<Record<string, unknown>> | null;
}

export function buildCharacterViewerData(input: {
  characterId: string;
  characterName: string;
  data: LumirealmCharacterData;
  creatorNotes?: string;
  worldBooks?: readonly FetchedWorldBook[];
  extraCharacterRegex?: readonly LumiSideRegex[];
  fetchWarnings?: readonly string[];
  ts?: number;
  /** Per-source-hash translation map from envelope.translations[lang].lorebook
   *  AND any module-attached envelopes' translations[lang].lorebook merged. */
  translatedCommentBySourceHash?: ReadonlyMap<string, string>;
  /** Pre-composed translated divider per world_book id. Empty/missing entries
   *  leave the original groupName visible. */
  translatedGroupNameByWbId?: ReadonlyMap<string, string>;
  /** wb-id -> attached module envelope id. Populated for groups whose lore
   *  comes from an attached module (vs the character's own world_book). */
  moduleIdByWbId?: ReadonlyMap<string, string>;
}): ViewerData {
  const triggers: ViewerTriggerEntry[] = [];
  const trArr = input.data.payload.triggers;
  const luArr = input.data.payload.lua_scripts;
  for (let i = 0; i < trArr.length; i++) {
    triggers.push(toViewerTrigger(`char-trig-${i}`, trArr[i], luArr[i] ?? '', i));
  }

  const assets: ViewerAssetEntry[] = [];
  for (const [name, entry] of Object.entries(input.data.asset_index)) {
    const ids = entry.imageIds;
    if (ids.length === 0) continue;
    assets.push({
      name,
      url: imageUrl(ids[0]!),
      multi: ids.length > 1,
      ...(entry.ext !== undefined ? { ext: entry.ext } : {}),
    });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name)); // stable order for the UI

  const backgroundHtml = pickBackgroundHtmlForViewer(input.data);

  const cardDefaults = input.data.payload.scriptstate_defaults ?? {};
  const masterText = input.data.user_overrides.default_variables_text;
  const legacyOverrides = input.data.user_overrides.default_variables_overrides;
  const { defaultVariablesText, defaultVariablesUserEdited } = computeDefaultsText(
    cardDefaults,
    masterText,
    legacyOverrides,
  );

  const lorebook: ViewerLorebookGroup[] = [];
  for (const wb of input.worldBooks ?? []) {
    if (wb.entries.length === 0) continue;
    const entries: ViewerLorebookEntry[] = wb.entries.map((e) => {
      const ext = (e.extensions ?? {}) as Record<string, unknown>;
      const arrIdxRaw = ext['_risu_array_index'];
      const arrayIndex = typeof arrIdxRaw === 'number' ? arrIdxRaw : null;
      const fromRisu = typeof ext['_risu_source_hash'] === 'string';
      const risuModeRaw = ext['risu_mode'];
      const risuMode = typeof risuModeRaw === 'string' ? risuModeRaw : undefined;
      const risuFolderRaw = ext['risu_folder'];
      const risuFolderRef = typeof risuFolderRaw === 'string' && risuFolderRaw.length > 0
        ? risuFolderRaw
        : undefined;
      const risuFolderKey = risuMode === 'folder' && e.key.length > 0 && e.key[0]!.length > 0
        ? e.key[0]!
        : undefined;
      const sourceHashRaw = ext['_risu_source_hash'];
      const sourceHash = typeof sourceHashRaw === 'string' ? sourceHashRaw : undefined;
      const translatedComment = sourceHash !== undefined
        ? input.translatedCommentBySourceHash?.get(sourceHash)
        : undefined;
      const built: ViewerLorebookEntry = {
        id: e.id,
        key: e.key,
        content: e.content,
        ...(e.comment !== undefined ? { comment: e.comment } : {}),
        ...(e.disabled !== undefined ? { disabled: e.disabled } : {}),
        ...(e.constant !== undefined ? { constant: e.constant } : {}),
        arrayIndex,
        ...(e.orderValue !== undefined ? { orderValue: e.orderValue } : {}),
        ...(e.priority !== undefined ? { priority: e.priority } : {}),
        ...(e.position !== undefined ? { position: e.position } : {}),
        ...(e.depth !== undefined ? { depth: e.depth } : {}),
        fromRisu,
        ...(risuMode !== undefined ? { risuMode } : {}),
        ...(risuFolderKey !== undefined ? { risuFolderKey } : {}),
        ...(risuFolderRef !== undefined ? { risuFolderRef } : {}),
        ...(sourceHash !== undefined ? { sourceHash } : {}),
        ...(translatedComment !== undefined ? { translatedComment } : {}),
      };
      return built;
    });
    sortLorebookEntries(entries);
    const tx = input.translatedGroupNameByWbId?.get(wb.id);
    const moduleId = input.moduleIdByWbId?.get(wb.id);
    lorebook.push({
      groupName: wb.name,
      ...(tx !== undefined ? { translatedGroupName: tx } : {}),
      groupId: wb.id,
      ...(moduleId !== undefined ? { moduleId } : {}),
      entries,
    });
  }

  return {
    source: { kind: 'character', characterId: input.characterId, name: input.characterName },
    lorebook,
    regex: [],
    triggers,
    assets,
    cjs: null,
    backgroundHtml,
    defaultVariablesText,
    defaultVariablesUserEdited,
    ts: input.ts ?? Date.now(),
    fetchWarnings: input.fetchWarnings ?? [],
    ...(input.data.source === undefined ? { lorebookNeedsReimport: true } : {}),
    ...(input.creatorNotes && input.creatorNotes.length > 0
      ? { creatorNotes: input.creatorNotes }
      : {}),
  };
}

// Risu-faithful order. User-added entries (no arrayIndex) sort last by orderValue.
function sortLorebookEntries(entries: ViewerLorebookEntry[]): void {
  entries.sort((a, b) => {
    const ai = a.arrayIndex;
    const bi = b.arrayIndex;
    if (ai != null && bi != null) {
      if (ai !== bi) return ai - bi;
    } else if (ai != null) {
      return -1;
    } else if (bi != null) {
      return 1;
    }
    const ao = a.orderValue ?? 0;
    const bo = b.orderValue ?? 0;
    return ao - bo;
  });
}

export interface LumiSideRegex {
  readonly id: string;
  readonly name?: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly placement?: readonly string[];
  readonly target?: string;
  readonly disabled?: boolean;
  readonly metadata?: Record<string, unknown>;
}

function toViewerTrigger(
  fallbackId: string,
  rawTrigger: unknown,
  lua: string,
  idx: number,
): ViewerTriggerEntry {
  const t = (rawTrigger ?? {}) as {
    comment?: unknown;
    type?: unknown;
    effect?: unknown[];
  };
  const name = typeof t.comment === 'string' && t.comment.length > 0
    ? t.comment
    : `trigger #${idx + 1}`;
  const bindingType = typeof t.type === 'string' ? t.type : 'unknown';
  const effects: ViewerTriggerEffectSummary[] = [];
  if (Array.isArray(t.effect)) {
    for (const e of t.effect) {
      if (e && typeof e === 'object' && (e as { type?: unknown }).type === 'triggerlua') continue;
      effects.push(summarizeEffect(e));
    }
  }
  return {
    id: fallbackId,
    name,
    bindingType,
    lua: lua.length > 0 ? lua : null,
    effectCount: Array.isArray(t.effect) ? t.effect.length : 0,
    effects,
  };
}


export function buildModuleViewerData(input: {
  envelope: ModuleEnvelope;
  worldBook?: FetchedWorldBook;
  ts?: number;
}): ViewerData {
  const env = input.envelope;
  const m = env.module as {
    name?: unknown;
    lorebook?: readonly unknown[];
    regex?: readonly unknown[];
    trigger?: readonly unknown[];
    cjs?: unknown;
    backgroundEmbedding?: unknown;
  };
  const moduleName = typeof m.name === 'string' && m.name.length > 0
    ? m.name
    : env.id;

  const lang = 'en';
  const moduleLore = env.translations?.[lang]?.lorebook;
  const lorebookEntries: ViewerLorebookEntry[] = [];

  if (input.worldBook && input.worldBook.entries.length > 0) {
    // Primary path: read live entries from the installed wb. User and agent
    // edits show up here. Translation cache still keys on _risu_source_hash
    // which install + sync stamp onto entry.extensions.
    for (const e of input.worldBook.entries) {
      const ext = (e.extensions ?? {}) as Record<string, unknown>;
      const sourceHashRaw = ext['_risu_source_hash'];
      const sourceHash = typeof sourceHashRaw === 'string' ? sourceHashRaw : undefined;
      const translatedComment = sourceHash !== undefined && moduleLore
        ? moduleLore[sourceHash]?.comment
        : undefined;
      const arrIdxRaw = ext['_risu_array_index'];
      const arrayIndex = typeof arrIdxRaw === 'number' ? arrIdxRaw : null;
      lorebookEntries.push({
        id: e.id,
        key: e.key,
        content: e.content,
        ...(e.comment !== undefined ? { comment: e.comment } : {}),
        ...(e.disabled !== undefined ? { disabled: e.disabled } : {}),
        ...(e.constant !== undefined ? { constant: e.constant } : {}),
        arrayIndex,
        ...(sourceHash !== undefined ? { sourceHash, fromRisu: true } : {}),
        ...(translatedComment !== undefined ? { translatedComment } : {}),
      });
    }
    sortLorebookEntries(lorebookEntries);
  } else if (Array.isArray(m.lorebook)) {
    // Fallback: wb is missing (legacy module with no installed_world_book_id,
    // or the wb was deleted out from under us). Project from the envelope
    // through the same mapper install uses so source-hashes still match.
    const projectedHashByIndex = new Map<number, string>();
    const valid: import('../core/schemas/lorebook.js').LoreBook[] = [];
    const validIndexes: number[] = [];
    for (let i = 0; i < m.lorebook.length; i++) {
      const parsed = loreBookSchema.safeParse(m.lorebook[i]);
      if (!parsed.success) continue;
      const lb = parsed.data;
      if (lb.key.length === 0 && lb.content.length === 0) continue;
      valid.push(lb);
      validIndexes.push(i);
    }
    if (valid.length > 0) {
      const projected = mapLoreBookWithStats(valid, { worldBookId: 'module-viewer' }).entries;
      for (let j = 0; j < projected.length; j++) {
        const ext = projected[j]!.extensions as Record<string, unknown> | undefined;
        const hash = ext?.['_risu_source_hash'];
        if (typeof hash === 'string') {
          projectedHashByIndex.set(validIndexes[j]!, hash);
        }
      }
    }
    for (let i = 0; i < m.lorebook.length; i++) {
      const e = m.lorebook[i];
      if (!e || typeof e !== 'object') continue;
      const eo = e as Record<string, unknown>;
      const keyRaw = eo['key'];
      const key = Array.isArray(keyRaw)
        ? keyRaw.filter((x): x is string => typeof x === 'string')
        : typeof keyRaw === 'string'
          ? [keyRaw]
          : [];
      const sourceHash = projectedHashByIndex.get(i);
      const translatedComment = sourceHash !== undefined && moduleLore
        ? moduleLore[sourceHash]?.comment
        : undefined;
      lorebookEntries.push({
        id: `mod-lore-${i}`,
        key,
        content: typeof eo['content'] === 'string' ? eo['content'] : '',
        ...(typeof eo['comment'] === 'string' ? { comment: eo['comment'] } : {}),
        ...(typeof eo['disabled'] === 'boolean' ? { disabled: eo['disabled'] } : {}),
        ...(typeof eo['constant'] === 'boolean' ? { constant: eo['constant'] } : {}),
        ...(sourceHash !== undefined ? { sourceHash, fromRisu: true } : {}),
        ...(translatedComment !== undefined ? { translatedComment } : {}),
      });
    }
  }
  const translatedModuleName = env.translations?.[lang]?.name;
  const lorebook: ViewerLorebookGroup[] = lorebookEntries.length > 0
    ? [{
        groupName: moduleName,
        ...(translatedModuleName !== undefined && translatedModuleName !== moduleName
          ? { translatedGroupName: translatedModuleName }
          : {}),
        groupId: input.worldBook?.id ?? 'module',
        moduleId: env.id,
        entries: lorebookEntries,
      }]
    : [];

  // Modules have no stable Lumi-side ids until attach; synthesize per-index ids.
  const regex: ViewerRegexEntry[] = [];
  if (Array.isArray(m.regex)) {
    for (let i = 0; i < m.regex.length; i++) {
      const r = m.regex[i];
      if (!r || typeof r !== 'object') continue;
      const ro = r as Record<string, unknown>;
      const find = typeof ro['in'] === 'string' ? ro['in'] : '';
      const replace = typeof ro['out'] === 'string' ? ro['out'] : '';
      const comment = typeof ro['comment'] === 'string' ? ro['comment'] : '';
      if (find.length === 0) {
        if (comment.length === 0) continue;
        regex.push({
          id: `mod-regex-${i}`,
          name: comment,
          find: '',
          replace: '',
          placement: '',
          target: '',
          disabled: false,
          moduleId: env.id,
          divider: true,
        });
        continue;
      }
      const ruleType = typeof ro['type'] === 'string' ? ro['type'] : 'editdisplay';
      regex.push({
        id: `mod-regex-${i}`,
        name: comment.length > 0 ? comment : `rule_${i + 1}`,
        find,
        replace,
        placement: '(see attach)',
        target: ruleType,
        disabled: ruleType === 'disabled',
        moduleId: env.id,
      });
    }
  }

  const triggers: ViewerTriggerEntry[] = [];
  if (Array.isArray(m.trigger)) {
    for (let i = 0; i < m.trigger.length; i++) {
      const t = m.trigger[i];
      const tEff = (t as { effect?: readonly unknown[] }).effect ?? [];
      const luaParts: string[] = [];
      for (const e of tEff) {
        const eo = e as { type?: string; code?: string };
        if (eo.type === 'triggerlua' && typeof eo.code === 'string') {
          luaParts.push(eo.code);
        }
      }
      triggers.push(toViewerTrigger(`mod-trig-${i}`, t, luaParts.join('\n'), i));
    }
  }

  const assets: ViewerAssetEntry[] = [];
  for (const [name, ref] of Object.entries(env.asset_index)) {
    assets.push({
      name,
      url: imageUrl(ref.imageId),
      multi: false,
      ...(ref.ext !== undefined ? { ext: ref.ext } : {}),
    });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name));

  return {
    source: { kind: 'module', moduleId: env.id, name: moduleName },
    lorebook,
    regex,
    triggers,
    assets,
    cjs: typeof m.cjs === 'string' && m.cjs.length > 0 ? m.cjs : null,
    backgroundHtml: typeof m.backgroundEmbedding === 'string' && m.backgroundEmbedding.length > 0
      ? m.backgroundEmbedding
      : null,
    defaultVariablesText: '', // modules don't carry scriptstate defaults
    defaultVariablesUserEdited: false,
    ts: input.ts ?? Date.now(),
    fetchWarnings: [],
  };
}
