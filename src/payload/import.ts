import { translateFromCharxBundle } from '../core/pipeline/index.js';
import { readCharx } from '../core/charx/reader.js';
import type { LumiBundle } from '../core/pipeline/index.js';
import { CURRENT_CHARACTER_SCHEMA_VERSION } from '../state/translator-migrations.js';
import type { LumirealmStoredSource } from './types.js';
import { CatalogIndex, parseCatalog } from '../core/cbs/index.js';
import {
  buildLumirealmData,
  preValidateRequires,
  RisuCompatVersionError,
  RisuConsentDeclinedError,
} from './codec.js';
import { type UserStorageLike } from './installer.js';
import type {
  LumirealmCharacterData,
  LumirealmUserOverrides,
  RisuPayload,
} from './types.js';
import { LUMIREALM_EXT_KEY } from './types.js';
import { appendImageIdsToJournal } from '../state/image-journal.js';
import { makeSafeLogger } from '../util/safe-log.js';

const logger = makeSafeLogger('import');
const logInfo = (msg: string): void => logger.info(msg);
const logWarn = (msg: string): void => logger.warn(msg);
const logError = (msg: string): void => logger.error(msg);

import catalogJson from '../core/cbs/catalog/risu-macros.json';
let cachedCatalog: CatalogIndex | null = null;
export function loadCatalog(): CatalogIndex {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = new CatalogIndex(parseCatalog(catalogJson as unknown));
  return cachedCatalog;
}

export interface ImportResult {
  readonly characterId: string;
  readonly characterName: string;
  readonly lumirealm: LumirealmCharacterData;
  readonly imageIds: readonly string[];
  readonly pendingRegexScripts: readonly PendingRegexScript[];
  readonly warnings: readonly string[];
  readonly createdWorldBookIds: readonly string[];
  readonly pendingSvgRasters: readonly import('../core/svg-rasterize.js').SvgRasterTask[];
}

export interface PendingRegexScript {
  readonly name: string;
  readonly script_id: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly placement: readonly string[];
  readonly scope: 'global' | 'character' | 'chat';
  readonly scope_id: string | null;
  readonly target: 'prompt' | 'response' | 'display';
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly trim_strings: readonly string[];
  readonly run_on_edit: boolean;
  readonly substitute_macros: 'none' | 'raw' | 'escaped' | 'after';
  readonly disabled: boolean;
  readonly sort_order: number;
  readonly description: string;
  readonly folder: string;
  readonly metadata: Record<string, unknown>;
}

function makeLowLevelAccessConsentMessage(characterName: string): string {
  return (
    `"${characterName}" requests low-level access. With this granted the card may:\n\n` +
    `  • Make additional LLM API calls (uses your tokens / billing)\n` +
    `  • Run helper / classifier prompts in the background\n` +
    `  • Trigger image generation (if your provider supports it)\n` +
    `  • Inspect message similarity / embeddings\n\n` +
    `Only grant access for cards from sources you trust. ` +
    `Decline to import the card without low-level features (some panels / ` +
    `auto-updates may not work).`
  );
}

export function guessMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

// Risu module asset names lack extensions, so Lumi stores files as `<uuid>.bin`
// and serves Content-Type: octet-stream + nosniff, blocking <img> render.
export function sniffImageMime(bytes: Uint8Array): { ext: string; mime: string } | null {
  if (bytes.byteLength < 12) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return { ext: 'wav', mime: 'audio/wav' };
  }
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (b[0] === 0xff && (b[1] === 0xfb || b[1] === 0xf3 || b[1] === 0xf2)) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
    return { ext: 'ogg', mime: 'audio/ogg' };
  }
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return { ext: 'mp4', mime: 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { ext: 'webm', mime: 'video/webm' };
  }
  return null;
}

