import type { RealmFrontendToBackend, RealmBackendToFrontend } from './messages.js';
import { searchRealm, getRealmInfo, downloadRealmCard } from './api.js';
import { convertToCharx, type ImportFormatConversion } from './import-formats/index.js';
import type { SpindleAPI, UserPresetCreateDTO, UserPresetDTO } from 'lumiverse-spindle-types';
import { isRisuPresetBytes, decodeRisuPreset } from '../core/preset/risup-decoder.js';
import { translateRisuPreset } from '../core/preset/risup-translator.js';
import { reconcilePresetRegexScripts } from './preset-regex-reconcile.js';

export interface RealmBackendLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface RealmBackendDeps {
  readonly send: (msg: RealmBackendToFrontend, userId: string | undefined) => void;
  readonly log: RealmBackendLog;
  readonly importCardFromBytes: (bytes: Uint8Array, fileName: string, userId: string) => Promise<void>;
  readonly createPreset?: (input: UserPresetCreateDTO, userId?: string) => Promise<UserPresetDTO>;
  /** Global regex surface used to reconcile this preset's imported rows. */
  readonly regexApi: Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;
  readonly notifyImportProgress?: (progress: { type: 'import_progress'; phase: string; message: string; fraction: number | null; error?: string | null }, userId?: string) => void;
  readonly toast?: (msg: string, kind?: 'info' | 'error' | 'warning' | 'success') => void;
}

export interface RealmBackendHandle {
  handle(msg: RealmFrontendToBackend, userId: string | undefined): Promise<void>;
  importAnyFormat(bytes: Uint8Array, fileName: string, userId: string): Promise<void>;
}

export function isRealmFrontendMessage(msg: { type: string }): msg is RealmFrontendToBackend {
  return msg.type === 'realm_search' || msg.type === 'realm_info' || msg.type === 'realm_download';
}

