// Per-user settings persisted at `lumirealm/settings.json`.
// All fields default to null (use connection defaults). Schema version 1.

export interface AuxSamplerOverrides {
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly contextSize: number | null;
  readonly topP: number | null;
  readonly minP: number | null;
  readonly topK: number | null;
  readonly frequencyPenalty: number | null;
  readonly presencePenalty: number | null;
  readonly repetitionPenalty: number | null;
}

export const SAMPLER_KEYS: readonly (keyof AuxSamplerOverrides)[] = [
  'temperature', 'maxTokens', 'contextSize', 'topP', 'minP', 'topK',
  'frequencyPenalty', 'presencePenalty', 'repetitionPenalty',
] as const;

export const DEFAULT_SAMPLERS: AuxSamplerOverrides = {
  temperature: null, maxTokens: null, contextSize: null,
  topP: null, minP: null, topK: null,
  frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
};

export interface NaiSettings {
  readonly model: string | null;
  readonly resolution: string;
  readonly sampler: string;
  readonly steps: number;
  readonly guidance: number;
  readonly negativePrompt: string | null;
  readonly smea: boolean;
  readonly smeaDyn: boolean;
  readonly seed: number | null;
  readonly qualityToggle: boolean;
  readonly ucPreset: number;
}

export const DEFAULT_NAI_SETTINGS: NaiSettings = {
  model: null,
  resolution: '832x1216',
  sampler: 'k_euler_ancestral',
  steps: 28,
  guidance: 5.0,
  negativePrompt: null,
  smea: false,
  smeaDyn: false,
  seed: null,
  qualityToggle: true,
  ucPreset: 0,
};

export function normalizeNaiSettings(raw: unknown): NaiSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_NAI_SETTINGS;
  const r = raw as Record<string, unknown>;

  let model: string | null = null;
  if (typeof r.model === 'string') {
    const trimmed = r.model.trim();
    model = trimmed.length > 0 ? trimmed : null;
  }

  const resolution = typeof r.resolution === 'string' && r.resolution.trim().length > 0
    ? r.resolution.trim()
    : DEFAULT_NAI_SETTINGS.resolution;

  const sampler = typeof r.sampler === 'string' && r.sampler.trim().length > 0
    ? r.sampler.trim()
    : DEFAULT_NAI_SETTINGS.sampler;

  let steps = DEFAULT_NAI_SETTINGS.steps;
  if (typeof r.steps === 'number' && Number.isFinite(r.steps)) {
    steps = Math.max(1, Math.min(50, Math.round(r.steps)));
  }

  let guidance = DEFAULT_NAI_SETTINGS.guidance;
  if (typeof r.guidance === 'number' && Number.isFinite(r.guidance)) {
    guidance = Math.max(1, Math.min(20, r.guidance));
  }

  let negativePrompt: string | null = null;
  if (typeof r.negativePrompt === 'string') {
    const trimmed = r.negativePrompt.trim();
    negativePrompt = trimmed.length > 0 ? trimmed : null;
  }

  const smea = r.smea === true;
  const smeaDyn = r.smeaDyn === true;

  let seed: number | null = null;
  if (typeof r.seed === 'number' && Number.isFinite(r.seed) && r.seed >= 0) {
    seed = Math.floor(r.seed);
  }

  const qualityToggle = r.qualityToggle !== false;

  let ucPreset = DEFAULT_NAI_SETTINGS.ucPreset;
  if (typeof r.ucPreset === 'number' && Number.isFinite(r.ucPreset)) {
    ucPreset = Math.max(0, Math.floor(r.ucPreset));
  }

  return {
    model,
    resolution,
    sampler,
    steps,
    guidance,
    negativePrompt,
    smea,
    smeaDyn,
    seed,
    qualityToggle,
    ucPreset,
  };
}

export interface RisuCompatSettings {
  readonly schema_version: 1;
  readonly auxConnectionId: string | null;
  /** `null` = use the connection's own model. Passed verbatim to `spindle.generate.raw`. */
  readonly auxModelOverride: string | null;
  readonly auxSamplers: AuxSamplerOverrides;
  readonly submodelConnectionId: string | null;
  /** `null` = use submodel connection's own model. */
  readonly submodelModelOverride: string | null;
  readonly submodelSamplers: AuxSamplerOverrides;
  /** Fold an assistant-message prefill into a user instruction for models that reject prefill. */
  readonly auxPrefillCompat: boolean;
  readonly submodelPrefillCompat: boolean;
  readonly auxDebugCaptureRequest: boolean;
  readonly auxDebugCaptureResponse: boolean;
  readonly legacyMediaFindings: boolean;
  /** Browser-translated module/lorebook display, ON by default. Display-only. */
  readonly translateEnabled: boolean;
  /** Upload card/module assets with skip_thumbnail_processing. ON by default, applies at import time only. */
  readonly skipAssetThumbnails: boolean;
  /** Image generation profile connection ID. `null` = use host default image gen connection. */
  readonly imageConnectionId: string | null;
  /** Optional model override for image generation. */
  readonly imageModelOverride: string | null;
  /** NovelAI generation parameters passed when using a NovelAI image connection. */
  readonly naiSettings: NaiSettings;
}

