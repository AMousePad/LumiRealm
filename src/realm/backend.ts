import type { RealmFrontendToBackend, RealmBackendToFrontend } from './messages.js';
import { searchRealm, getRealmInfo, downloadRealmCard } from './api.js';
import { convertToCharx, type ImportFormatConversion } from './import-formats/index.js';
import type { RegexScriptCreateDTO, RegexScriptDTO, SpindleAPI, UserPresetCreateDTO, UserPresetDTO } from 'lumiverse-spindle-types';
import { isRisuPresetBytes, decodeRisuPreset } from '../core/preset/risup-decoder.js';
import { translateRisuPreset } from '../core/preset/risup-translator.js';
import { translatePresetLabels } from '../core/preset/preset-labels.js';
import { runPresetRegexExclusive, suspendedPresetRule } from '../state/preset-regex-activation.js';

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
  /** Removes a preset whose regex rules did not all install. */
  readonly deletePreset: (presetId: string, userId: string) => Promise<boolean>;
  /** Rewrites imported preset display labels; absent when the host cannot generate. */
  readonly translatePresetLabels?: (
    preset: UserPresetCreateDTO,
    opts: { readonly connectionId: string; readonly userId: string },
  ) => Promise<UserPresetCreateDTO>;
  /** Global regex surface the imported preset's rules are created through. */
  readonly regexApi: Pick<SpindleAPI['regex_scripts'], 'create' | 'delete'>;
  readonly notifyImportProgress?: (progress: { type: 'import_progress'; phase: string; message: string; fraction: number | null; error?: string | null }, userId?: string) => void;
  readonly toast?: (msg: string, kind?: 'info' | 'error' | 'warning' | 'success') => void;
}

/** A preset whose regex rules cannot all be installed is not imported. */
export class PresetRegexImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetRegexImportError';
  }
}

export interface PresetImportOptions {
  /** Set when the user opted into label translation for this import. */
  readonly labelTranslation?: { readonly connectionId: string };
}

export interface RealmBackendHandle {
  handle(msg: RealmFrontendToBackend, userId: string | undefined): Promise<void>;
  importAnyFormat(bytes: Uint8Array, fileName: string, userId: string, opts?: PresetImportOptions): Promise<void>;
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

    async function importPresetFromBytes(
      bytes: Uint8Array,
      fileName: string,
      userId: string,
      opts?: PresetImportOptions,
    ): Promise<void> {
    log.info(`importPresetFromBytes: decoding preset from ${fileName} (${bytes.byteLength} bytes)`);
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'decoding', message: `Decoding preset ${fileName}`, fraction: 0.2, error: null }, userId);
    const raw = await decodeRisuPreset(bytes, fileName);
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'translating', message: `Translating preset ${raw.name || fileName}`, fraction: 0.5, error: null }, userId);
    const { preset: translatedPreset, regexScripts, skippedRegex } = translateRisuPreset(raw, fileName);
    if (skippedRegex.length > 0) {
      // Risu's processScriptFull runs @@emo and @@inject against the open character, which a preset row cannot reach.
      failPresetRegexImport(translatedPreset.name, skippedRegex.map((s) =>
        `rule ${s.index + 1} "${s.script.comment ?? ''}" uses @@${s.action}, which LumiRealm cannot run from a preset`), userId);
    }
    const presetInput = opts?.labelTranslation === undefined
      ? translatedPreset
      : await translateImportedPresetLabels(translatedPreset, opts.labelTranslation.connectionId, userId);

    if (!deps.createPreset) {
      throw new Error('Host preset creation is unavailable');
    }

    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'saving_payload', message: `Saving preset to Lumiverse`, fraction: 0.8, error: null }, userId);
    const created = await deps.createPreset(presetInput, userId);
    log.info(`importPresetFromBytes: created preset id=${created.id} name="${created.name}"`);

    await runPresetRegexExclusive(userId, () => installPresetRegex(created, regexScripts, userId));

    deps.toast?.(`Preset "${created.name}" imported (${created.prompt_order?.length ?? 0} blocks${regexScripts.length > 0 ? `, ${regexScripts.length} regex` : ''})`, 'success');
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'done', message: `Preset "${created.name}" imported successfully`, fraction: 1.0, error: null }, userId);
  }

  /** Creates the preset's regex rules bound to it; when any rule does not install, removes the preset and throws. */
  async function installPresetRegex(
    preset: UserPresetDTO,
    rules: readonly RegexScriptCreateDTO[],
    userId: string,
  ): Promise<void> {
    const failures: string[] = [];
    const unboundIds: string[] = [];
    for (const rule of rules) {
      // A preset-bound row is deleted by the host together with its preset. The pinned 0.6.25 types predate this create-only field.
      const input: RegexScriptCreateDTO & { readonly preset_id: string } = { ...suspendedPresetRule(rule), preset_id: preset.id };
      try {
        const row: RegexScriptDTO & { readonly preset_id?: string | null } = await deps.regexApi.create(input, userId);
        if (row.preset_id !== preset.id) {
          unboundIds.push(row.id);
          failures.push(`"${rule.name}" was stored without its preset link, which this Lumiverse version does not support`);
        }
      } catch (err) {
        failures.push(`"${rule.name}": ${errMessage(err)}`);
      }
    }
    if (failures.length === 0) return;
    // Deleting the preset deletes its bound rows; a row the host left unbound needs its own delete.
    try {
      for (const id of unboundIds) await deps.regexApi.delete(id, userId);
      await deps.deletePreset(preset.id, userId);
    } catch (err) {
      failures.push(`removing the partial import failed: ${errMessage(err)}`);
    }
    failPresetRegexImport(preset.name, failures, userId);
  }

  function failPresetRegexImport(presetName: string, failures: readonly string[], userId: string): never {
    const error = new PresetRegexImportError(`Preset "${presetName}" was not imported: ${failures.join('; ')}`);
    deps.notifyImportProgress?.({ type: 'import_progress', phase: 'error', message: error.message, fraction: null, error: error.message }, userId);
    throw error;
  }

  async function translateImportedPresetLabels(
    preset: UserPresetCreateDTO,
    connectionId: string,
    userId: string,
  ): Promise<UserPresetCreateDTO> {
    const translate = deps.translatePresetLabels;
    if (!translate) throw new Error('Preset label translation is unavailable on this host');
    deps.notifyImportProgress?.(
      { type: 'import_progress', phase: 'translating', message: 'Translating preset labels', fraction: 0.65, error: null },
      userId,
    );
    const translated = await translate(preset, { connectionId, userId });
    log.info(`importPresetFromBytes: translated preset labels via connection=${connectionId.slice(0, 8)}...`);
    return translated;
  }

  async function importAnyFormat(
    bytes: Uint8Array,
    fileName: string,
    userId: string,
    opts?: PresetImportOptions,
  ): Promise<void> {
    if (isRisuPresetBytes(bytes, fileName)) {
      await importPresetFromBytes(bytes, fileName, userId, opts);
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