function pickAvatar(
  assets: ReadonlyMap<string, Uint8Array>,
): { path: string; data: Uint8Array } | null {
  const isImage = (p: string) => /\.(png|jpe?g|webp|gif)$/i.test(p);
  // Canonical first.
  for (const [path, data] of assets) {
    if (/^assets\/icon\/main\.(png|jpe?g|webp|gif)$/i.test(path)) return { path, data };
  }
  // Any file inside an icon/ dir.
  for (const [path, data] of assets) {
    if (/\/icon\//i.test(path) && isImage(path)) return { path, data };
  }
  // First image asset.
  for (const [path, data] of assets) {
    if (isImage(path)) return { path, data };
  }
  return null;
}

// Declared here so tests can inject a mock without importing the full SpindleAPI type.
export interface SpindleImportApi {
  characters: {
    create(input: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
    setAvatar?(
      characterId: string,
      avatar: { data: Uint8Array; filename?: string; mime_type?: string },
      userId?: string,
    ): Promise<{ id: string; image_id: string | null }>;
    get(characterId: string, userId?: string): Promise<unknown>;
    update(characterId: string, input: Record<string, unknown>, userId?: string): Promise<unknown>;
    list(options?: { limit?: number; offset?: number; userId?: string }): Promise<{ data: readonly unknown[]; total: number }>;
  };
  world_books: {
    create(input: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
    update(worldBookId: string, input: Record<string, unknown>, userId?: string): Promise<unknown>;
    entries: {
      create(worldBookId: string, input: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
    };
  } | undefined;
  requestConsent?(opts: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }): Promise<{ confirmed: boolean }>;
  images: {
    upload(
      input: {
        data: Uint8Array;
        mime_type?: string;
        filename?: string;
        owner_character_id?: string;
        owner_chat_id?: string;
      },
      userId?: string,
    ): Promise<{ id: string }>;
    uploadMany?(
      items: ReadonlyArray<{
        data: Uint8Array;
        mime_type?: string;
        filename?: string;
        owner_character_id?: string;
        owner_chat_id?: string;
      }>,
      options?: { userId?: string; concurrency?: number },
    ): Promise<Array<{ id?: string; error?: string }>>;
  };
}

export interface ImportCardArgs {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly sourceId?: string;
  readonly extensionVersion: string;
  readonly userId: string | undefined;
  readonly spindle: SpindleImportApi;
  readonly userStorage: UserStorageLike;
  readonly onProgress?: (phase: string, message: string, fraction: number | null) => void;
}

export async function importCard(args: ImportCardArgs): Promise<ImportResult> {
  const progress = args.onProgress ?? (() => {});
  const tImport = Date.now();
  logInfo(`start file=${args.fileName} bytes=${args.bytes.byteLength} userId=${args.userId ?? '<none>'}`);

  progress('decoding', `Decoding ${args.fileName}…`, 0.05);
  const bytes = args.bytes;

  progress('translating', 'Translating Risu card…', 0.15);
  const tTranslate = Date.now();
  const catalog = loadCatalog();
  logInfo(`(2) translate: starting translateCharx bytes=${bytes.byteLength}`);
  const charxBundle = readCharx(bytes);
  const bundle: LumiBundle = translateFromCharxBundle(charxBundle, {
    sourceId: args.sourceId ?? `file:${args.fileName}`,
    mode: 'full',
    catalog,
    // emitPackScripts triggers fengari/json.lua disk reads; those paths
    // are absent in dist/backend.js, so disable pack-script generation.
    emitPackScripts: false,
  });
  logInfo(
    `(2) translate: done in ${Date.now() - tTranslate}ms — char="${bundle.character.name}" ` +
      `lore=${bundle.worldBookEntries.length} regex=${bundle.regexScripts.length} ` +
      `assets=${bundle.assets.size} payload.triggers=${bundle.risuPayload?.triggers.length ?? 0} ` +
      `payload.lua=${bundle.risuPayload?.lua_scripts.length ?? 0}`,
  );
  // Deliberate diagnostic: emitted only when at least one lorebook entry
  // carried a `@@`-decorator block. Tells us at a glance whether decorator
  // mapping fired + how many were Tier 1 (mapped) vs Tier 2/3 (stashed for
  // a future runtime intercept) vs dropped (Risu would have suspended).
  // See src/core/mappers/lorebook-decorators.ts.
  if (bundle.decoratorStats.decorators_seen > 0) {
    logInfo(
      `(2.1) lorebook decorators: ` +
        `entries_with_decorators=${bundle.decoratorStats.entries_with_decorators}/${bundle.worldBookEntries.length} ` +
        `seen=${bundle.decoratorStats.decorators_seen} ` +
        `mapped=${bundle.decoratorStats.mapped} ` +
        `stashed=${bundle.decoratorStats.stashed} ` +
        `dropped=${bundle.decoratorStats.dropped}`,
    );
  }
  // Log translator issues loudly; silent degradation (e.g. dropped rpack modules) is hard to trace otherwise.
  const issues = bundle.manifest.issues;
  if (issues.length > 0) {
    logWarn(`(2) translate produced ${issues.length} issue(s):`);
    for (const iss of issues) {
      logWarn(`    - ${iss.path}: ${iss.message}`);
    }
  }
  if (!bundle.risuPayload) {
    logError(`translator produced no risuPayload`);
    throw new Error('risu-compat: translator produced no risuPayload');
  }

  progress('translating', 'Validating compatibility…', 0.22);
  logInfo(`(3) preValidate requires=${JSON.stringify(bundle.risuPayload.requires)}`);
  const check = preValidateRequires(bundle.risuPayload.requires);
  const warnings: string[] = [];
  if (!check.ok) {
    logError(`(3) requires missing=[${check.missing.join(', ')}] — throwing RisuCompatVersionError`);
    throw new RisuCompatVersionError(check.missing, args.extensionVersion);
  }
  if (check.degraded.length > 0) {
    logWarn(`(3) degraded=[${check.degraded.join(', ')}]`);
    warnings.push(
      `Card uses degraded features: ${check.degraded.join(', ')}.`,
    );
  }

  const svgTemplatedStripped = bundle.manifest.untranslated.svg_templated_stripped ?? 0;
  const svgDangerousStripped = bundle.manifest.untranslated.svg_dangerous_stripped ?? 0;
  if (svgTemplatedStripped > 0) {
    logWarn(`(3) svg_templated_stripped=${svgTemplatedStripped}`);
    warnings.push(
      `${svgTemplatedStripped} dynamic SVG icon(s) on this card use template captures or macros and won't render — ` +
        `the rest were rasterized to PNG. Visual gap on these icons only.`,
    );
  }
  if (svgDangerousStripped > 0) {
    logWarn(`(3) svg_dangerous_stripped=${svgDangerousStripped}`);
    warnings.push(
      `${svgDangerousStripped} SVG(s) with external references or scripts were skipped for safety.`,
    );
  }

  // Risu parity: characterCards.ts alertConfirm gate for lowLevelAccess.
  // Grant recorded on user_overrides.low_level_access_granted.
  const userOverrides: {
    -readonly [K in keyof LumirealmUserOverrides]: LumirealmUserOverrides[K];
  } = {};
  if (bundle.risuPayload.requires.lowLevelAccess === true) {
    logInfo(`(3.5) requires.lowLevelAccess=true — prompting user consent`);
    const consentMessage = makeLowLevelAccessConsentMessage(bundle.character.name);
    let confirmed = false;
    if (args.spindle.requestConsent) {
      try {
        const res = await args.spindle.requestConsent({
          title: `Risu card "${bundle.character.name}" requests low-level access`,
          message: consentMessage,
          confirmLabel: 'Grant access',
          cancelLabel: 'Decline',
        });
        confirmed = !!res?.confirmed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`(3.5) consent prompt threw: ${msg}`);
        confirmed = false;
      }
    } else {
      logWarn(`(3.5) requestConsent callback missing — refusing low-level access`);
      confirmed = false;
    }
    if (!confirmed) {
      logInfo(`(3.5) consent declined for "${bundle.character.name}" — aborting import`);
      progress('error', `Import cancelled: low-level access declined`, null);
      throw new RisuConsentDeclinedError(bundle.character.name);
    }
    userOverrides.low_level_access_granted = true;
    userOverrides.consent_acknowledged_at = Date.now();
    logInfo(`(3.5) consent granted; flag set on user_overrides`);
  }

  // Create world book before character so CHARACTER_CREATED already carries the lore attachment.
  // metadata.source='character' + source_character_id matches Lumi's native
  // CharX importer (services/world-books.service.ts:1254-1262) so the
  // "From character" badge shows up in WorldBookPanel.tsx:618.
  // source_character_id is patched in post-character-create (we don't have
  // the id yet at this point).
  let worldBookId: string | null = null;
  if (bundle.worldBookEntries.length > 0 && args.spindle.world_books) {
    progress('creating_character', `Creating world book with ${bundle.worldBookEntries.length} entries…`, 0.3);
    const tBook = Date.now();
    try {
      const wbName = bundle.worldBook?.name ?? `${bundle.character.name} — lore`;
      logInfo(`(4a) create world_book name="${wbName}" for ${bundle.worldBookEntries.length} entries`);
      const book = await args.spindle.world_books.create(
        {
          name: wbName,
          metadata: {
            source: 'character',
            // source_character_id is set in (4c) once the character row exists.
            auto_managed_by_character: true,
          },
        },
        args.userId,
      );
      worldBookId = book.id;
      logInfo(`(4a) world_book created id=${worldBookId} in ${Date.now() - tBook}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`(4a) world_book create failed: ${msg}`);
      warnings.push(`Failed to create world book: ${msg}. Lorebook entries skipped.`);
    }
  } else {
    logInfo(`(4a) world_books: ${bundle.worldBookEntries.length === 0 ? 'no entries' : 'spindle.world_books unavailable'}`);
  }

  progress('creating_character', `Creating character "${bundle.character.name}"…`, 0.4);
  const tChar = Date.now();
  const characterInput: Record<string, unknown> = {
    name: bundle.character.name,
    description: bundle.character.description,
    personality: bundle.character.personality,
    scenario: bundle.character.scenario,
    first_mes: bundle.character.first_mes,
    mes_example: bundle.character.mes_example,
    creator: bundle.character.creator,
    creator_notes: bundle.character.creator_notes,
    system_prompt: bundle.character.system_prompt,
    post_history_instructions: bundle.character.post_history_instructions,
    tags: [...bundle.character.tags],
    alternate_greetings: [...bundle.character.alternate_greetings],
  };
  if (worldBookId) characterInput.world_book_ids = [worldBookId];
  logInfo(`(4b) spindle.characters.create name="${bundle.character.name}" tags=${bundle.character.tags.length} alts=${bundle.character.alternate_greetings.length} worldBookId=${worldBookId ?? '<none>'}`);
  const created = await args.spindle.characters.create(characterInput, args.userId);
  const characterId = created.id;
  logInfo(`(4b) spindle.characters.create -> id=${characterId} in ${Date.now() - tChar}ms`);

  // Patch world_book metadata with source_character_id now that the character
  // row exists. Required for the "From character" badge to render.
  if (worldBookId && args.spindle.world_books) {
    try {
      await args.spindle.world_books.update(
        worldBookId,
        {
          metadata: {
            source: 'character',
            source_character_id: characterId,
            auto_managed_by_character: true,
          },
        },
        args.userId,
      );
      logInfo(`(4c) world_book metadata patched with source_character_id=${characterId}`);
    } catch (err) {
      logWarn(`(4c) world_book metadata patch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let avatarImageId: string | null = null;
  if (args.spindle.characters.setAvatar) {
    // Prefer the format-canonical avatar (JPEG preview from .charx polyglot;
    // PNG card body) over scanning the asset map. Fall back to the asset scan
    // for pure-ZIP charx without a preferred avatar.
    const preferred = bundle.preferredAvatar;
    const avatar = preferred
      ? { path: preferred.filename, data: preferred.data, filename: preferred.filename, mime: preferred.mime }
      : (() => {
          const picked = pickAvatar(bundle.assets);
          return picked
            ? { path: picked.path, data: picked.data, filename: picked.path.split('/').pop() ?? 'avatar.png', mime: guessMimeType(picked.path) }
            : null;
        })();
    if (avatar) {
      const tAvatar = Date.now();
      try {
        logInfo(`(5a) setAvatar source=${preferred ? 'preferred' : 'asset-scan'} path=${avatar.path} bytes=${avatar.data.byteLength} mime=${avatar.mime}`);
        const avatarResult = await args.spindle.characters.setAvatar(
          characterId,
          {
            data: avatar.data,
            filename: avatar.filename,
            mime_type: avatar.mime,
          },
          args.userId,
        );
        if (typeof avatarResult.image_id === 'string' && avatarResult.image_id.length > 0) {
          avatarImageId = avatarResult.image_id;
        }
        logInfo(`(5a) setAvatar done in ${Date.now() - tAvatar}ms image_id=${avatarImageId ?? '<none>'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`(5a) setAvatar failed: ${msg}`);
        warnings.push(`Failed to set character avatar: ${msg}`);
      }
    } else {
      logInfo(`(5a) setAvatar: no avatar candidate (no preferred avatar, no image in assets)`);
    }
  } else {
    logInfo(`(5a) setAvatar: API unavailable (spindle-types < 0.4.31) — skipping`);
  }

  progress('uploading_assets', 'Uploading assets…', 0.55);
  const tAssets = Date.now();
  const uploadConcurrency = 12;
  const pathToImageId: Record<string, string> = {};
  const imageIds: string[] = [];
  const journalBuffer: string[] = [];
  let journalChain: Promise<void> = Promise.resolve();
  const flushJournal = (): void => {
    if (journalBuffer.length === 0) return;
    const ids = journalBuffer.splice(0);
    journalChain = journalChain.then(async () => {
      try {
        await appendImageIdsToJournal(args.userStorage, args.userId, characterId, ids);
      } catch (err) {
        journalBuffer.unshift(...ids);
        logWarn(`image-journal flush failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };
  if (avatarImageId) {
    imageIds.push(avatarImageId);
    journalBuffer.push(avatarImageId);
    flushJournal();
  }
  const assetEntries = [...bundle.assets];
  const totalAssetCount = assetEntries.length;
  let totalAssetBytes = 0;
  for (const [, data] of assetEntries) totalAssetBytes += data.byteLength;

  const PROGRESS_BASE = 0.55;
  const PROGRESS_END = 0.9;
  let processed = 0;
  let assetUploadFailures = 0;

  const uploadMany = args.spindle.images.uploadMany?.bind(args.spindle.images);

  if (typeof uploadMany === 'function' && totalAssetCount > 0) {
    logInfo(
      `(5b) uploading ${totalAssetCount} assets totalBytes=${totalAssetBytes} ` +
        `via spindle.images.uploadMany (batched)`,
    );
    const BATCH_MAX_ITEMS = 64;
    const BATCH_MAX_BYTES = 16 * 1024 * 1024;
    let i = 0;
    while (i < totalAssetCount) {
      const batchItems: Array<{
        data: Uint8Array;
        mime_type: string;
        filename: string;
        owner_character_id: string;
      }> = [];
      const batchPaths: string[] = [];
      let batchBytes = 0;
      while (i < totalAssetCount && batchItems.length < BATCH_MAX_ITEMS) {
        const entry = assetEntries[i];
        if (!entry) { i += 1; continue; }
        const [path, data] = entry;
        if (batchItems.length > 0 && batchBytes + data.byteLength > BATCH_MAX_BYTES) break;
        batchItems.push({
          data,
          mime_type: guessMimeType(path),
          filename: path.split('/').pop() ?? 'asset.bin',
          owner_character_id: characterId,
        });
        batchPaths.push(path);
        batchBytes += data.byteLength;
        i += 1;
      }
      let results: Array<{ id?: string; error?: string }> = [];
      try {
        results = await uploadMany(
          batchItems,
          args.userId !== undefined ? { userId: args.userId } : {},
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`(5b) uploadMany batch failed (${batchItems.length} items): ${msg}`);
        results = batchItems.map(() => ({ error: msg }));
      }
      for (let k = 0; k < results.length; k++) {
        const r = results[k]!;
        const path = batchPaths[k]!;
        if (typeof r.id === 'string' && r.id.length > 0) {
          pathToImageId[path] = r.id;
          imageIds.push(r.id);
          journalBuffer.push(r.id);
        } else {
          assetUploadFailures += 1;
          logWarn(`(5b) upload failed path=${path}: ${r.error ?? 'unknown error'}`);
        }
      }
      processed += batchItems.length;
      flushJournal();
      const frac = PROGRESS_BASE + (PROGRESS_END - PROGRESS_BASE) * (processed / totalAssetCount);
      progress('uploading_assets', `Uploading assets (${processed}/${totalAssetCount})…`, frac);
    }
  } else if (totalAssetCount > 0) {
    logInfo(
      `(5b) uploading ${totalAssetCount} assets totalBytes=${totalAssetBytes} ` +
        `concurrency=${uploadConcurrency} via spindle.images.upload (single, fallback)`,
    );
    const progressEvery = Math.max(1, Math.min(25, Math.floor(totalAssetCount / 20) || 1));
    let nextIndex = 0;
    const uploadWorker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= totalAssetCount) break;
        const entry = assetEntries[i];
        if (!entry) break;
        const [path, data] = entry;
        const filename = path.split('/').pop() ?? 'asset.bin';
        try {
          const result = await args.spindle.images.upload(
            { data, mime_type: guessMimeType(path), filename, owner_character_id: characterId },
            args.userId,
          );
          if (typeof result?.id !== 'string' || result.id.length === 0) {
            throw new Error('upload returned without an image id');
          }
          pathToImageId[path] = result.id;
          imageIds.push(result.id);
          journalBuffer.push(result.id);
        } catch (err) {
          assetUploadFailures += 1;
          const msg = err instanceof Error ? err.message : String(err);
          logWarn(`(5b) upload failed path=${path}: ${msg}`);
        }
        processed += 1;
        if (processed % progressEvery === 0 || processed === totalAssetCount) {
          flushJournal();
          const frac = PROGRESS_BASE + (PROGRESS_END - PROGRESS_BASE) * (processed / totalAssetCount);
          progress('uploading_assets', `Uploading assets (${processed}/${totalAssetCount})…`, frac);
        }
      }
    };
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(uploadConcurrency, totalAssetCount); w++) {
      workers.push(uploadWorker());
    }
    await Promise.all(workers);
  }
  flushJournal();
  await journalChain;

  if (assetUploadFailures > 0) {
    warnings.push(
      `${assetUploadFailures} of ${totalAssetCount} asset upload(s) failed; ` +
        `the card will work but may render fallback art.`,
    );
  }
  logInfo(
    `(5b) uploaded ${totalAssetCount - assetUploadFailures}/${totalAssetCount} assets ` +
      `failed=${assetUploadFailures} elapsed=${Date.now() - tAssets}ms`,
  );

  const builtIndexes = buildAssetIndexes(
    {
      additional_assets: bundle.risuPayload.additional_assets,
      emotion_images: bundle.risuPayload.emotion_images,
    },
    pathToImageId,
    avatarImageId,
  );
  const assetIndex = builtIndexes.assetIndex;
  const emotionIndex = builtIndexes.emotionIndex;

  if (worldBookId && args.spindle.world_books) {
    progress('uploading_assets', `Uploading ${bundle.worldBookEntries.length} world-info entries…`, 0.6);
    const tEntries = Date.now();
    const entries = bundle.worldBookEntries;
    let failed = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      try {
        // Forward the full shape; omitting fields like constant/disabled caused silent
        // prompt-assembly failures (alwaysActive entries never injected).
        const entryInput: Record<string, unknown> = {
          key: entry.key,
          keysecondary: entry.keysecondary,
          content: entry.content,
          comment: entry.comment,
          position: entry.position,
          depth: entry.depth,
          order_value: entry.order_value,
          selective: entry.selective,
          constant: entry.constant,
          disabled: entry.disabled,
          group_name: entry.group_name,
          group_override: entry.group_override,
          group_weight: entry.group_weight,
          probability: entry.probability,
          case_sensitive: entry.case_sensitive,
          match_whole_words: entry.match_whole_words,
          use_regex: entry.use_regex,
          prevent_recursion: entry.prevent_recursion,
          exclude_recursion: entry.exclude_recursion,
          delay_until_recursion: entry.delay_until_recursion,
          priority: entry.priority,
          sticky: entry.sticky,
          cooldown: entry.cooldown,
          delay: entry.delay,
          selective_logic: entry.selective_logic,
          use_probability: entry.use_probability,
          vectorized: entry.vectorized,
          ...(entry.role !== null ? { role: entry.role } : {}),
          ...(entry.scan_depth !== null ? { scan_depth: entry.scan_depth } : {}),
          ...(entry.automation_id !== null ? { automation_id: entry.automation_id } : {}),
          ...(entry.extensions ? { extensions: entry.extensions } : {}),
        };
        await args.spindle.world_books.entries.create(worldBookId, entryInput, args.userId);
      } catch (err) {
        failed += 1;
        const emsg = err instanceof Error ? err.message : String(err);
        logWarn(`(6) entry "${entry.comment}" failed: ${emsg}`);
        warnings.push(`Failed to create world info entry "${entry.comment}": ${emsg}`);
      }
      if (i % 10 === 0 || i === entries.length - 1) {
        progress(
          'uploading_assets',
          `Uploading world-info entries (${i + 1}/${entries.length})…`,
          0.55 + 0.35 * ((i + 1) / entries.length),
        );
      }
    }
    logInfo(`(6) entries done ok=${entries.length - failed} failed=${failed} elapsed=${Date.now() - tEntries}ms`);
  }

  // Rewrite scope_id from translator's internal id to the real Lumiverse character id.
  const folderLabel = `Risu — ${bundle.character.name}`.slice(0, 80);

  const allRows: PendingRegexScript[] = bundle.regexScripts.map((r) => ({
    name: r.name,
    script_id: r.script_id,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: [...r.placement],
    scope: r.scope,
    scope_id: r.scope === 'character' ? characterId : r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: [...r.trim_strings],
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder || folderLabel,
    metadata: { ...r.metadata },
  }));

  // Runtime DOM lifter handles fixed-position content post-render. No
  // translate-time portal partition, all rules go to Lumi's regex_scripts.
  const pendingRegexScripts: PendingRegexScript[] = allRows.map((r) => ({
    name: r.name,
    script_id: r.script_id,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: r.placement,
    scope: r.scope,
    scope_id: r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: r.trim_strings,
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    metadata: { ...(r.metadata ?? {}) },
  }));
  const partitionedOut = allRows.length - pendingRegexScripts.length;
  logInfo(
    `(8) pendingRegexScripts: total=${allRows.length} pushedToLumi=${pendingRegexScripts.length} ` +
      `extensionManaged=${partitionedOut} folder="${folderLabel}"`,
  );

  // Lumi shallow-merges extensions (worker-host.ts); only the lumirealm key is overwritten.
  progress('saving_payload', 'Saving lumirealm payload…', 0.92);
  const tSave = Date.now();
  // Store ALL rules (managed + plain + stubs) so the backend portal resolver
  // has full context. Partition governs who executes each rule, not what is stored.
  const storedRegexScripts = allRows.map((r) => ({
    name: r.name,
    script_id: r.script_id,
    find_regex: r.find_regex,
    replace_string: r.replace_string,
    flags: r.flags,
    placement: r.placement,
    scope: r.scope,
    scope_id: r.scope_id,
    target: r.target,
    min_depth: r.min_depth,
    max_depth: r.max_depth,
    trim_strings: r.trim_strings,
    run_on_edit: r.run_on_edit,
    substitute_macros: r.substitute_macros,
    disabled: r.disabled,
    sort_order: r.sort_order,
    description: r.description,
    folder: r.folder,
    metadata: r.metadata,
  }));
  const storedSource: LumirealmStoredSource = {
    schema_version: 1,
    captured_at: Date.now(),
    card: charxBundle.card,
    module: charxBundle.moduleEnvelope?.module ?? null,
    path_to_image_id: { ...pathToImageId },
  };
  const lumirealmData = buildLumirealmData(
    bundle.risuPayload,
    args.extensionVersion,
    storedRegexScripts,
    assetIndex,    // populated above via spindle.images.upload
    emotionIndex,  // populated alongside (last-wins per emotion name)
    Date.now(),
    userOverrides,
    storedSource,
    CURRENT_CHARACTER_SCHEMA_VERSION,
  );
  try {
    // display_owner: true MUST match writeLumirealm. The host gates FE-owned display on
    // character.extensions.lumirealm.display_owner, so omitting it imports an unowned
    // character that silently dead-zones (quirks §1.44).
    await args.spindle.characters.update(
      characterId,
      { extensions: { [LUMIREALM_EXT_KEY]: { ...lumirealmData, display_owner: true } } },
      args.userId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`(9) characters.update extensions write failed: ${msg}`);
    throw err;
  }
  logInfo(`(9) writeLumirealm done in ${Date.now() - tSave}ms regex_scripts=${storedRegexScripts.length}`);

  // Caller (backend.ts importCardFromBytes) emits phase=done after asset upload completes.
  progress('saving_payload', `Saved ${bundle.character.name}`, 1);
  logInfo(`done file=${args.fileName} characterId=${characterId} total=${Date.now() - tImport}ms warnings=${warnings.length}`);

  return {
    characterId,
    characterName: bundle.character.name,
    lumirealm: lumirealmData,
    imageIds,
    pendingRegexScripts,
    warnings,
    createdWorldBookIds: worldBookId ? [worldBookId] : [],
    pendingSvgRasters: bundle.pendingSvgRasters,
  };
}

export const CCDEFAULT_PATH_MARKER = "ccdefault:" as const;

export function buildAssetIndexes(
  payload: Pick<RisuPayload, "additional_assets" | "emotion_images">,
  uploads: Readonly<Record<string, string>>,
  ccdefaultImageId?: string | null,
): {
  assetIndex: Record<string, { imageIds: string[]; ext?: string }>;
  emotionIndex: Record<string, { imageIds: string[]; ext?: string }>;
  mappedCount: number;
} {
  const assetIndex: Record<string, { imageIds: string[]; ext?: string }> = {};
  const emotionIndex: Record<string, { imageIds: string[]; ext?: string }> = {};
  let mappedCount = 0;
  // ccdefault: is Risu's "use the icon image as this asset" alias.
  const resolveImageId = (path: string): string | undefined =>
    path === CCDEFAULT_PATH_MARKER ? (ccdefaultImageId ?? undefined) : uploads[path];
  for (const a of payload.additional_assets ?? []) {
    const imageId = resolveImageId(a.path);
    if (!imageId) continue;
    const key = a.name;
    let bucket = assetIndex[key];
    if (!bucket) {
      bucket = a.ext ? { imageIds: [], ext: a.ext } : { imageIds: [] };
      assetIndex[key] = bucket;
    }
    // Risu ext-binding: first-seen ext is sticky; mismatched ext is silently dropped.
    if (bucket.ext === a.ext) {
      bucket.imageIds.push(imageId);
      mappedCount++;
    }
  }
  for (const a of payload.emotion_images ?? []) {
    const imageId = resolveImageId(a.path);
    if (!imageId) continue;
    const key = a.name;
    // Risu's getEmoSrc always overwrites; last-wins.
    emotionIndex[key] = a.ext ? { imageIds: [imageId], ext: a.ext } : { imageIds: [imageId] };
    mappedCount++;
  }
  return { assetIndex, emotionIndex, mappedCount };
}
