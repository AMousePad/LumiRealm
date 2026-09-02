import type { Handler } from './types.js';
import type { RisuCompatSettings } from '../state/settings-store.js';

export interface SettingsHandlerDeps {
  readonly getSettingsForUser: (userId: string) => Promise<RisuCompatSettings>;
  readonly applySettingsPatch: (userId: string, patch: Partial<RisuCompatSettings>) => Promise<RisuCompatSettings>;
  readonly normalizeSettingsPatch: (patch: unknown) => Partial<RisuCompatSettings>;
}

function settingsToWire(s: RisuCompatSettings): {
  readonly schema_version: 1;
  readonly auxConnectionId: RisuCompatSettings['auxConnectionId'];
  readonly auxModelOverride: RisuCompatSettings['auxModelOverride'];
  readonly auxSamplers: RisuCompatSettings['auxSamplers'];
  readonly submodelConnectionId: RisuCompatSettings['submodelConnectionId'];
  readonly submodelModelOverride: RisuCompatSettings['submodelModelOverride'];
  readonly submodelSamplers: RisuCompatSettings['submodelSamplers'];
  readonly auxPrefillCompat: RisuCompatSettings['auxPrefillCompat'];
  readonly submodelPrefillCompat: RisuCompatSettings['submodelPrefillCompat'];
  readonly auxDebugCaptureRequest: RisuCompatSettings['auxDebugCaptureRequest'];
  readonly auxDebugCaptureResponse: RisuCompatSettings['auxDebugCaptureResponse'];
  readonly legacyMediaFindings: RisuCompatSettings['legacyMediaFindings'];
  readonly translateEnabled: RisuCompatSettings['translateEnabled'];
  readonly skipAssetThumbnails: RisuCompatSettings['skipAssetThumbnails'];
} {
  return {
    schema_version: 1,
    auxConnectionId: s.auxConnectionId,
    auxModelOverride: s.auxModelOverride,
    auxSamplers: s.auxSamplers,
    submodelConnectionId: s.submodelConnectionId,
    submodelModelOverride: s.submodelModelOverride,
    submodelSamplers: s.submodelSamplers,
    auxPrefillCompat: s.auxPrefillCompat,
    submodelPrefillCompat: s.submodelPrefillCompat,
    auxDebugCaptureRequest: s.auxDebugCaptureRequest,
    auxDebugCaptureResponse: s.auxDebugCaptureResponse,
    legacyMediaFindings: s.legacyMediaFindings,
    translateEnabled: s.translateEnabled,
    skipAssetThumbnails: s.skipAssetThumbnails,
  };
}

export function createSettingsHandlers(deps: SettingsHandlerDeps): {
  readonly request_settings: Handler<'request_settings'>;
  readonly update_settings: Handler<'update_settings'>;
} {
  return {
    request_settings: async (_msg, ctx) => {
      const settings = await deps.getSettingsForUser(ctx.userId);
      ctx.send({ type: 'settings_pushed', settings: settingsToWire(settings) }, ctx.userId);
    },
    update_settings: async (msg, ctx) => {
      const patch = deps.normalizeSettingsPatch(msg.patch);
      const merged = await deps.applySettingsPatch(ctx.userId, patch);
      ctx.send({ type: 'settings_pushed', settings: settingsToWire(merged) }, ctx.userId);
    },
  };
}