export function setupRealmBackend(deps: RealmBackendDeps): RealmBackendHandle {
  const { send, log, importCardFromBytes } = deps;

  async function handle(msg: RealmFrontendToBackend, userId: string | undefined): Promise<void> {
    switch (msg.type) {
      case 'realm_search': {
        log.info(
          `realm_search: req=${msg.requestId} q=${JSON.stringify(msg.search)} page=${msg.page} sort=${msg.sort} nsfw=${msg.nsfw}`,
        );
        try {
          const r = await searchRealm({
            search: msg.search,
            page: msg.page,
            nsfw: msg.nsfw,
            sort: msg.sort,
          });
          log.info(`realm_search: req=${msg.requestId} -> cards=${r.cards.length}`);
          send({
            type: 'realm_search_result',
            requestId: msg.requestId,
            ok: true,
            cards: r.cards,
            ...(r.additionalHTML !== undefined ? { additionalHTML: r.additionalHTML } : {}),
          }, userId);
        } catch (err) {
          const error = errMessage(err);
          log.warn(`realm_search failed req=${msg.requestId}: ${error}`);
          send({
            type: 'realm_search_result',
            requestId: msg.requestId,
            ok: false,
            cards: [],
            error,
          }, userId);
        }
        break;
      }
      case 'realm_info': {
        log.info(`realm_info: req=${msg.requestId} id=${msg.id}`);
        try {
          const info = await getRealmInfo(msg.id);
          send({ type: 'realm_info_result', requestId: msg.requestId, ok: true, info }, userId);
        } catch (err) {
          const error = errMessage(err);
          log.warn(`realm_info failed req=${msg.requestId}: ${error}`);
          send({ type: 'realm_info_result', requestId: msg.requestId, ok: false, error }, userId);
        }
        break;
      }
      case 'realm_download': {
        log.info(`realm_download: req=${msg.requestId} id=${msg.id}`);
        if (userId === undefined) {
          send({
            type: 'realm_download_started',
            requestId: msg.requestId,
            ok: false,
            id: msg.id,
            error: 'realm_download: no userId',
          }, userId);
          break;
        }
        try {
          const dl = await downloadRealmCard(msg.id);
          log.info(
            `realm_download: req=${msg.requestId} id=${msg.id} contentType=${dl.contentType} bytes=${dl.bytes.byteLength} file=${dl.fileName}`,
          );
          let conv: ImportFormatConversion;
          try {
            conv = convertToCharx(dl.bytes, dl.fileName);
          } catch (err) {
            const error = errMessage(err);
            log.error(`realm_download convert failed req=${msg.requestId} id=${msg.id}: ${error}`);
            send({
              type: 'realm_download_started',
              requestId: msg.requestId,
              ok: false,
              id: msg.id,
              error,
            }, userId);
            break;
          }
          for (const note of conv.notes) log.info(`realm_download: ${note}`);
          send({
            type: 'realm_download_started',
            requestId: msg.requestId,
            ok: true,
            id: msg.id,
            fileName: conv.fileName,
            contentType: dl.contentType,
            bytes: conv.bytes.byteLength,
          }, userId);
          await importCardFromBytes(conv.bytes, conv.fileName, userId);
        } catch (err) {
          const error = errMessage(err);
          log.error(`realm_download failed req=${msg.requestId} id=${msg.id}: ${error}`);
          send({
            type: 'realm_download_started',
            requestId: msg.requestId,
            ok: false,
            id: msg.id,
            error,
          }, userId);
        }
        break;
      }
    }
  }

    async function importPresetFromBytes(bytes: Uint8Array, fileName: string, userId: string): Promise<void> {
    log.info(`importPresetFromBytes: decoding preset from ${fileName} (${bytes.byteLength} bytes)`);
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'decoding', message: `Decoding preset ${fileName}`, fraction: 0.2, error: null }, userId);
    const raw = await decodeRisuPreset(bytes, fileName);
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'translating', message: `Translating preset ${raw.name || fileName}`, fraction: 0.5, error: null }, userId);
    const { preset: presetInput, regexScripts } = translateRisuPreset(raw, fileName);

    if (!deps.createPreset) {
      throw new Error('Host preset creation is unavailable');
    }

    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'saving_payload', message: `Saving preset to Lumiverse`, fraction: 0.8, error: null }, userId);
    const created = await deps.createPreset(presetInput, userId);
    log.info(`importPresetFromBytes: created preset id=${created.id} name="${created.name}"`);

    let regexImported = 0;
    if (regexScripts.length > 0) {
      // The preset name is the regex folder, so re-importing the same archive
      // reconciles with the rows the previous import created.
      const reconciled = await reconcilePresetRegexScripts({
        api: deps.regexApi,
        userId,
        presetName: presetInput.name,
        rules: regexScripts,
        log,
        errMsg: errMessage,
      });
      regexImported = reconciled.created;
      log.info(
        `importPresetFromBytes: preset "${presetInput.name}" regex rules=${regexScripts.length} ` +
          `managed=${reconciled.managed} created=${reconciled.created} updated=${reconciled.updated} ` +
          `unchanged=${reconciled.unchanged} staleKept=${reconciled.staleKept} failed=${reconciled.failed}` +
          `${reconciled.listFailed ? ' listFailed=true' : ''}`,
      );
    }

    deps.toast?.(`Preset "${created.name}" imported (${created.prompt_order?.length ?? 0} blocks${regexImported > 0 ? `, ${regexImported} regex` : ''})`, 'success');
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'done', message: `Preset "${created.name}" imported successfully`, fraction: 1.0, error: null }, userId);
  }

  async function importAnyFormat(bytes: Uint8Array, fileName: string, userId: string): Promise<void> {
    if (isRisuPresetBytes(bytes, fileName)) {
      await importPresetFromBytes(bytes, fileName, userId);
      return;
    }
    let conv: ImportFormatConversion;
    try {
      conv = convertToCharx(bytes, fileName);
    } catch (err) {
      log.error(`importAnyFormat: format detection failed file=${fileName}: ${errMessage(err)}`);
      throw err;
    }
    for (const note of conv.notes) log.info(`importAnyFormat: ${note}`);
    if (!conv.synthesized) {
      await importCardFromBytes(bytes, fileName, userId);
      return;
    }
    log.info(
      `importAnyFormat: converted ${conv.originalFormat} → charx file=${fileName} → ${conv.fileName} bytes=${conv.bytes.byteLength}`,
    );
    await importCardFromBytes(conv.bytes, conv.fileName, userId);
  }

  return { handle, importAnyFormat };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}


