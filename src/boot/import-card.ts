declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { BackendToFrontend, CardSummary } from '../types/messages.js';
import type { PendingImportCompletion } from '../handlers/import.js';
import type { UserStorageLike } from '../payload/installer.js';
import { importCard, type SpindleImportApi } from '../payload/import.js';
import { RisuConsentDeclinedError } from '../payload/codec.js';
import { ensureRegexOwnership } from '../state/regex-ownership.js';

export interface ImportCardOrchestratorDeps {
  readonly extensionVersion: string;
  readonly userStorage: () => UserStorageLike;
  readonly requestConsent: (
    opts: { title: string; message: string; confirmLabel: string; cancelLabel: string },
    userId: string,
  ) => Promise<{ confirmed: boolean }>;
  readonly worldBookIdsByCharacter: Map<string, readonly string[]>;
  readonly pendingImportCompletions: Map<string, PendingImportCompletion>;
  readonly enterAssetUpload: () => void;
  readonly exitAssetUpload: () => void;
  readonly nudgeGc: (reason: string) => void;
  readonly refreshRisuAssetMap: (characterId: string, userId: string) => Promise<void>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly listCards: (userId: string | undefined) => Promise<readonly CardSummary[]>;
  readonly pushCards: (cards: readonly CardSummary[], userId: string | undefined) => void;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void; readonly error: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface ImportCardOrchestrator {
  readonly importCardFromBytes: (
    bytes: Uint8Array,
    fileName: string,
    userId: string,
  ) => Promise<void>;
}

export function createImportCardOrchestrator(deps: ImportCardOrchestratorDeps): ImportCardOrchestrator {
  const {
    extensionVersion,
    userStorage,
    requestConsent,
    worldBookIdsByCharacter,
    pendingImportCompletions,
    enterAssetUpload,
    exitAssetUpload,
    nudgeGc,
    refreshRisuAssetMap,
    send,
    listCards,
    pushCards,
    toastFor,
    log,
    errMsg,
  } = deps;

  async function importCardFromBytes(
    bytes: Uint8Array,
    fileName: string,
    userId: string,
  ): Promise<void> {
    const tStart = Date.now();
    log.info(`importCardFromBytes: start file=${fileName} bytes=${bytes.byteLength} userId=${userId}`);

    const hasSetAvatar = typeof (spindle.characters as { setAvatar?: unknown }).setAvatar === 'function';
    if (!spindle.images?.upload) {
      throw new Error(
        'spindle.images.upload is unavailable,Lumi 0.9.6+ required.',
      );
    }
    const spindleImagesApi = spindle.images;
    const spindleImportApi: SpindleImportApi = {
      characters: {
        create: (input, uid) => {
          log.info(`spindle.characters.create name=${(input as { name?: string }).name ?? '?'}`);
          return spindle.characters.create(input as never, uid).then((c) => {
            log.info(`spindle.characters.create -> id=${c.id}`);
            return { id: c.id };
          });
        },
        get: (characterId, uid) => spindle.characters.get(characterId, uid),
        update: (characterId, input, uid) =>
          spindle.characters.update(characterId, input as never, uid),
        // characters.list is options-bag for userId, not positional. The importer doesn't actually call list, this stub is kept to satisfy the SpindleImportApi shape.
        list: (options) =>
          spindle.characters.list(options) as unknown as Promise<{
            data: readonly unknown[];
            total: number;
          }>,
        ...(hasSetAvatar
          ? {
              setAvatar: (characterId, avatar, uid) => {
                log.info(`spindle.characters.setAvatar characterId=${characterId} filename=${avatar.filename ?? '?'} bytes=${avatar.data.byteLength}`);
                return (spindle.characters as unknown as {
                  setAvatar(
                    id: string,
                    avatar: { data: Uint8Array; filename?: string; mime_type?: string },
                    userId?: string,
                  ): Promise<{ id: string; image_id?: string | null }>;
                }).setAvatar(characterId, avatar, uid).then((c) => ({
                  id: c.id,
                  image_id: typeof c.image_id === 'string' ? c.image_id : null,
                }));
              },
            }
          : {}),
      },
      world_books: spindle.world_books
        ? {
            create: (input, uid) => {
              log.info(`spindle.world_books.create name=${(input as { name?: string }).name ?? '?'}`);
              return spindle.world_books.create(input as never, uid).then((w) => {
                log.info(`spindle.world_books.create -> id=${w.id}`);
                return { id: w.id };
              });
            },
            update: (bookId, input, uid) =>
              spindle.world_books.update(bookId, input as never, uid),
            entries: {
              create: (bookId, input, uid) =>
                spindle.world_books.entries.create(bookId, input as never, uid).then((e) => ({ id: e.id })),
            },
          }
        : undefined,
      images: {
        upload: (input, uid) =>
          spindleImagesApi.upload(input, uid).then((img) => ({ id: img.id })),
        ...(typeof spindleImagesApi.uploadMany === 'function'
          ? {
              uploadMany: (items, options) =>
                spindleImagesApi.uploadMany(items as never, options),
            }
          : {}),
      },
      requestConsent: (opts) => requestConsent(opts, userId),
    };
    if (!spindle.world_books) log.warn(`spindle.world_books unavailable, lorebook entries will be skipped`);

    enterAssetUpload();
    try {
      const result = await importCard({
        bytes,
        fileName,
        extensionVersion,
        userId,
        spindle: spindleImportApi,
        userStorage: userStorage(),
        onProgress: (phase, message, fraction) => {
          log.info(`import.progress phase=${phase} frac=${fraction ?? '?'} msg=${message}`);
          send({
            type: 'import_progress',
            phase: phase as 'decoding' | 'translating' | 'awaiting_consent' | 'creating_character' | 'uploading_assets' | 'saving_payload' | 'done' | 'error',
            message,
            fraction,
          }, userId);
        },
      });
      log.info(
        `importCard: returned characterId=${result.characterId} name=${result.characterName} ` +
          `imageIds=${result.imageIds.length} warnings=${result.warnings.length} elapsed=${Date.now() - tStart}ms`,
      );
      nudgeGc('card-import');

      // Pre-seed worldBookIdsByCharacter so CHARACTER_DELETED before any chat-open still has the world_book id for cleanup.
      if (result.createdWorldBookIds.length > 0) {
        const existing = worldBookIdsByCharacter.get(result.characterId) ?? [];
        const merged = [...existing];
        for (const wbId of result.createdWorldBookIds) {
          if (!merged.includes(wbId)) merged.push(wbId);
        }
        worldBookIdsByCharacter.set(result.characterId, merged);
      }

      await refreshRisuAssetMap(result.characterId, userId).catch((err) => {
        log.warn(`importCardFromBytes: refreshRisuAssetMap threw char=${result.characterId}: ${errMsg(err)}`);
      });

      const scriptsToInstall = result.pendingRegexScripts;
      const ownership = await ensureRegexOwnership(
        spindle.regex_scripts,
        scriptsToInstall,
        userId,
      );
      const byTarget = new Map<string, number>();
      for (const s of scriptsToInstall) byTarget.set(s.target, (byTarget.get(s.target) ?? 0) + 1);
      const targetSummary = [...byTarget.entries()].map(([t, n]) => `${t}=${n}`).join(',') || 'none';
      log.info(
        `install_regex_scripts: push=${scriptsToInstall.length} ` +
          `targets=[${targetSummary}] char=${result.characterId}`,
      );
      send({
        type: 'install_regex_scripts',
        characterId: result.characterId,
        characterName: result.characterName,
        scripts: ownership.scripts,
        cleanupStale: ownership.allOwned,
      }, userId);

      const hasPendingSvgRaster = result.pendingSvgRasters.length > 0;
      if (hasPendingSvgRaster) {
        log.info(
          `rasterize_svgs: handing off ${result.pendingSvgRasters.length} unique SVG(s) to frontend for char=${result.characterId} ` +
            `(simple+theme-reactive+animated, templated skipped per manifest)`,
        );
        send({
          type: 'rasterize_svgs',
          characterId: result.characterId,
          characterName: result.characterName,
          svgs: result.pendingSvgRasters
            .filter((t) => t.classification !== 'templated')
            .map((t) => ({
              markerN: t.markerN,
              svg: t.svg,
              classification: t.classification as 'simple' | 'theme-reactive' | 'animated',
              width: t.width,
              height: t.height,
            })),
        }, userId);
      }

      if (hasPendingSvgRaster) {
        pendingImportCompletions.set(result.characterId, {
          hasPendingSvgRaster,
          characterName: result.characterName,
          startedAt: Date.now(),
          ownerUserId: userId,
        });
        log.info(
          `importCardFromBytes: deferring phase=done for char=${result.characterId} ` +
            `(pending: svg=${hasPendingSvgRaster})`,
        );
      } else {
        log.info(`import done: no pending async ops, sending phase=done`);
        send({
          type: 'import_progress',
          phase: 'done',
          message: `Imported ${result.characterName}`,
          fraction: 1,
          characterId: result.characterId,
        }, userId);
        pushCards(await listCards(userId), userId);
      }
      for (const warning of result.warnings) {
        log.warn(`import warning surfaced: ${warning}`);
        toastFor(userId, 'warning', warning, { title: 'lumirealm' });
      }
      log.info(`importCardFromBytes: done file=${fileName} total-elapsed=${Date.now() - tStart}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof RisuConsentDeclinedError) {
        log.info(`import cancelled by user (consent declined) after ${Date.now() - tStart}ms`);
        send({
          type: 'import_progress',
          phase: 'error',
          message: `Import cancelled, low-level access declined`,
          fraction: null,
          error: message,
        }, userId);
        return;
      }
      log.error(`import failed after ${Date.now() - tStart}ms: ${message}`);
      send({
        type: 'import_progress',
        phase: 'error',
        message: `Import of ${fileName} failed`,
        fraction: null,
        error: message,
      }, userId);
    } finally {
      exitAssetUpload();
    }
  }

  return { importCardFromBytes };
}