export const DEFAULT_SETTINGS: RisuCompatSettings = {
  schema_version: 1,
  auxConnectionId: null,
  auxModelOverride: null,
  auxSamplers: DEFAULT_SAMPLERS,
  submodelConnectionId: null,
  submodelModelOverride: null,
  submodelSamplers: DEFAULT_SAMPLERS,
  auxPrefillCompat: false,
  submodelPrefillCompat: false,
  auxDebugCaptureRequest: false,
  auxDebugCaptureResponse: false,
  legacyMediaFindings: false,
  translateEnabled: true,
  skipAssetThumbnails: true,
  imageConnectionId: null,
  imageModelOverride: null,
  naiSettings: DEFAULT_NAI_SETTINGS,
};

export const SETTINGS_PATH = "lumirealm/settings.json";

export function isStoredSettings(v: unknown): v is RisuCompatSettings {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.schema_version !== 1) return false;
  if (o.auxConnectionId !== null && typeof o.auxConnectionId !== "string") return false;
  if (o.auxModelOverride !== null && typeof o.auxModelOverride !== "string") return false;
  // submodel* fields are additive; pre-existing files won't have them.
  if (o.submodelConnectionId !== undefined && o.submodelConnectionId !== null && typeof o.submodelConnectionId !== "string") return false;
  if (o.submodelModelOverride !== undefined && o.submodelModelOverride !== null && typeof o.submodelModelOverride !== "string") return false;
  if (o.imageConnectionId !== undefined && o.imageConnectionId !== null && typeof o.imageConnectionId !== "string") return false;
  if (o.imageModelOverride !== undefined && o.imageModelOverride !== null && typeof o.imageModelOverride !== "string") return false;
  return true;
}

