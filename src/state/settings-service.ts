import type { BackendToFrontend } from '../types/messages.js';
import type { AuxDebugCaptureEvent } from '../interpreter/runtime.js';
import type { UserStorageLike } from '../payload/installer.js';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  mergeSettings,
  type RisuCompatSettings,
} from './settings-store.js';
export interface SafeConnectionDTO {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly is_default: boolean;
}

export interface SettingsServiceDeps {
  readonly userStorage: () => UserStorageLike;
  readonly listConnections: (userId: string) => Promise<readonly SafeConnectionDTO[]>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export interface SettingsService {
  readonly getSettingsForUser: (userId: string) => Promise<RisuCompatSettings>;
  readonly getCachedSettingsSync: (userId: string | undefined) => RisuCompatSettings;
  readonly applySettingsPatch: (userId: string, patch: Partial<RisuCompatSettings>) => Promise<RisuCompatSettings>;
  readonly makeAuxDebugCapture: (
    chatId: string | null,
    settings: RisuCompatSettings,
    userId: string | undefined,
  ) => ((event: AuxDebugCaptureEvent) => void) | undefined;
  readonly listConnectionsForUser: (userId: string) => Promise<readonly SafeConnectionDTO[]>;
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { userStorage, listConnections, send, log, errMsg } = deps;
  const settingsByUser = new Map<string, RisuCompatSettings>();
  let auxDebugCounter = 0;

  async function getSettingsForUser(userId: string): Promise<RisuCompatSettings> {
    const cached = settingsByUser.get(userId);
    if (cached) return cached;
    const loaded = await loadSettings(userStorage(), userId);
    settingsByUser.set(userId, loaded);
    log.info(
      `settings: loaded for user=${userId} ` +
        `auxConn=${loaded.auxConnectionId ?? '<default>'} ` +
        `auxModel=${loaded.auxModelOverride ?? '<connection>'}`,
    );
    return loaded;
  }

  function getCachedSettingsSync(userId: string | undefined): RisuCompatSettings {
    if (userId === undefined) return DEFAULT_SETTINGS;
    return settingsByUser.get(userId) ?? DEFAULT_SETTINGS;
  }

  async function applySettingsPatch(
    userId: string,
    patch: Partial<RisuCompatSettings>,
  ): Promise<RisuCompatSettings> {
    const current = await getSettingsForUser(userId);
    const merged = mergeSettings(current, patch);
    await saveSettings(userStorage(), merged, userId);
    settingsByUser.set(userId, merged);
    log.info(
      `settings: saved for user=${userId} ` +
        `auxConn=${merged.auxConnectionId ?? '<default>'} ` +
        `auxModel=${merged.auxModelOverride ?? '<connection>'} ` +
        `dbgReq=${merged.auxDebugCaptureRequest} dbgRes=${merged.auxDebugCaptureResponse}`,
    );
    return merged;
  }

  function makeAuxDebugCapture(
    chatId: string | null,
    settings: RisuCompatSettings,
    userId: string | undefined,
  ): ((event: AuxDebugCaptureEvent) => void) | undefined {
    if (!settings.auxDebugCaptureRequest && !settings.auxDebugCaptureResponse) {
      return undefined;
    }
    if (userId === undefined) return undefined;
    return (event) => {
      const allowReq = settings.auxDebugCaptureRequest && event.kind === 'request';
      const allowRes = settings.auxDebugCaptureResponse && (event.kind === 'response' || event.kind === 'error');
      if (!allowReq && !allowRes) return;
      try {
        send({
          type: 'aux_debug_capture',
          id: ++auxDebugCounter,
          ts: Date.now(),
          kind: event.kind,
          channel: event.channel,
          chatId,
          auxConnectionId: event.auxConnectionId,
          auxModelOverride: event.auxModelOverride,
          elapsedMs: event.elapsedMs,
          payload: event.payload,
        }, userId);
      } catch (err) {
        log.warn(`aux_debug_capture send failed: ${errMsg(err)}`);
      }
    };
  }

  async function listConnectionsForUser(userId: string): Promise<readonly SafeConnectionDTO[]> {
    try {
      const raw = await listConnections(userId);
      return raw.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        model: c.model,
        is_default: c.is_default,
      }));
    } catch (err) {
      log.warn(`listConnectionsForUser: list threw: ${errMsg(err)}`);
      return [];
    }
  }

  return {
    getSettingsForUser,
    getCachedSettingsSync,
    applySettingsPatch,
    makeAuxDebugCapture,
    listConnectionsForUser,
  };
}
