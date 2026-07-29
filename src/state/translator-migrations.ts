// Per-version migration registry. Steps are walked sequentially, persisting
// after each apply for resumability across worker restarts.

import { translateFromStoredSource } from '../core/pipeline/translate.js';
import { prepareBackgroundHtmlForRuntime } from '../core/mappers/background-html.js';
import { unprefixCssInStyleBlocks } from '../bghtml/rewriter.js';
import { replaceStringHasPerMessageMacro } from '../core/mappers/regex.js';
import type { LumiBundle } from '../core/pipeline/index.js';
import type { SvgRasterTask } from '../core/svg-rasterize.js';
import {
  type AssetIndexEntry,
  type LumirealmCharacterData,
  type StoredRegexScript,
} from '../payload/types.js';
import { buildAssetIndexes } from '../payload/import.js';
import {
  LEGACY_ENTRY_HASH_FIELDS_V1,
  computeEntrySourceHashWithFields,
} from '../core/mappers/lorebook-hash.js';

export interface LiveWorldBookEntry {
  readonly id: string;
  readonly exclude_greeting: boolean;
  readonly extensions: Readonly<Record<string, unknown>> | null;
}

export interface MigrationDeps {
  installCharacterRegexScripts: (
    characterId: string,
    characterName: string,
    scripts: readonly StoredRegexScript[],
  ) => Promise<void>;
  reinstallAttachedModules: (characterId: string) => Promise<number>;
  dispatchSvgRasterize: (
    characterId: string,
    characterName: string,
    svgs: readonly SvgRasterTask[],
  ) => void;
  writeEnvelope: (
    characterId: string,
    data: LumirealmCharacterData,
    userId: string,
  ) => Promise<void>;
  // For `ccdefault:` URI resolution during asset_index rebuild.
  getAvatarImageId: (characterId: string, userId: string) => Promise<string | null>;
  // v6: in-place backfill of extensions._risu_array_index on existing WB entries.
  getCharacterWorldBookIds: (characterId: string, userId: string) => Promise<readonly string[]>;
  listWorldBookEntries: (worldBookId: string, userId: string) => Promise<readonly LiveWorldBookEntry[]>;
  updateWorldBookEntryExtensions: (
    entryId: string,
    extensions: Readonly<Record<string, unknown>>,
    userId: string,
  ) => Promise<void>;
  updateWorldBookEntryActivation: (
    entryId: string,
    input: {
      readonly exclude_greeting: boolean;
      readonly extensions: Readonly<Record<string, unknown>>;
    },
    userId: string,
  ) => Promise<void>;
  // Walks Lumi's regex_scripts for character scope, applies transform per row's
  // replace_string, updates only rows where the result differs. Returns null if
  // the host lacks the update API (caller should fall back).
  applyCharacterRegexReplaceStringTransform?: (
    characterId: string,
    userId: string,
    transform: (replaceString: string) => string,
  ) => Promise<{ scanned: number; updated: number; failed: number } | null>;
  // Multi-field patch over character-scoped Risu rows. `patch` returns the
  // partial fields to update, or null to skip the row.
  applyCharacterRegexRowPatch?: (
    characterId: string,
    userId: string,
    patch: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  ) => Promise<{ scanned: number; updated: number; failed: number } | null>;
  log: {
    info: (s: string) => void;
    warn: (s: string) => void;
    error: (s: string) => void;
  };
  extensionVersion: string;
}

export interface MigrationArgs {
  characterId: string;
  characterName: string;
  userId: string;
  envelope: LumirealmCharacterData;
}

export interface CharacterMigrationStepArgs {
  readonly envelope: LumirealmCharacterData;
  readonly characterId: string;
  readonly characterName: string;
  readonly userId: string;
  readonly newBundle: LumiBundle;
}

export interface CharacterMigrationStepResult {
  readonly nextEnvelope: LumirealmCharacterData;
  readonly notes: readonly string[];
}

export interface CharacterMigrationStep {
  readonly version: number;
  readonly description: string;
  // Surfaces this step touches. Documentation only, not enforced.
  readonly touches: readonly (
    | 'asset_index'
    | 'emotion_index'
    | 'regex_scripts'
    | 'world_book_entries'
    | 'svg_raster'
    | 'payload.additional_assets'
    | 'payload.emotion_images'
    | 'payload.background_html'
    | 'payload.triggers'
    | 'payload.lua_scripts'
    | 'attached_modules'
  )[];
  readonly apply: (
    args: CharacterMigrationStepArgs,
    deps: MigrationDeps,
  ) => Promise<CharacterMigrationStepResult>;
}