/** Coerce a sampler bag to canonical shape. Wrong-type values become null. */
export function normalizeSamplers(raw: unknown): AuxSamplerOverrides {
  const r = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const out: { -readonly [K in keyof AuxSamplerOverrides]: number | null } = {
    temperature: null, maxTokens: null, contextSize: null,
    topP: null, minP: null, topK: null,
    frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
  };
  for (const k of SAMPLER_KEYS) {
    const v = r[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    // Strings silently drop to null (corrupted edit).
  }
  return out;
}

/** Sanitize an incoming patch. Trims strings; empty strings become null. Unknown fields dropped. */
export function normalizeSettingsPatch(patch: unknown): Partial<RisuCompatSettings> {
  if (!patch || typeof patch !== "object") return {};
  const p = patch as Record<string, unknown>;
  const out: { -readonly [K in keyof RisuCompatSettings]?: RisuCompatSettings[K] } = {};
  if ("auxConnectionId" in p) {
    const v = p.auxConnectionId;
    if (v === null) out.auxConnectionId = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.auxConnectionId = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("auxModelOverride" in p) {
    const v = p.auxModelOverride;
    if (v === null) out.auxModelOverride = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.auxModelOverride = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("auxSamplers" in p) {
    out.auxSamplers = normalizeSamplers(p.auxSamplers);
  }
  if ("submodelConnectionId" in p) {
    const v = p.submodelConnectionId;
    if (v === null) out.submodelConnectionId = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.submodelConnectionId = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("submodelModelOverride" in p) {
    const v = p.submodelModelOverride;
    if (v === null) out.submodelModelOverride = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.submodelModelOverride = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("submodelSamplers" in p) {
    out.submodelSamplers = normalizeSamplers(p.submodelSamplers);
  }
  if ("auxPrefillCompat" in p) {
    out.auxPrefillCompat = !!p.auxPrefillCompat;
  }
  if ("submodelPrefillCompat" in p) {
    out.submodelPrefillCompat = !!p.submodelPrefillCompat;
  }
  if ("auxDebugCaptureRequest" in p) {
    out.auxDebugCaptureRequest = !!p.auxDebugCaptureRequest;
  }
  if ("auxDebugCaptureResponse" in p) {
    out.auxDebugCaptureResponse = !!p.auxDebugCaptureResponse;
  }
  if ("legacyMediaFindings" in p) {
    out.legacyMediaFindings = !!p.legacyMediaFindings;
  }
  if ("translateEnabled" in p) {
    out.translateEnabled = !!p.translateEnabled;
  }
  if ("skipAssetThumbnails" in p) {
    out.skipAssetThumbnails = !!p.skipAssetThumbnails;
  }
  if ("imageConnectionId" in p) {
    const v = p.imageConnectionId;
    if (v === null) out.imageConnectionId = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.imageConnectionId = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("imageModelOverride" in p) {
    const v = p.imageModelOverride;
    if (v === null) out.imageModelOverride = null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out.imageModelOverride = trimmed.length === 0 ? null : trimmed;
    }
  }
  if ("naiSettings" in p) {
    out.naiSettings = normalizeNaiSettings(p.naiSettings);
  }
  return out;
}

export interface UserStorageLike {
  getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>;
  setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>;
}

export async function loadSettings(
  storage: UserStorageLike,
  userId: string | undefined,
): Promise<RisuCompatSettings> {
  try {
    const raw = await storage.getJson<unknown>(SETTINGS_PATH, {
      fallback: null,
      ...(userId === undefined ? {} : { userId }),
    });
    if (!isStoredSettings(raw)) return DEFAULT_SETTINGS;
    // Fill in optional fields that may be absent from older files.
    const stored = raw as RisuCompatSettings & {
      auxSamplers?: unknown;
      submodelConnectionId?: unknown;
      submodelModelOverride?: unknown;
      submodelSamplers?: unknown;
      auxPrefillCompat?: unknown;
      submodelPrefillCompat?: unknown;
      auxDebugCaptureRequest?: unknown;
      auxDebugCaptureResponse?: unknown;
      legacyMediaFindings?: unknown;
      translateEnabled?: unknown;
      skipAssetThumbnails?: unknown;
      imageConnectionId?: unknown;
      imageModelOverride?: unknown;
      naiSettings?: unknown;
    };
    return {
      schema_version: 1,
      auxConnectionId: stored.auxConnectionId,
      auxModelOverride: stored.auxModelOverride,
      auxSamplers: stored.auxSamplers !== undefined
        ? normalizeSamplers(stored.auxSamplers)
        : DEFAULT_SAMPLERS,
      submodelConnectionId: typeof stored.submodelConnectionId === "string"
        ? stored.submodelConnectionId
        : null,
      submodelModelOverride: typeof stored.submodelModelOverride === "string"
        ? stored.submodelModelOverride
        : null,
      submodelSamplers: stored.submodelSamplers !== undefined
        ? normalizeSamplers(stored.submodelSamplers)
        : DEFAULT_SAMPLERS,
      auxPrefillCompat: stored.auxPrefillCompat === true,
      submodelPrefillCompat: stored.submodelPrefillCompat === true,
      auxDebugCaptureRequest: stored.auxDebugCaptureRequest === true,
      auxDebugCaptureResponse: stored.auxDebugCaptureResponse === true,
      legacyMediaFindings: stored.legacyMediaFindings === true,
      translateEnabled: stored.translateEnabled === undefined ? true : stored.translateEnabled === true,
      skipAssetThumbnails: stored.skipAssetThumbnails === undefined ? true : stored.skipAssetThumbnails === true,
      imageConnectionId: typeof stored.imageConnectionId === "string"
        ? stored.imageConnectionId
        : null,
      imageModelOverride: typeof stored.imageModelOverride === "string"
        ? stored.imageModelOverride
        : null,
      naiSettings: stored.naiSettings !== undefined
        ? normalizeNaiSettings(stored.naiSettings)
        : DEFAULT_NAI_SETTINGS,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persist settings. Caller is responsible for merging with prior values. */
export async function saveSettings(
  storage: UserStorageLike,
  settings: RisuCompatSettings,
  userId: string | undefined,
): Promise<void> {
  await storage.setJson(SETTINGS_PATH, settings, {
    indent: 2,
    ...(userId === undefined ? {} : { userId }),
  });
}

/** Apply a sanitized patch. Pure; does not persist. */
export function mergeSettings(
  base: RisuCompatSettings,
  patch: Partial<RisuCompatSettings>,
): RisuCompatSettings {
  return {
    ...base,
    ...patch,
    schema_version: 1,
  };
}
