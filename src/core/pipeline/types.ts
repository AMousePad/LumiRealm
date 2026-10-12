import type { LumiCharacter, LumiRegexScript, LumiWorldBook, LumiWorldBookEntry } from "../lumiverse/types.js";
import type { RisuPayload } from "../payload/types.js";
import type { SvgRasterTask } from "../svg-rasterize.js";

export interface LumiBundle {
  readonly character: LumiCharacter;
  readonly worldBook: LumiWorldBook | null;
  readonly worldBookEntries: readonly LumiWorldBookEntry[];
  readonly regexScripts: readonly LumiRegexScript[];
  readonly risuPayload: RisuPayload | null;
  readonly assets: ReadonlyMap<string, Uint8Array>;
  /**
   * Canonical avatar bytes from the source bundle when the format provides one
   * unambiguously (JPEG preview from .charx polyglot; the source PNG itself
   * for PNG cards). When set, importCard's pickAvatar prefers this over
   * scanning the asset map. Avoids picking a random sprite as the avatar.
   */
  readonly preferredAvatar: { readonly data: Uint8Array; readonly mime: string; readonly filename: string } | null;
  readonly pendingSvgRasters: readonly SvgRasterTask[];
  /** Aggregate counts from per-entry decorator parsing. Importer logs once
   *  per import (only when `decorators_seen > 0`). */
  readonly decoratorStats: {
    readonly entries_with_decorators: number;
    readonly decorators_seen: number;
    readonly mapped: number;
    readonly stashed: number;
    readonly dropped: number;
  };
  readonly manifest: TranslationManifest;
}

export interface TranslationManifest {
  readonly translator: { readonly name: "LumiRealm"; readonly version: string };
  readonly source: {
    readonly spec: string;
    readonly spec_version: string;
    readonly sourceId: string | null;
    readonly isPolyglot: boolean;
  };
  readonly translated_at: number;
  readonly issues: readonly { path: string; message: string }[];
  readonly untranslated: UntranslatedSummary;
  readonly counts: {
    readonly lorebook_entries: number;
    readonly assets: number;
    readonly oversized_entries: number;
    readonly unsafe_entries: number;
  };
  readonly requires?: {
    readonly lowLevelAccess: boolean;
    readonly hostFeatures: readonly string[];
    readonly lua: boolean;
  };
}

export interface UntranslatedSummary {
  readonly module_regex: number;
  readonly module_triggers: number;
  readonly character_level_regex: number;
  readonly character_level_triggers: number;
  readonly virtualscript: boolean;
  readonly default_variables: boolean;
  readonly background_html: boolean;
  readonly background_embedding: boolean;
  readonly module_cjs: boolean;
  readonly macros_in_text: boolean;
  readonly regex_unknown_types?: number;
  readonly at_actions?: number;
  readonly opcode_unimplemented?: Readonly<Record<string, number>>;
  readonly utility_bot?: boolean;
  readonly additional_text?: boolean;
  readonly svg_rasterized?: number;
  readonly svg_color_frozen?: number;
  readonly svg_motion_frozen?: number;
  readonly svg_templated_stripped?: number;
  readonly svg_dangerous_stripped?: number;
  readonly mcp?: boolean;
}
