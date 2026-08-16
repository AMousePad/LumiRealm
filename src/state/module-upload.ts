import type { RisuModule } from '../core/schemas/module.js';
import {
  MODULE_SCHEMA_VERSION,
  pairModuleAssetsForUpload,
  type ModuleEnvelope,
} from './modules-store.js';

export interface DecodedRisum {
  readonly module: unknown;
  readonly assets: readonly Uint8Array[];
  readonly icon?: {
    readonly data: Uint8Array;
    readonly ext: string;
  };
}

export interface SchemaParseSuccess {
  readonly success: true;
  readonly data: RisuModule;
}
export interface SchemaParseFailure {
  readonly success: false;
  readonly error: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<string | number>; readonly message: string }> };
}
export type SchemaParseResult = SchemaParseSuccess | SchemaParseFailure;

export interface ConsentRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

export type UploadProgressFrame = {
  readonly type: 'import_progress';
  readonly phase: 'uploading_assets';
  readonly message: string;
  readonly fraction: number;
};

export interface ImageUploadInput {
  readonly data: Uint8Array;
  readonly mime_type: string;
  readonly filename: string;
}
export interface ImageUploadResult {
  readonly id?: string;
  readonly error?: string;
}

export interface ModuleUploaderDeps {
  readonly decodeRisum: (bytes: Uint8Array) => DecodedRisum;
  readonly decodeCharx: (bytes: Uint8Array) => DecodedRisum;
  readonly parseSchema: (data: unknown) => SchemaParseResult;
  readonly newUuid: () => string;
  readonly requestConsent: (opts: ConsentRequest, userId: string) => Promise<{ confirmed: boolean }>;
  readonly pairAssets: typeof pairModuleAssetsForUpload;
  readonly guessMimeType: (path: string) => string;
  readonly sniffImageMime: (bytes: Uint8Array) => { ext: string; mime: string } | null;
  readonly uploadImageOne: (input: ImageUploadInput, userId: string) => Promise<{ id?: string } | null>;
  readonly uploadImageMany?: (
    items: readonly ImageUploadInput[],
    opts: { userId: string },
  ) => Promise<readonly ImageUploadResult[]>;
  readonly appendToJournal: (userId: string, moduleId: string, ids: readonly string[]) => Promise<void>;
  readonly syncWorldBook: (env: ModuleEnvelope, userId: string) => Promise<string | null>;
  readonly writeEnvelope: (userId: string, env: ModuleEnvelope) => Promise<void>;
  readonly emitProgress: (frame: UploadProgressFrame, userId: string) => void;
  readonly currentTranslatorSchemaVersion: number;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface ModuleUploader {
  upload(bytes: Uint8Array, fileName: string, userId: string): Promise<{ envelope: ModuleEnvelope }>;
}

const PROGRESS_BASE = 0.35;
const PROGRESS_END = 0.92;
const UPLOAD_CONCURRENCY = 12;
const BATCH_MAX_ITEMS = 64;
const BATCH_MAX_BYTES = 16 * 1024 * 1024;

export function createModuleUploader(deps: ModuleUploaderDeps): ModuleUploader {
  async function upload(
    bytesIn: Uint8Array,
    fileName: string,
    userId: string,
  ): Promise<{ envelope: ModuleEnvelope }> {
    const t0 = Date.now();
    const inputBytes = bytesIn.byteLength;
    deps.log.info(
      `processModuleUpload: file=${fileName} bytes=${inputBytes} userId=${userId}`,
    );
    const tDecodeStart = Date.now();
    const isCharx = fileName.toLowerCase().endsWith('.charx');
    const decoded = isCharx
      ? deps.decodeCharx(bytesIn)
      : deps.decodeRisum(bytesIn);
    // Both decoders return independent per-asset buffers, so the source is no longer needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bytesIn as any) = new Uint8Array(0);
    deps.log.info(
      `processModuleUpload: decode ${isCharx ? 'CharX' : 'RisuM'} done ` +
        `assets=${decoded.assets.length} icon=${decoded.icon ? 'yes' : 'no'} ` +
        `elapsed=${Date.now() - tDecodeStart}ms`,
    );
    const parsed = deps.parseSchema(decoded.module);
    if (!parsed.success) {
      throw new Error(
        `decoded module failed schema validation,${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    const moduleBody = parsed.data;
    if (typeof moduleBody.id !== 'string' || moduleBody.id.length === 0) {
      throw new Error('module is missing an `id` cannot store');
    }
    // Risu parity: every upload of a module gets a fresh UUID, so two uploads
    // of the same .risum produce two independent entries.
    const sourceModuleId = moduleBody.id;
    moduleBody.id = deps.newUuid();
    deps.log.info(
      `processModuleUpload: assigned fresh id=${moduleBody.id} ` +
        `(source id was ${sourceModuleId})`,
    );

    if (moduleBody.lowLevelAccess === true) {
      deps.log.info(
        `processModuleUpload: lowLevelAccess=true for module=${moduleBody.id} ` +
          `name="${moduleBody.name ?? '<unnamed>'}",prompting consent`,
      );
      let confirmed = false;
      try {
        const res = await deps.requestConsent({
          title: `Module "${moduleBody.name ?? moduleBody.id}" requests low-level access`,
          message:
            `This module declares low-level access: its triggers can call runLLM, ` +
            `runImgGen, request, and other privileged APIs that consume tokens, ` +
            `hit external services, and read your chat state.\n\n` +
            `Only accept if you trust the source of this module.\n\n` +
            `Decline to refuse the upload, the module will not be added to your library.`,
          confirmLabel: 'Grant access',
          cancelLabel: 'Decline',
        }, userId);
        confirmed = !!res?.confirmed;
      } catch (err) {
        deps.log.warn(
          `processModuleUpload: consent prompt threw: ${deps.errMsg(err)},treating as decline`,
        );
        confirmed = false;
      }
      if (!confirmed) {
        deps.log.info(`processModuleUpload: consent declined for module=${moduleBody.id},aborting upload`);
        throw new Error(
          `Module "${moduleBody.name ?? moduleBody.id}" requires low-level access; consent declined.`,
        );
      }
      deps.log.info(`processModuleUpload: low-level access consent granted for module=${moduleBody.id}`);
    }

    const moduleAssetIndex: Record<string, { imageId: string; ext?: string }> = {};
    let assetUploadFailures = 0;
    if (decoded.assets.length > 0) {
      const moduleAssets = (moduleBody.assets ?? []) as readonly (readonly [string, string, string])[];
      const pending = deps.pairAssets(
        moduleAssets,
        decoded.assets,
        () => '',
        deps.guessMimeType,
      );
      if (pending.length < decoded.assets.length) {
        deps.log.warn(
          `processModuleUpload: ${decoded.assets.length - pending.length} asset(s) ` +
            `couldn't be paired with a module.assets[] name, dropped. ` +
            `(decoded.assets index out of bounds vs module.assets list.)`,
        );
      }

      const tUpload = Date.now();
      const totalCount = pending.length;
      let processed = 0;
      const moduleNameForProgress = typeof moduleBody.name === 'string' && moduleBody.name.length > 0
        ? moduleBody.name
        : moduleBody.id;
      const journalBuffer: string[] = [];
      let journalChain: Promise<void> = Promise.resolve();
      const flushJournal = (): void => {
        if (journalBuffer.length === 0) return;
        const ids = journalBuffer.splice(0);
        journalChain = journalChain.then(async () => {
          try {
            await deps.appendToJournal(userId, moduleBody.id, ids);
          } catch (err) {
            journalBuffer.unshift(...ids);
            deps.log.warn(`processModuleUpload: journal flush failed module=${moduleBody.id}: ${deps.errMsg(err)}`);
          }
        });
      };
      const recordUploaded = (assetName: string, imageId: string, sniffedExt?: string): void => {
        let ext = sniffedExt;
        if (ext === undefined) {
          const lastDot = assetName.lastIndexOf('.');
          if (lastDot > 0) ext = assetName.slice(lastDot + 1).toLowerCase();
        }
        moduleAssetIndex[assetName] = ext !== undefined
          ? { imageId, ext }
          : { imageId };
        journalBuffer.push(imageId);
      };
      const emitProgress = (): void => {
        const frac = totalCount === 0
          ? PROGRESS_END
          : PROGRESS_BASE + (PROGRESS_END - PROGRESS_BASE) * (processed / totalCount);
        deps.emitProgress({
          type: 'import_progress',
          phase: 'uploading_assets',
          message: `Uploading module assets for ${moduleNameForProgress} (${processed}/${totalCount})…`,
          fraction: frac,
        }, userId);
      };

      const uploadMany = deps.uploadImageMany;

      if (typeof uploadMany === 'function' && totalCount > 0) {
        deps.log.info(
          `processModuleUpload: uploading ${totalCount} asset(s) via spindle.images.uploadMany ` +
            `(module=${moduleBody.id}, batched)`,
        );
        let i = 0;
        while (i < pending.length) {
          const batchItems: ImageUploadInput[] = [];
          const batchAssetNames: string[] = [];
          const batchSniffedExts: Array<string | undefined> = [];
          let batchBytes = 0;
          while (i < pending.length && batchItems.length < BATCH_MAX_ITEMS) {
            const meta = pending[i];
            const bytes = meta ? decoded.assets[meta.sourceIndex] : undefined;
            if (!meta || !bytes) { i += 1; continue; }
            if (batchItems.length > 0 && batchBytes + bytes.byteLength > BATCH_MAX_BYTES) break;
            const sniff = deps.sniffImageMime(bytes);
            const uploadFilename = sniff ? `${meta.path}.${sniff.ext}` : meta.path;
            const uploadMime = sniff?.mime ?? meta.mimeType;
            batchItems.push({ data: bytes, mime_type: uploadMime, filename: uploadFilename });
            batchAssetNames.push(meta.path);
            batchSniffedExts.push(sniff?.ext);
            batchBytes += bytes.byteLength;
            i += 1;
          }
          let results: readonly ImageUploadResult[] = [];
          try {
            results = await uploadMany(batchItems, { userId });
          } catch (err) {
            const msg = deps.errMsg(err);
            deps.log.warn(`processModuleUpload: uploadMany batch failed (${batchItems.length} items): ${msg}`);
            results = batchItems.map(() => ({ error: msg }));
          }
          for (let k = 0; k < results.length; k++) {
            const r = results[k]!;
            const name = batchAssetNames[k]!;
            if (typeof r.id === 'string' && r.id.length > 0) {
              recordUploaded(name, r.id, batchSniffedExts[k]);
            } else {
              assetUploadFailures += 1;
              deps.log.warn(`processModuleUpload: upload failed name=${name}: ${r.error ?? 'unknown error'}`);
            }
          }
          processed += batchItems.length;
          flushJournal();
          emitProgress();
        }
      } else if (totalCount > 0) {
        deps.log.info(
          `processModuleUpload: uploading ${totalCount} asset(s) via spindle.images.upload ` +
            `(module=${moduleBody.id}, single, fallback)`,
        );
        const progressEvery = Math.max(1, Math.min(25, Math.floor(totalCount / 20) || 1));
        let nextIndex = 0;
        const uploadWorker = async (): Promise<void> => {
          while (true) {
            const idx = nextIndex++;
            if (idx >= pending.length) break;
            const meta = pending[idx];
            const bytes = meta ? decoded.assets[meta.sourceIndex] : undefined;
            if (!meta || !bytes) continue;
            const assetName = meta.path;
            const sniff = deps.sniffImageMime(bytes);
            const uploadFilename = sniff ? `${assetName}.${sniff.ext}` : assetName;
            const uploadMime = sniff?.mime ?? meta.mimeType;
            try {
              const result = await deps.uploadImageOne(
                { data: bytes, mime_type: uploadMime, filename: uploadFilename },
                userId,
              );
              if (typeof result?.id !== 'string' || result.id.length === 0) {
                throw new Error('upload returned without an image id');
              }
              recordUploaded(assetName, result.id, sniff?.ext);
            } catch (err) {
              assetUploadFailures += 1;
              deps.log.warn(`processModuleUpload: upload failed name=${assetName}: ${deps.errMsg(err)}`);
            }
            processed += 1;
            if (processed % progressEvery === 0 || processed === totalCount) {
              flushJournal();
              emitProgress();
            }
          }
        };
        const workers: Promise<void>[] = [];
        for (let w = 0; w < Math.min(UPLOAD_CONCURRENCY, pending.length); w++) {
          workers.push(uploadWorker());
        }
        await Promise.all(workers);
      }
      flushJournal();
      await journalChain;
      deps.log.info(
        `processModuleUpload: uploaded ${Object.keys(moduleAssetIndex).length}/${pending.length} ` +
          `failed=${assetUploadFailures} elapsed=${Date.now() - tUpload}ms`,
      );
    }

    if (decoded.icon) {
      const declaredExt = /^[a-z0-9]{1,10}$/i.test(decoded.icon.ext)
        ? decoded.icon.ext.toLowerCase()
        : '';
      const sniff = deps.sniffImageMime(decoded.icon.data);
      const ext = sniff?.ext ?? declaredExt;
      const filename = ext ? `module-icon.${ext}` : 'module-icon';
      try {
        const result = await deps.uploadImageOne(
          {
            data: decoded.icon.data,
            mime_type: sniff?.mime ?? deps.guessMimeType(filename),
            filename,
          },
          userId,
        );
        if (typeof result?.id !== 'string' || result.id.length === 0) {
          throw new Error('upload returned without an image id');
        }
        moduleBody.icon = result.id;
        try {
          await deps.appendToJournal(userId, moduleBody.id, [result.id]);
        } catch (err) {
          deps.log.warn(
            `processModuleUpload: icon journal append failed module=${moduleBody.id}: ${deps.errMsg(err)}`,
          );
        }
      } catch (err) {
        moduleBody.icon = '';
        deps.log.warn(
          `processModuleUpload: module icon upload failed module=${moduleBody.id}: ${deps.errMsg(err)}`,
        );
      }
    }

    const baseEnvelope: ModuleEnvelope = {
      schema_version: MODULE_SCHEMA_VERSION,
      id: moduleBody.id,
      filename: fileName,
      uploaded_at: Date.now(),
      module: moduleBody,
      asset_index: moduleAssetIndex,
      translator_schema_version: deps.currentTranslatorSchemaVersion,
    };
    const wbId = await deps.syncWorldBook(baseEnvelope, userId).catch((err) => {
      deps.log.warn(`processModuleUpload: syncModuleWorldBook failed module=${moduleBody.id}: ${deps.errMsg(err)}`);
      return null;
    });
    const envelope: ModuleEnvelope = {
      schema_version: baseEnvelope.schema_version,
      id: baseEnvelope.id,
      filename: baseEnvelope.filename,
      uploaded_at: baseEnvelope.uploaded_at,
      module: baseEnvelope.module,
      asset_index: baseEnvelope.asset_index,
      ...(baseEnvelope.translator_schema_version !== undefined
        ? { translator_schema_version: baseEnvelope.translator_schema_version }
        : {}),
      ...(wbId ? { installed_world_book_id: wbId } : {}),
    };
    await deps.writeEnvelope(userId, envelope);
    deps.log.info(
      `processModuleUpload: ok id=${envelope.id} name=${moduleBody.name} ` +
        `lore=${(moduleBody.lorebook ?? []).length} ` +
        `regex=${(moduleBody.regex ?? []).length} ` +
        `triggers=${(moduleBody.trigger ?? []).length} ` +
        `assets=${decoded.assets.length} ` +
        `icon=${moduleBody.icon ? 'yes' : 'no'} ` +
        `assetUploadFailures=${assetUploadFailures} ` +
        `wb=${envelope.installed_world_book_id ?? '-'} ` +
        `elapsed=${Date.now() - t0}ms`,
    );
    return { envelope };
  }

  return { upload };
}
