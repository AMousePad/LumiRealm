import type { RealmFrontendToBackend, RealmBackendToFrontend } from './messages.js';
import { searchRealm, getRealmInfo, downloadRealmCard } from './api.js';
import { convertToCharx, type ImportFormatConversion } from './import-formats/index.js';

export interface RealmBackendLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface RealmBackendDeps {
  readonly send: (msg: RealmBackendToFrontend, userId: string | undefined) => void;
  readonly log: RealmBackendLog;
  readonly importCardFromBytes: (bytes: Uint8Array, fileName: string, userId: string) => Promise<void>;
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

  async function importAnyFormat(bytes: Uint8Array, fileName: string, userId: string): Promise<void> {
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


