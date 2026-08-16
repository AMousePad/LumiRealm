export interface RisuRequires {
  readonly lowLevelAccess: boolean;
  readonly hostFeatures: readonly string[];
  readonly lua: boolean;
}

export interface UntranslatedCounters {
  readonly utility_bot?: boolean;
  readonly display_trigger_semantics_shifted?: number;
  readonly [k: string]: unknown;
}

export interface RisuAsset {
  readonly name: string;
  readonly path: string;
  readonly ext?: string;
}

export interface RisuPayload {
  readonly triggers: readonly unknown[];
  readonly lua_scripts: readonly string[];
  readonly at_actions: readonly unknown[];
  readonly background_html: string | null;
  // Seeded from background_html at import; user/agent authoring surface.
  readonly background_html_source?: string;
  readonly module_background_embedding?: string;
  readonly virtualscript: string | null;
  readonly utility_bot: boolean;
  readonly scriptstate_defaults: Readonly<Record<string, string>>;
  readonly additional_assets: readonly RisuAsset[];
  readonly emotion_images: readonly RisuAsset[];
  readonly extra: Readonly<Record<string, unknown>>;
  readonly translator_version: string;
  readonly risu_spec_version: string;
  readonly requires: RisuRequires;
  readonly untranslated?: UntranslatedCounters;
}

export interface StoredRisuCard {
  readonly schema_version: 1;
  readonly character_id: string;
  readonly stored_at: number;
  readonly extension_version: string;
  readonly risuPayload: RisuPayload;
  readonly asset_index: Readonly<Record<string, AssetIndexEntry>>;
  readonly emotion_index: Readonly<Record<string, AssetIndexEntry>>;
  readonly regex_scripts?: readonly StoredRegexScript[];
}

export interface StoredRegexScript {
  readonly name: string;
  readonly script_id: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly placement: readonly string[];
  readonly scope: "global" | "character" | "chat";
  readonly scope_id: string | null;
  readonly target: "prompt" | "response" | "display";
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly trim_strings: readonly string[];
  readonly run_on_edit: boolean;
  readonly substitute_macros: "none" | "find" | "raw" | "escaped" | "after";
  readonly disabled: boolean;
  readonly sort_order: number;
  readonly description: string;
  readonly folder: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AssetIndexEntry {
  readonly imageIds: readonly string[];
  readonly ext?: string;
}

export function cardStoragePath(characterId: string): string {
  return `risu-compat/characters/${characterId}.json`;
}

export interface LumirealmUserOverrides {
  readonly utility_bot_override?: boolean;
  readonly low_level_access_granted?: boolean;
  readonly consent_acknowledged_at?: number;
  readonly default_variables_overrides?: Readonly<Record<string, string>>;
  /** Risu-parity master string for defaults, parsed via `parseKeyValue` at runtime.
   *  Takes precedence over the card-side baseline when set. */
  readonly default_variables_text?: string;
  readonly attached_module_ids?: readonly string[];
  readonly attached_module_world_books?: Readonly<Record<string, string>>;
  readonly attached_module_regex_script_ids?: Readonly<Record<string, readonly string[]>>;
  readonly portal_decisions?: Readonly<Record<string, "portal" | "inline">>;
}

export interface LumirealmCharacterData {
  readonly schema_version: 1;
  readonly imported_at: number;
  readonly extension_version: string;
  readonly translator_version: string;
  // Lazy retranslation on chat-open fires when stored < current.
  readonly translator_schema_version?: number;
  readonly display_owner?: boolean;
  // Pre-translation Risu source, lets us re-translate without the .charx.
  readonly source?: LumirealmStoredSource;
  readonly payload: {
    readonly triggers: readonly unknown[];
    readonly lua_scripts: readonly string[];
    readonly at_actions: readonly unknown[];
    readonly additional_assets: readonly RisuAsset[];
    readonly emotion_images: readonly RisuAsset[];
    readonly background_html: string | null;
    /** Pre-translate raw, viewer textarea seeds from this when set. */
    readonly background_html_source?: string | null;
    readonly utility_bot: boolean;
    readonly scriptstate_defaults: Readonly<Record<string, string>>;
    readonly requires: RisuRequires;
    readonly untranslated?: UntranslatedCounters;
  };
  readonly asset_index: Readonly<Record<string, AssetIndexEntry>>;
  readonly emotion_index: Readonly<Record<string, AssetIndexEntry>>;
  readonly regex_scripts: readonly StoredRegexScript[];
  readonly portal_candidates?: readonly PortalCandidate[];
  readonly user_overrides: LumirealmUserOverrides;
  readonly translations?: CharacterTranslations;
}

// Outer key = target language code, display-only browser-translated cache.
export interface CharacterTranslations {
  readonly [lang: string]: CharacterLangTranslation | undefined;
}

export interface CharacterLangTranslation {
  readonly name?: string;
  readonly lorebook?: Readonly<Record<string, CharacterEntryTranslation>>;
}

export interface CharacterEntryTranslation {
  readonly comment?: string;
}

export interface LumirealmStoredSource {
  readonly schema_version: 1;
  readonly captured_at: number;
  readonly card: unknown;
  readonly module: unknown | null;
  readonly path_to_image_id: Readonly<Record<string, string>>;
}

// Domain-specific versions live in `migrations/character.ts` and
// `migrations/module.ts`. This shared constant is kept as the max of
// both for any caller that genuinely doesn't care which domain.
export const CURRENT_TRANSLATOR_SCHEMA_VERSION = 5;

export interface PortalCandidate {
  readonly id: string;
  readonly source:
    | { readonly kind: "regex_rule"; readonly sort_order: number; readonly find_regex_preview: string }
    | { readonly kind: "greeting"; readonly alt_index: number };
  readonly subtree_html: string;
  readonly triggering_selectors: readonly string[];
  readonly triggering_css_source: "rule_inline_style" | "bg_html" | "both" | "inline_style_attr";
  readonly confidence: "high-yes" | "ambiguous" | "high-no";
  readonly heuristic_decision: "portal" | "inline";
  readonly analyzer_version: number;
}

export const PORTAL_ANALYZER_VERSION = 1 as const;

export const LUMIREALM_EXT_KEY = 'lumirealm' as const;
