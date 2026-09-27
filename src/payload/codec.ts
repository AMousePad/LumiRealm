import type {
  AssetIndexEntry,
  LumirealmCharacterData,
  LumirealmUserOverrides,
  RisuPayload,
  StoredRegexScript,
  StoredRisuCard,
} from './types.js';

export class RisuCompatUnsupportedError extends Error {
  override readonly name = 'RisuCompatUnsupportedError';
  constructor(
    readonly feature: string,
    readonly reason: string,
  ) {
    super(`risu-compat: ${feature} is unsupported (${reason})`);
  }
}

export class RisuCompatVersionError extends Error {
  override readonly name = 'RisuCompatVersionError';
  constructor(
    readonly missing: readonly string[],
    readonly extensionVersion: string,
  ) {
    super(
      `risu-compat v${extensionVersion} is missing required capabilities: ${missing.join(', ')}. Please update the extension.`,
    );
  }
}

export class RisuConsentDeclinedError extends Error {
  override readonly name = 'RisuConsentDeclinedError';
  constructor(readonly characterName: string) {
    super(
      `risu-compat: import of "${characterName}" cancelled — low-level access consent declined.`,
    );
  }
}

export class RisuConsentRequiredError extends Error {
  override readonly name = 'RisuConsentRequiredError';
  constructor(characterName: string) {
    super(`Low-level access consent is required for "${characterName}". Open this card to review and grant access.`);
  }
}

/** Capabilities this extension version is confirmed to handle faithfully. */
export const SUPPORTED_HOST_FEATURES = new Set<string>([
  'alertSelect',
]);

// Card asks for these; warn but still load.
export const DEGRADED_HOST_FEATURES = new Set<string>([
  'utilityBot',
  'displayTriggerSemantics',
]);

export interface PreValidateResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly degraded: readonly string[];
}

export function preValidateRequires(
  requires: RisuPayload['requires'],
): PreValidateResult {
  const missing: string[] = [];
  const degraded: string[] = [];
  for (const feature of requires.hostFeatures) {
    if (SUPPORTED_HOST_FEATURES.has(feature)) continue;
    if (DEGRADED_HOST_FEATURES.has(feature)) {
      degraded.push(feature);
      continue;
    }
    missing.push(feature);
  }
  return { ok: missing.length === 0, missing, degraded };
}

export function makeStoredCard(
  characterId: string,
  extensionVersion: string,
  payload: RisuPayload,
  assetIndex: Record<string, AssetIndexEntry>,
  emotionIndex: Record<string, AssetIndexEntry> = {},
  regexScripts?: readonly StoredRegexScript[],
): StoredRisuCard {
  return {
    schema_version: 1,
    character_id: characterId,
    stored_at: Date.now(),
    extension_version: extensionVersion,
    risuPayload: payload,
    asset_index: assetIndex,
    emotion_index: emotionIndex,
    ...(regexScripts && regexScripts.length > 0 ? { regex_scripts: regexScripts } : {}),
  };
}

export function buildLumirealmData(
  payload: RisuPayload,
  extensionVersion: string,
  regexScripts: readonly StoredRegexScript[] = [],
  assetIndex: Readonly<Record<string, AssetIndexEntry>> = {},
  emotionIndex: Readonly<Record<string, AssetIndexEntry>> = {},
  importedAt: number = Date.now(),
  userOverrides: LumirealmUserOverrides = {},
  source?: import('./types.js').LumirealmStoredSource,
  translatorSchemaVersion?: number,
): LumirealmCharacterData {
  return {
    schema_version: 1,
    imported_at: importedAt,
    extension_version: extensionVersion,
    translator_version: payload.translator_version,
    ...(translatorSchemaVersion !== undefined ? { translator_schema_version: translatorSchemaVersion } : {}),
    ...(source ? { source } : {}),
    payload: {
      triggers: payload.triggers,
      lua_scripts: payload.lua_scripts,
      at_actions: payload.at_actions,
      additional_assets: payload.additional_assets,
      emotion_images: payload.emotion_images,
      // Restored after refactor regression; see core/payload/types.ts LumirealmCharacterData.payload.
      background_html: payload.background_html,
      ...(typeof payload.background_html_source === "string"
        ? { background_html_source: payload.background_html_source }
        : {}),
      utility_bot: payload.utility_bot,
      scriptstate_defaults: payload.scriptstate_defaults,
      requires: payload.requires,
      ...(payload.untranslated ? { untranslated: payload.untranslated } : {}),
    },
    asset_index: assetIndex,
    emotion_index: emotionIndex,
    regex_scripts: regexScripts,
    user_overrides: userOverrides,
  };
}

export function isLumirealmData(value: unknown): value is LumirealmCharacterData {
  if (value === null || typeof value !== 'object') return false;
  const v = value as { schema_version?: unknown };
  return v.schema_version === 1;
}


export function makeLowLevelAccessConsentMessage(characterName: string): string {
  return (
    `"${characterName}" requests low-level access. With this granted the card may:\n\n` +
    `  • Make additional LLM API calls (uses your tokens / billing)\n` +
    `  • Run helper / classifier prompts in the background\n` +
    `  • Trigger image generation (if your provider supports it)\n` +
    `  • Inspect message similarity / embeddings\n\n` +
    `Only grant access for cards from sources you trust.`
  );
}