export type MigrationResult =
  | { kind: 'noop'; storedVersion: number }
  | {
      kind: 'migrated';
      from: number;
      to: number;
      stepsApplied: ReadonlyArray<{ version: number; notes: readonly string[] }>;
    }
  | { kind: 'needs_reimport'; reason: 'no_source'; storedVersion: number }
  | { kind: 'failed'; from: number; to: number; error: string; partialAt?: number };

async function applyV5AssetIndexRebuild(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  const source = args.envelope.source;
  if (!source) throw new Error('v5 requires envelope.source');
  const pathToImageId = source.path_to_image_id ?? {};

  // Empty path_to_image_id means we have no way to resolve translator-output
  // asset paths to image_ids. Preserve the stored indexes rather than wipe.
  if (Object.keys(pathToImageId).length === 0) {
    return {
      nextEnvelope: {
        ...args.envelope,
        payload: {
          ...args.envelope.payload,
          additional_assets: args.newBundle.risuPayload!.additional_assets,
          emotion_images: args.newBundle.risuPayload!.emotion_images,
        },
      },
      notes: ['skipped: source.path_to_image_id is empty'],
    };
  }

  let avatarImageId: string | null = null;
  try {
    avatarImageId = await deps.getAvatarImageId(args.characterId, args.userId);
  } catch (err) {
    deps.log.warn(
      `migrate(${args.characterId}) v5: getAvatarImageId failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const rebuilt = buildAssetIndexes(
    {
      additional_assets: args.newBundle.risuPayload!.additional_assets,
      emotion_images: args.newBundle.risuPayload!.emotion_images,
    },
    pathToImageId,
    avatarImageId,
  );
  const nextEnvelope: LumirealmCharacterData = {
    ...args.envelope,
    asset_index: rebuilt.assetIndex as Readonly<Record<string, AssetIndexEntry>>,
    emotion_index: rebuilt.emotionIndex as Readonly<Record<string, AssetIndexEntry>>,
    payload: {
      ...args.envelope.payload,
      additional_assets: args.newBundle.risuPayload!.additional_assets,
      emotion_images: args.newBundle.risuPayload!.emotion_images,
    },
  };
  return {
    nextEnvelope,
    notes: [
      `assets=${Object.keys(rebuilt.assetIndex).length}`,
      `emotions=${Object.keys(rebuilt.emotionIndex).length}`,
    ],
  };
}

async function applyV7ReinstallRegex(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  const stored: StoredRegexScript[] = args.newBundle.regexScripts.map((r) => ({
    name: r.name,
    script_id: r.script_id,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: [...r.placement],
    scope: r.scope,
    scope_id: r.scope === 'character' ? args.characterId : r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: [...r.trim_strings],
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    metadata: { ...(r.metadata ?? {}) },
  }));
  await deps.installCharacterRegexScripts(args.characterId, args.characterName, stored);
  const dividerCount = stored.filter((s) => {
    const m = s.metadata as { _risu?: { source_type?: string } } | undefined;
    return m?._risu?.source_type === 'divider';
  }).length;
  return {
    nextEnvelope: args.envelope,
    notes: [`reinstalled ${stored.length} regex_script(s), dividers=${dividerCount}`],
  };
}

async function applyV6BackfillArrayIndex(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  // _risu_array_index is excluded from _risu_source_hash (lorebook-hash.ts),
  // so old + new hashes match for the same source row.
  const indexBySourceHash = new Map<string, number>();
  for (const e of args.newBundle.worldBookEntries) {
    const ext = (e.extensions ?? {}) as Record<string, unknown>;
    const hash = ext['_risu_source_hash'];
    const idx = ext['_risu_array_index'];
    if (typeof hash === 'string' && typeof idx === 'number') {
      indexBySourceHash.set(hash, idx);
    }
  }
  if (indexBySourceHash.size === 0) {
    return { nextEnvelope: args.envelope, notes: ['no source-hashed entries in new bundle'] };
  }

  let worldBookIds: readonly string[];
  try {
    worldBookIds = await deps.getCharacterWorldBookIds(args.characterId, args.userId);
  } catch (err) {
    return {
      nextEnvelope: args.envelope,
      notes: [`getCharacterWorldBookIds failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (worldBookIds.length === 0) {
    return { nextEnvelope: args.envelope, notes: ['character has no world_book_ids'] };
  }

  let liveTotal = 0;
  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  for (const wbId of worldBookIds) {
    let entries: readonly LiveWorldBookEntry[];
    try {
      entries = await deps.listWorldBookEntries(wbId, args.userId);
    } catch (err) {
      deps.log.warn(
        `migrate(${args.characterId}) v6: list wb=${wbId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    liveTotal += entries.length;
    for (const live of entries) {
      const ext = (live.extensions ?? {}) as Record<string, unknown>;
      const hash = ext['_risu_source_hash'];
      if (typeof hash !== 'string') {
        unmatched += 1;
        continue;
      }
      const idx = indexBySourceHash.get(hash);
      if (typeof idx !== 'number') {
        unmatched += 1;
        continue;
      }
      matched += 1;
      const existingIdx = ext['_risu_array_index'];
      if (existingIdx === idx) continue;
      try {
        await deps.updateWorldBookEntryExtensions(
          live.id,
          { ...ext, _risu_array_index: idx },
          args.userId,
        );
        updated += 1;
      } catch (err) {
        deps.log.warn(
          `migrate(${args.characterId}) v6: update entry=${live.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    nextEnvelope: args.envelope,
    notes: [
      `wbs=${worldBookIds.length}`,
      `live=${liveTotal}`,
      `matched=${matched}`,
      `updated=${updated}`,
      `unmatched=${unmatched}`,
    ],
  };
}

async function applyV9StripStylePrefixInPlace(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  // Preserves user disable + edits by patching only replace_string on rules
  // where the transform actually changes the content. Falls back to wholesale
  // reinstall on hosts that don't expose regex_scripts.update.
  if (!deps.applyCharacterRegexReplaceStringTransform) {
    deps.log.warn(
      `migrate(${args.characterId}) v9: regex_scripts.update unavailable, falling back to wholesale reinstall (user disable/edit state will be lost)`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  const result = await deps.applyCharacterRegexReplaceStringTransform(
    args.characterId,
    args.userId,
    unprefixCssInStyleBlocks,
  );
  if (result === null) {
    deps.log.warn(
      `migrate(${args.characterId}) v9: transform dep returned null, falling back to wholesale reinstall`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  return {
    nextEnvelope: args.envelope,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV11FixPhaseMapPlacement(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  // editprocess: drop world_info (Risu chat-history-only scope). edittrans:
  // disable (no Lumi translation pipeline).
  if (!deps.applyCharacterRegexRowPatch) {
    deps.log.warn(
      `migrate(${args.characterId}) v11: regex_scripts row-patch unavailable, falling back to wholesale reinstall (user disable/edit state will be lost)`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  const result = await deps.applyCharacterRegexRowPatch(
    args.characterId,
    args.userId,
    (row) => {
      const meta = row['metadata'] as { _risu?: { phase?: unknown } } | undefined;
      const phase = meta?._risu?.phase;
      if (typeof phase !== 'string') return null;
      if (phase === 'editprocess') {
        const placement = row['placement'];
        if (!Array.isArray(placement)) return null;
        if (!placement.includes('world_info')) return null;
        const next = (placement as string[]).filter((p) => p !== 'world_info');
        return { placement: next };
      }
      if (phase === 'edittrans') {
        const alreadyDisabled = row['disabled'] === true || row['disabled'] === 1;
        const alreadyDisplay = row['target'] === 'display';
        if (alreadyDisabled && alreadyDisplay) return null;
        return {
          disabled: true,
          target: 'display',
          placement: ['ai_output', 'user_input'],
        };
      }
      return null;
    },
  );
  if (result === null) {
    deps.log.warn(
      `migrate(${args.characterId}) v11: row-patch dep returned null, falling back to wholesale reinstall`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  return {
    nextEnvelope: args.envelope,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV10SeedBgHtmlSource(
  args: CharacterMigrationStepArgs,
  _deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  const existing = args.envelope.payload.background_html_source;
  if (typeof existing === "string") {
    return { nextEnvelope: args.envelope, notes: ["already seeded, skipped"] };
  }
  const bg = args.envelope.payload.background_html;
  if (typeof bg !== "string" || bg.length === 0) {
    return { nextEnvelope: args.envelope, notes: ["no background_html to seed from"] };
  }
  return {
    nextEnvelope: {
      ...args.envelope,
      payload: { ...args.envelope.payload, background_html_source: bg },
    },
    notes: [`seeded background_html_source (len=${bg.length}) from background_html`],
  };
}

async function applyV8RetranslateUserBgHtml(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  const raw = args.envelope.payload.background_html_source;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { nextEnvelope: args.envelope, notes: ['no user-edited bg-html, skipped'] };
  }
  const prepared = prepareBackgroundHtmlForRuntime(raw, {
    regexReplaceStrings: args.envelope.regex_scripts.map((r) => r.replace_string ?? ''),
  });
  if (prepared.pendingSvgs.length > 0) {
    deps.dispatchSvgRasterize(args.characterId, args.characterName, prepared.pendingSvgs);
  }
  return {
    nextEnvelope: {
      ...args.envelope,
      payload: {
        ...args.envelope.payload,
        background_html: prepared.translated,
      },
    },
    notes: [
      `re-translated user-edited bg-html (raw_len=${raw.length})`,
      `translated_len=${prepared.translated?.length ?? 0}`,
      `svgs_pending=${prepared.pendingSvgs.length}`,
      `templated_skipped=${prepared.svgTemplatedSkipped}`,
    ],
  };
}

async function applyV12RecoverMissingRegex(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  // Migration's install_regex_scripts is a fire-and-forget send. When it never
  // lands (FE not mounted during a boot/capture mass sweep) the version is
  // still stamped CURRENT, so the card sits with zero Risu rows and is never
  // retried. This step is idempotent: it reinstalls ONLY when the live rowset
  // is empty, so cards that migrated correctly are a pure no-op (no write, no
  // install, user disable/edit state untouched).
  if (!deps.applyCharacterRegexReplaceStringTransform) {
    return applyV7ReinstallRegex(args, deps);
  }
  const probe = await deps.applyCharacterRegexReplaceStringTransform(
    args.characterId,
    args.userId,
    (s) => s,
  );
  if (probe === null) {
    return applyV7ReinstallRegex(args, deps);
  }
  if (probe.scanned === 0) {
    deps.log.warn(
      `migrate(${args.characterId}) v12: 0 Risu regex rows present, reinstalling from translator output`,
    );
    const res = await applyV7ReinstallRegex(args, deps);
    return { nextEnvelope: res.nextEnvelope, notes: ['empty-rowset recovery', ...res.notes] };
  }
  return {
    nextEnvelope: args.envelope,
    notes: [`rows present (scanned=${probe.scanned}), reinstall skipped`],
  };
}

async function applyV13FixEscapedPerMessageGate(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  // Rows the picker previously set to 'escaped' but whose replace_string
  // carries a per-message {{chat_index}} gate render flakily ('escaped'
  // pre-resolves chat-wide). Re-route only those to 'after', in place, so
  // user disable + edits survive.
  if (!deps.applyCharacterRegexRowPatch) {
    deps.log.warn(
      `migrate(${args.characterId}) v13: regex_scripts row-patch unavailable, falling back to wholesale reinstall (user disable/edit state will be lost)`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  const result = await deps.applyCharacterRegexRowPatch(
    args.characterId,
    args.userId,
    (row) => {
      if (row['substitute_macros'] !== 'escaped') return null;
      const rs = row['replace_string'];
      if (typeof rs !== 'string') return null;
      if (!replaceStringHasPerMessageMacro(rs)) return null;
      return { substitute_macros: 'after' };
    },
  );
  if (result === null) {
    deps.log.warn(
      `migrate(${args.characterId}) v13: row-patch dep returned null, falling back to wholesale reinstall`,
    );
    return applyV7ReinstallRegex(args, deps);
  }
  return {
    nextEnvelope: args.envelope,
    notes: [
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `failed=${result.failed}`,
    ],
  };
}

async function applyV14ExcludeGreetingPerEntry(
  args: CharacterMigrationStepArgs,
  deps: MigrationDeps,
): Promise<CharacterMigrationStepResult> {
  const targetBySourceHash = new Map<string, string>();
  for (const entry of args.newBundle.worldBookEntries) {
    const record = entry as unknown as Record<string, unknown>;
    const extensions = entry.extensions as Record<string, unknown>;
    const currentHash = extensions['_risu_source_hash'];
    if (typeof currentHash !== 'string') continue;
    const legacyHash = computeEntrySourceHashWithFields(
      record,
      LEGACY_ENTRY_HASH_FIELDS_V1,
    );
    targetBySourceHash.set(legacyHash, currentHash);
    targetBySourceHash.set(currentHash, currentHash);
  }
  if (targetBySourceHash.size === 0) {
    return {
      nextEnvelope: args.envelope,
      notes: ['no source-hashed entries in new bundle'],
    };
  }

  const worldBookIds = await deps.getCharacterWorldBookIds(
    args.characterId,
    args.userId,
  );
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let failed = 0;
  for (const worldBookId of worldBookIds) {
    const entries = await deps.listWorldBookEntries(worldBookId, args.userId);
    scanned += entries.length;
    for (const entry of entries) {
      const extensions = (entry.extensions ?? {}) as Record<string, unknown>;
      const storedHash = extensions['_risu_source_hash'];
      if (typeof storedHash !== 'string') continue;
      const currentHash = targetBySourceHash.get(storedHash);
      if (!currentHash) continue;
      matched += 1;
      if (entry.exclude_greeting && storedHash === currentHash) continue;
      try {
        await deps.updateWorldBookEntryActivation(
          entry.id,
          {
            exclude_greeting: true,
            extensions: {
              ...extensions,
              _risu_source_hash: currentHash,
            },
          },
          args.userId,
        );
        updated += 1;
      } catch (err) {
        failed += 1;
        deps.log.warn(
          `migrate(${args.characterId}) v14: update entry=${entry.id} failed: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }
  if (failed > 0) {
    throw new Error(`failed to update ${failed}/${matched} matched lorebook entries`);
  }
  return {
    nextEnvelope: args.envelope,
    notes: [
      `wbs=${worldBookIds.length}`,
      `scanned=${scanned}`,
      `matched=${matched}`,
      `updated=${updated}`,
    ],
  };
}

export const CHARACTER_MIGRATIONS: readonly CharacterMigrationStep[] = [
  {
    version: 5,
    description:
      'Rebuild asset_index/emotion_index for new URI handling.',
    touches: [
      'asset_index',
      'emotion_index',
      'payload.additional_assets',
      'payload.emotion_images',
    ],
    apply: applyV5AssetIndexRebuild,
  },
  {
    version: 6,
    description:
      'Backfill extensions._risu_array_index on existing WB entries for the Risu-faithful viewer order.',
    touches: ['world_book_entries'],
    apply: applyV6BackfillArrayIndex,
  },
  {
    version: 7,
    description:
      'Reinstall regex_scripts with new shape (Risu-comment names + dividers as never-match disabled rows).',
    touches: ['regex_scripts'],
    apply: applyV7ReinstallRegex,
  },
  {
    version: 8,
    description:
      'Re-translate user-edited bg-html through the unified prepare pipeline (font hoist + SVG raster). Fixes any user edits saved with the prior lazy pass-through.',
    touches: ['payload.background_html', 'svg_raster'],
    apply: applyV8RetranslateUserBgHtml,
  },
  {
    version: 9,
    description:
      'Strip x-risu- from CSS selectors inside <style> blocks of character regex replace_string content. In-place per row, preserves user disable + edits.',
    touches: ['regex_scripts'],
    apply: applyV9StripStylePrefixInPlace,
  },
  {
    version: 10,
    description:
      "Seed payload.background_html_source from payload.background_html on existing envelopes. The agent's authoring surface is now always present, not lazily created on first edit.",
    touches: ['payload.background_html'],
    apply: applyV10SeedBgHtmlSource,
  },
  {
    version: 11,
    description:
      'Patch placement on Risu editprocess rows to drop world_info (chat-history-only parity); disable Risu edittrans rows (no Lumi translation pipeline).',
    touches: ['regex_scripts'],
    apply: applyV11FixPhaseMapPlacement,
  },
  {
    version: 12,
    description:
      'Idempotent recovery: reinstall regex_scripts only when the live character rowset is empty (fire-and-forget install never landed). No-op when rows already present.',
    touches: ['regex_scripts'],
    apply: applyV12RecoverMissingRegex,
  },
  {
    version: 13,
    description:
      "Re-route 'escaped' regex rows whose replace_string has a per-message {{chat_index}} gate to 'after' (escaped pre-resolves chat-wide so the gate renders flakily). In-place per row, preserves user disable + edits.",
    touches: ['regex_scripts'],
    apply: applyV13FixEscapedPerMessageGate,
  },
  {
    version: 14,
    description:
      'Mark each projected Risu lorebook entry to exclude the character greeting during activation.',
    touches: ['world_book_entries'],
    apply: applyV14ExcludeGreetingPerEntry,
  },
];

export const CURRENT_CHARACTER_SCHEMA_VERSION: number =
  CHARACTER_MIGRATIONS.length > 0
    ? Math.max(...CHARACTER_MIGRATIONS.map((m) => m.version))
    : 1;

export async function migrateCharacterIfNeeded(
  args: MigrationArgs,
  deps: MigrationDeps,
): Promise<MigrationResult> {
  const stored = args.envelope.translator_schema_version ?? 1;
  const target = CURRENT_CHARACTER_SCHEMA_VERSION;
  if (stored >= target) return { kind: 'noop', storedVersion: stored };
  if (!args.envelope.source) {
    return { kind: 'needs_reimport', reason: 'no_source', storedVersion: stored };
  }

  const pending = CHARACTER_MIGRATIONS.filter(
    (m) => m.version > stored && m.version <= target,
  );

  let newBundle: LumiBundle;
  try {
    newBundle = translateFromStoredSource(
      {
        card: args.envelope.source.card,
        module: args.envelope.source.module,
      },
      {
        sourceId: `migrate:${args.characterId}`,
        mode: 'full',
        emitPackScripts: false,
      },
    );
  } catch (err) {
    return {
      kind: 'failed',
      from: stored,
      to: target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!newBundle.risuPayload) {
    return {
      kind: 'failed',
      from: stored,
      to: target,
      error: 'translator returned no risuPayload',
    };
  }

  let current = args.envelope;
  const stepsApplied: { version: number; notes: readonly string[] }[] = [];
  const t0 = Date.now();

  for (const step of pending) {
    try {
      const result = await step.apply(
        {
          envelope: current,
          characterId: args.characterId,
          characterName: args.characterName,
          userId: args.userId,
          newBundle,
        },
        deps,
      );
      const stamped = stampEnvelope(
        result.nextEnvelope,
        deps.extensionVersion,
        step.version,
      );
      await deps.writeEnvelope(args.characterId, stamped, args.userId);
      current = stamped;
      stepsApplied.push({ version: step.version, notes: result.notes });
      deps.log.info(
        `migrate(${args.characterId}): step v${step.version} done , ${result.notes.join(', ')}`,
      );
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      deps.log.error(
        `migrate(${args.characterId}): step v${step.version} FAILED: ${errStr}`,
      );
      return {
        kind: 'failed',
        from: stored,
        to: target,
        error: errStr,
        partialAt: stepsApplied.length > 0
          ? stepsApplied[stepsApplied.length - 1]!.version
          : stored,
      };
    }
  }

  if (stepsApplied.length === 0 && stored < target) {
    // CURRENT bumped without writing a step. Just stamp version forward.
    const stamped = stampEnvelope(current, deps.extensionVersion, target);
    await deps.writeEnvelope(args.characterId, stamped, args.userId);
  }

  deps.log.info(
    `migrate(${args.characterId}): v${stored}->v${target} done ` +
      `steps=[${stepsApplied.map((s) => `v${s.version}`).join(',')}] ` +
      `elapsed=${Date.now() - t0}ms`,
  );
  return { kind: 'migrated', from: stored, to: target, stepsApplied };
}

function stampEnvelope(
  envelope: LumirealmCharacterData,
  extensionVersion: string,
  version: number,
): LumirealmCharacterData {
  return {
    ...envelope,
    extension_version: extensionVersion,
    translator_schema_version: version,
  };
}
