// Frontend ↔ backend wire types.

import type {
  RealmFrontendToBackend,
  RealmBackendToFrontend,
} from '../realm/messages.js';
import type { DisplaySnapshot } from '../display/snapshot.js';

/** One-entry-per-imported-card summary. Backend composes from `StoredRisuCard`
 *  + `spindle.characters.get` name lookup. UI renders directly. */
export interface CardSummary {
  readonly character_id: string;
  /** `null` when the Lumiverse character row is missing (e.g. deleted before
   *  `CHARACTER_DELETED` was observed). */
  readonly character_name: string | null;
  /** Browser-translated cache (target language). Display-only. */
  readonly translated_character_name?: string;
  readonly translator_version: string;
  readonly uses_lua: boolean;
  readonly stored_at: number;
  /** Last time a chat for this character was opened. Absent = never. */
  readonly last_opened_at?: number;
}

/** Phase is a strict union for reliable UI colour/error styling. */
export interface ImportProgress {
  readonly phase:
    | 'decoding'
    | 'translating'
    | 'awaiting_consent'
    | 'creating_character'
    | 'uploading_assets'
    | 'saving_payload'
    | 'done'
    | 'error';
  readonly message: string;
  /** 0..1 fractional progress, or `null` when indeterminate. */
  readonly fraction: number | null;
}

/** A Lumiverse image we own that no live character or module references.
 *  Cleanup tab shows these for opt-in deletion. */
export interface OrphanAssetEntry {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
  /** Authenticated relative URL for thumbnail rendering. */
  readonly url: string;
  /** Tagged at upload time when known (post 0.4.x). `null` for pre-tag uploads. */
  readonly ownerCharacterId: string | null;
  readonly createdAt: number;
}

export interface RepairScanSummary {
  /** regex_scripts rows whose `metadata._risu.module_id` is not in the live module library. */
  readonly staleModuleRegex: number;
  /** regex_scripts rows whose owning character has no `extensions.lumirealm` blob. */
  readonly staleCharRegex: number;
  /** Image journals (character + module) whose owner is gone. */
  readonly deadJournals: number;
  /** Lumirealm characters that would have their translator_schema_version reset to 0. */
  readonly charactersToRetranslate: number;
  /** (char, module) pairs where the module envelope exists, will detach + reattach. */
  readonly modulesToReattach: number;
  /** (char, module) pairs where the module envelope is missing, will scrub the reference. */
  readonly danglingModuleRefs: number;
  readonly elapsedMs: number;
}

export interface RepairApplyOptions {
  readonly applyStaleModuleRegex: boolean;
  readonly applyStaleCharRegex: boolean;
  readonly applyDeadJournals: boolean;
  readonly applyForceRetranslate: boolean;
}

export interface RepairApplyResult {
  readonly staleModuleRegexDeleted: number;
  readonly staleCharRegexDeleted: number;
  readonly deadJournalsCleared: number;
  readonly charactersRetranslated: number;
  /** Pre-0.3 characters skipped because they have no source for re-translation. */
  readonly charactersSkippedLegacy: number;
  /** (char, module) pairs that were detached + reattached. Only set when applyForceRetranslate is true. */
  readonly modulesReattached: number;
  /** (char, module) pairs where the module envelope was missing, scrubbed. Only set when applyForceRetranslate is true. */
  readonly modulesScrubbed: number;
  readonly elapsedMs: number;
}

export interface PendingRegexScriptMsg {
  readonly name: string;
  readonly script_id: string;
  readonly find_regex: string;
  readonly replace_string: string;
  readonly flags: string;
  readonly placement: readonly string[];
  readonly scope: 'global' | 'character' | 'chat';
  readonly scope_id: string | null;
  readonly target: 'prompt' | 'response' | 'display';
  readonly min_depth: number | null;
  readonly max_depth: number | null;
  readonly trim_strings: readonly string[];
  readonly run_on_edit: boolean;
  readonly substitute_macros: 'none' | 'raw' | 'escaped' | 'after';
  readonly disabled: boolean;
  readonly sort_order: number;
  readonly description: string;
  readonly folder: string;
  readonly metadata: Record<string, unknown>;
}

/** Frontend → Backend. */
export type FrontendToBackend =
  | { type: 'get_cards' }
  | { type: 'display_writeback'; chatId: string; vars: Record<string, string> }
  | { type: 'display_authority'; chatId: string; authoritative: boolean }
  // Card bytes are streamed to the host tus endpoint (resumable, no WS frame
  // cap), then the worker reads them by id via spindle.uploads.
  | { type: 'import_card_from_upload'; uploadId: string; fileName: string }
  // Large lorebook / regex JSON imports upload via the tus endpoint (a single
  // SPINDLE_BACKEND_MSG frame is capped at 4MB and silently dropped past that).
  | {
      type: 'import_text_from_upload';
      uploadId: string;
      kind: 'lorebook' | 'regex';
      filename?: string;
      /** Target character for the import (regex/lorebook scope). */
      characterId: string | null;
    }
  | {
      type: 'consent_response';
      requestId: string;
      confirmed: boolean;
    }
  | { type: 'delete_card'; characterId: string }
  // Mirrors Risu's Chat.svelte click delegation:
  // `runTrigger(char, 'manual', {manualName: attrValue})` → Lua `onButtonClick(triggerId, triggerName)`.
  | {
      type: 'manual_trigger';
      /** Value of the `risu-trigger` attribute on the clicked element. */
      triggerName: string;
      /** Optional `risu-id` attribute (rarely set). */
      triggerId?: string;
      /** Chat the click came from. Must be active-Risu-card. */
      chatId: string;
    }
  // Risu Chat.svelte runLuaButtonTrigger path, separate from runTrigger:
  // iterates every triggerlua trigger, invokes Lua `onButtonClick(id, btn)`.
  | {
      type: 'manual_button_click';
      /** Value of the `risu-btn` attribute on the clicked element. */
      btn: string;
      /** Optional `risu-id` attribute. */
      btnId?: string;
      /** Chat the click came from. Must be active-Risu-card. */
      chatId: string;
    }
  // Cards branch PC vs mobile CSS in bg-html (`{{? {{screen_width}} > 768 }}`).
  // Backend has no viewport; frontend reports once at setup + on debounced resize;
  // backend caches per-user, plumbs into `resolveReadonlyInWorker`.
  // Risu reads window.inner* (cbs.ts).
  | {
      type: 'screen_dims';
      /** `window.innerWidth` at report time. */
      width: number;
      /** `window.innerHeight` at report time. */
      height: number;
    }
  // Backend replies with `set_variables` push. Also fires on every state-tick lifecycle event.
  | {
      type: 'request_variables_snapshot';
      chatId: string;
    }
  // `value` is always a string, Lumi stringifies on write.
  // Lua-state keys (`__name`) need valid JSON from the user; runtime won't re-encode.
  | {
      type: 'set_variable';
      chatId: string;
      scope: 'local';
      key: string;
      value: string;
    }
  | {
      type: 'delete_variable';
      chatId: string;
      scope: 'local';
      key: string;
    }
  // `update_settings` with sanitized patch → persist + echo back `settings_pushed` so all tabs sync.
  // Connection profiles via `request_connections_list` → `connections_list_pushed`;
  // separate because they're a per-user Lumi property, not ours.
  | {
      type: 'request_settings';
    }
  | {
      type: 'update_settings';
      patch: {
        readonly auxConnectionId?: string | null;
        readonly auxModelOverride?: string | null;
        readonly auxSamplers?: AuxSamplersWire;
        // Independent connection/model/sampler trio.
        readonly submodelConnectionId?: string | null;
        readonly submodelModelOverride?: string | null;
        readonly submodelSamplers?: AuxSamplersWire;
        readonly auxPrefillCompat?: boolean;
        readonly submodelPrefillCompat?: boolean;
        readonly auxDebugCaptureRequest?: boolean;
        readonly auxDebugCaptureResponse?: boolean;
        readonly legacyMediaFindings?: boolean;
        readonly translateEnabled?: boolean;
      };
    }
  // Browser-translated cache writeback, one message per scope per language.
  | {
      type: 'cache_module_translation';
      moduleId: string;
      lang: string;
      name?: string;
      description?: string;
      lorebook?: ReadonlyArray<{ readonly sourceHash: string; readonly comment?: string }>;
      toggles?: ReadonlyArray<{ readonly original: string; readonly translated: string }>;
    }
  | {
      type: 'cache_character_translation';
      characterId: string;
      lang: string;
      name?: string;
      lorebook?: ReadonlyArray<{ readonly sourceHash: string; readonly comment?: string }>;
    }
  | {
      type: 'request_connections_list';
    }
  | { type: 'process_module_from_upload'; uploadId: string; fileName: string }
  | { type: 'request_modules' }
  | { type: 'delete_module'; moduleId: string }
  | { type: 'attach_module'; characterId: string; moduleId: string }
  | { type: 'detach_module'; characterId: string; moduleId: string }
  // Full replacement, not a delta: the chip list sends its whole set.
  | { type: 'set_global_modules'; moduleIds: readonly string[] }
  | {
      type: 'request_viewer_data';
      source: { kind: 'character'; characterId: string }
        | { kind: 'module'; moduleId: string };
    }
  // Single envelope write + single viewer re-push regardless of `entries.length`.
  // FE pre-uploads bytes via `/api/v1/images`.
  | {
      type: 'add_assets';
      source: { kind: 'character'; characterId: string }
        | { kind: 'module'; moduleId: string };
      entries: ReadonlyArray<{
        /** Author-cased asset name. CBS macros use it verbatim (`{{img::AssetName}}`). */
        assetName: string;
        /** Lumi image id from `POST /api/v1/images` — FE already uploaded the bytes. */
        imageId: string;
        /** File extension without leading dot (e.g. "png", "mp4"). Drives
         *  `{{asset::NAME}}` video-vs-image branching. */
        ext?: string;
      }>;
    }
  | {
      type: 'rename_asset';
      source: { kind: 'character'; characterId: string }
        | { kind: 'module'; moduleId: string };
      oldName: string;
      newName: string;
    }
  // Single envelope write regardless of `assetNames.length`. Images are reclaimed
  // in the same pass: entries drop from the index first, then a live-ref sweep
  // decides which of their image ids nothing else still points at.
  | {
      type: 'delete_assets';
      source: { kind: 'character'; characterId: string }
        | { kind: 'module'; moduleId: string };
      assetNames: readonly string[];
    }
  // Risu-parity master string for defaults. `null` reverts to the card-side baseline.
  | {
      type: 'set_default_variables_text';
      characterId: string;
      text: string | null;
    }
  // Direct lorebook import. Two modes, controlled by `characterId`:
  //   - `string`: append entries to that character's existing world_book
  //     (create one if absent). Risu's `importLoreBook(mode='global')`
  //     parity. Used by the Viewer tab's per-character import button.
  //   - `null`: standalone import , create a fresh, unattached world_book.
  //     Used by Import → Lorebooks. The user can attach it via Lumiverse
  //     later; Risu decorators (Tier 1/2/3) still apply at runtime if a
  //     Risu-imported character ends up using it.
  | {
      type: 'import_lorebook';
      characterId: string | null;
      /** File contents as UTF-8 string (FE has already read the file). */
      json: string;
      /** Original filename — used as the new world_book name in standalone mode. */
      filename?: string;
    }
  // Risu regex import (Import tab, Regex subtab). `characterId` null/absent →
  // global rules (Risu globalscript parity), a character id → character-scoped.
  | {
      type: 'import_regex';
      /** File contents as UTF-8 string (FE has already read the file). */
      json: string;
      /** Original filename, used as the regex folder name. */
      filename?: string;
      /** `null`/absent → global. A character id → character-scoped install. */
      characterId?: string | null;
    }
  // `triggerIndex` is position in `ViewerData.triggers[]`. Backend replaces all
  // `triggerlua`-typed entries in the trigger's `effect[]` with a single `triggerlua`
  // carrying the new code. Non-lua effects are preserved in order.
  | {
      type: 'set_trigger_lua';
      source: { kind: 'character'; characterId: string }
        | { kind: 'module'; moduleId: string };
      triggerIndex: number;
      lua: string;
    }
  // Empty string OR null clears. Triggers active-card invalidation so next chat-tick repaints.
  | {
      type: 'set_background_html';
      characterId: string;
      html: string | null;
    }
  // Writes env.module.backgroundEmbedding and refreshes every character the module is attached to.
  | {
      type: 'set_module_background_embedding';
      moduleId: string;
      html: string | null;
    }
  // FE executes cookie-auth REST calls to write/delete world_books + regex_scripts
  // (worker can't reach those routes without session cookie). `module_artifacts_installed`
  // carries new resource ids so backend can stash them on user_overrides for clean detach.
  | {
      type: 'module_artifacts_installed';
      characterId: string;
      moduleId: string;
      /** `null` when the module had zero lorebook entries (no book created). */
      worldBookId: string | null;
      /** May be shorter than requested if some scripts were rejected. */
      regexScriptIds: readonly string[];
    }
  | {
      type: 'module_artifacts_uninstalled';
      characterId: string;
      moduleId: string;
      /** True when every targeted artifact was deleted (or already absent; 404 counts as success). */
      ok: boolean;
    }
  // `set_toggle` RMWs `chat.metadata.macro_variables.global["toggle_<key>"]`
  // (Risu storage convention; CBS `{{#when::toggle::X}}` reads here).
  // `value` is the string Risu persists: "1"/"0" for checkboxes, option index for selects,
  // raw text for text/textarea. `null` deletes the key.
  | {
      type: 'request_toggle_definitions';
      chatId: string;
    }
  | {
      type: 'set_toggle';
      chatId: string;
      key: string;
      value: string | null;
    }
  // Sent after FE finishes canvas-rasterizing each non-templated SVG (from a
  // `rasterize_svgs` push) and POSTing each PNG to /api/v1/images. Maps marker
  // index to image_id so backend can substitute `<img data-lumirealm-svg-pending="N">`.
  // Failed rasters report `null`. Backend leaves no src and sanitizer passes through.
  // See `src/core/svg-rasterize.ts` for the full rasterization spec.
  | {
      type: 'register_svg_raster_index';
      characterId: string;
      /** markerN (string-keyed for JSON portability) → Lumi image_id (or null on failure). */
      imageIdByMarker: Readonly<Record<string, string | null>>;
    }
  | { type: 'request_orphan_scan' }
  | { type: 'delete_orphan_assets'; imageIds: readonly string[] }
  | { type: 'request_repair_scan' }
  | { type: 'apply_repair'; options: RepairApplyOptions }
  | { type: 'log_request_state' }
  | {
      type: 'log_set_state';
      enabled: boolean;
      includeChatData: boolean;
      level?: LogLevelWire;
    }
  | { type: 'log_request_export' }
  | { type: 'log_clear' }
  | { type: 'alert_dismissed'; requestId: string }
  | { type: 'pick_resolved'; requestId: string; value: string | null }
  | RealmFrontendToBackend;

/** Backend → Frontend. */
export type BackendToFrontend =
  | { type: 'cards_updated'; cards: readonly CardSummary[] }
  | {
      type: 'import_progress';
      phase: ImportProgress['phase'];
      message: string;
      /** 0..1 fractional progress or null when indeterminate. */
      fraction: number | null;
      /** Filled on phase === 'done'. */
      characterId?: string;
      /** Filled on phase === 'error'. */
      error?: string;
    }
  | {
      type: 'consent_prompt';
      requestId: string;
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
    }
  // FE POSTs to `/api/v1/regex-scripts/import` (accepts `{scripts:[...]}` or bare array).
  // Only FE has the session cookie. Failures surface as warnings in the drawer status panel.
  | {
      type: 'install_regex_scripts';
      characterId: string;
      characterName: string;
      scripts: readonly PendingRegexScriptMsg[];
    }
  // Result of a regex import. FE POSTs `scripts` to
  // `/api/v1/regex-scripts/import` (only FE has the cookie) and reports the count.
  | {
      type: 'standalone_regex_install';
      ok: boolean;
      scripts: readonly PendingRegexScriptMsg[];
      /** customScripts seen in the file. */
      parsed: number;
      /** Rules dropped (invalid shape, or runtime-only @@emo/@@repeat_back). */
      dropped: number;
      /** Folder the rules are grouped under (source filename stem). */
      folder: string;
      /** `null` for global, else the target character (for status + cascade). */
      characterId: string | null;
      reason?: string;
    }
  // Lazy-migration trigger for legacy cards imported before raw-source storage.
  // Translator changes can't auto-apply without source, FE shows a one-time toast.
  | {
      type: 'notify_legacy_card_needs_reimport';
      characterId: string;
      characterName: string;
    }
  // Host running an older Lumiverse than `spindle.json minimum_lumiverse_version`.
  // FE shows a one-time-per-mount modal nag.
  | {
      type: 'notify_host_version_outdated';
      hostVersion: string | null;
      minimum: string;
      message: string;
    }
  // Manifest declares required permissions the host has not granted.
  // FE shows a one-time-per-mount modal nag.
  | {
      type: 'notify_missing_permissions';
      missing: readonly string[];
      purposes: Readonly<Record<string, string>>;
    }
  // Inbound phoneline dial failed the host inheritance check. Driven by
  // observed dial outcomes, not declared-perm state. FE shows a dismissible
  // banner. `forCaller` names the calling extension whose bridge is failing.
  | {
      type: 'notify_bridge_status';
      offline: boolean;
      missingPermissions: readonly string[];
      forCaller?: string;
    }
  // `risuPayload.background_html` resolved per state tick. FE pipes through Risu-compat
  // rewriter (HTML class prefix + CSS `.chattext` scope + `:host` universals) and paints
  // into a Shadow-DOM host.
  | {
      type: 'render_bg_html';
      chatId: string;
      bgHtml: string;
      crossRuleStyles?: readonly string[];
    }
  | {
      type: 'clear_bg_html';
      chatId: string;
    }
  // chatId non-null iff the chat has lumirealm data. Decoupled from
  // render_bg_html so empty-bg cards still activate.
  | {
      type: 'set_active_chat';
      chatId: string | null;
      /** Character owning the active chat (lumirealm characters only). `null`
       *  when chatId is null OR the chat belongs to a non-lumirealm character. */
      characterId?: string | null;
    }
  // Pushed on every state-tick. `defaults` is character-level `defaultVariables`
  // (Risu's `getChatVar` fallback when key unset).
  // Full display-resolution snapshot for the FE engine (P2). Pushed at chat-open
  // and on state-tick events. Carries everything runPipeline needs minus the
  // per-message template and dynamic chat_index/role.
  | {
      type: 'display_snapshot';
      snapshot: DisplaySnapshot;
    }
  // `seq` is monotonic per-chat; pushes only when snapshot changes (or on explicit request).
  | {
      type: 'set_variables';
      chatId: string;
      seq: number;
      scopes: VariableScopes;
      /** Character-level `defaultVariables` — EFFECTIVE values (card defaults
       *  with `user_overrides.default_variables_overrides` applied on top).
       *  Risu's getChatVar consults these on miss before returning "null". */
      defaults: Readonly<Record<string, string>>;
      /** Card-side raw defaults BEFORE overrides applied. Lets the FE detect
       *  which entries are overridden (`overridden = defaults[k] !== defaultsCardSide[k]`)
       *  AND surface "Reset to card default" affordance with the original
       *  value. Per-character; same value across all chats with this character. */
      defaultsCardSide?: Readonly<Record<string, string>>;
      /** Character that owns this chat — needed by the FE to address
       *  `set_default_variable`/`delete_default_variable` for the right card.
       *  `null` for non-Risu chats. */
      characterId?: string | null;
      /** ms-since-epoch when assembled, for "Last update" UX. */
      ts: number;
    }
  | {
      type: 'settings_pushed';
      settings: {
        readonly schema_version: 1;
        readonly auxConnectionId: string | null;
        readonly auxModelOverride: string | null;
        readonly auxSamplers: AuxSamplersWire;
        readonly submodelConnectionId: string | null;
        readonly submodelModelOverride: string | null;
        readonly submodelSamplers: AuxSamplersWire;
        readonly auxPrefillCompat: boolean;
        readonly submodelPrefillCompat: boolean;
        readonly auxDebugCaptureRequest: boolean;
        readonly auxDebugCaptureResponse: boolean;
        readonly legacyMediaFindings: boolean;
        readonly translateEnabled: boolean;
      };
    }
  // Emitted when the user enables request/response capture toggles in Settings → Debug.
  // Gated server-side by the two boolean flags in `RisuCompatSettings`. Captures
  // BOTH aux (`axLLMMain`/`LLMMain`) and submodel (V2 `runLLM(model='submodel')`)
  // calls; `channel` distinguishes them.
  | {
      type: 'aux_debug_capture';
      /** Server-monotonic; unique per worker boot, used as React key / dedup id. */
      id: number;
      /** ms-since-epoch when generated. */
      ts: number;
      kind: 'request' | 'response' | 'error';
      /** Which LLM channel fired this. `aux` = `axLLMMain`/`axLLM`/`LLMMain`;
       *  `submodel` = V2 `runLLM(model='submodel')`. Optional for back-compat
       *  with older bundles , absent values default to `'aux'` in the panel. */
      channel?: 'aux' | 'submodel';
      /** `null` for manual-trigger paths invoked outside chat context. */
      chatId: string | null;
      /** Resolved connection UUID at dispatch time (aux or submodel per `channel`),
       *  or `null` for "use user's default". */
      auxConnectionId: string | null;
      /** `null` for "use connection's own model". */
      auxModelOverride: string | null;
      /** `null` for `kind:'request'` (call hasn't completed). Milliseconds. */
      elapsedMs: number | null;
      payload: unknown;
    }
  | {
      type: 'connections_list_pushed';
      connections: readonly {
        readonly id: string;
        readonly name: string;
        readonly provider: string;
        readonly model: string;
        readonly is_default: boolean;
      }[];
    }
  // `modules_pushed` is the full library + per-character attachment map.
  // `attached_modules_pushed` is a per-character delta after attach/detach.
  | {
      type: 'modules_pushed';
      modules: readonly ModuleSummary[];
      attached_by_character?: Readonly<Record<string, readonly AttachedModuleSummary[]>>;
      /** Applied to every character on top of its own attachments. */
      global_module_ids?: readonly string[];
    }
  | {
      type: 'attached_modules_pushed';
      characterId: string;
      attached: readonly AttachedModuleSummary[];
    }
  // `source.kind === 'character'` carries id+name; `'module'` carries id+display name.
  // Lorebook for characters is grouped by world_book; for modules it's a flat list.
  | {
      type: 'viewer_data_pushed';
      data: ViewerData;
    }
  | {
      type: 'lorebook_import_result';
      /** `null` for standalone imports (Import → Lorebooks). */
      characterId: string | null;
      ok: boolean;
      /** Number of entries actually written (0 on failure). */
      written: number;
      /** Number of entries the parser saw but dropped (bad shape, etc.). */
      dropped: number;
      /** New world_book uuid (standalone) or character's existing book id. */
      worldBookId?: string;
      /** Display name of the world_book (for status messages). */
      worldBookName?: string;
      reason?: string;
    }
  | {
      type: 'cleanup_character_artifacts';
      characterId: string;
      worldBookIds: readonly string[];
    }
  // FE executes cookie-auth REST POSTs for world_book + regex_scripts payloads.
  // On completion FE replies with `module_artifacts_installed` carrying new resource ids;
  // backend stashes them on `user_overrides` so detach can find them.
  // `lorebookEntries` mirrors `/api/v1/world-books/:id/entries/import` schema.
  | {
      type: 'install_module_artifacts';
      characterId: string;
      moduleId: string;
      /** FE only creates a world_book when `lorebookEntries.length > 0`. */
      worldBookName: string;
      lorebookEntries: readonly ModuleLorebookEntry[];
      regexScripts: readonly PendingRegexScriptMsg[];
    }
  | {
      type: 'uninstall_module_artifacts';
      characterId: string;
      moduleId: string;
      worldBookId: string | null;
      regexScriptIds: readonly string[];
    }
  // Pushed on chat open / card change / module attach-detach / re-import.
  // Structure only. Values flow through the variables channel (`toggle_<key>` in global scope).
  | {
      type: 'set_toggle_definitions';
      chatId: string;
      seq: number;
      /** Flat parsed toggles in DSL order, including group/groupEnd/divider/caption markers. */
      toggles: readonly SidebarToggleWire[];
      /** key → contributing module attribution. `translatedName` present when envelope cache hit. */
      attribution: Readonly<Record<string, AttributionWire>>;
      /** ms-since-epoch when assembled. */
      ts: number;
    }
  | { type: 'error'; message: string; sessionId?: string }
  // Sent at import time when the translated card has non-templated inline SVGs to rasterize.
  // FE canvas-rasterizes each (with theme-color injection for `theme-reactive` ones),
  // POSTs each PNG to `/api/v1/images`, and replies with `register_svg_raster_index`.
  // `phase=done` is deferred until the round-trip completes.
  // Templated SVGs are NOT in this list. Left inline, sanitizer-stripped at render.
  | {
      type: 'rasterize_svgs';
      characterId: string;
      characterName: string;
      svgs: readonly {
        readonly markerN: number;
        readonly svg: string;
        readonly classification: 'simple' | 'theme-reactive' | 'animated';
        readonly width: number;
        readonly height: number;
      }[];
    }
  | { type: 'open_settings_cleanup' }
  | {
      /** Loading-bar overlay for non-import operations (deletes, cleanup).
       *  Same UI shape as `import_progress`, just a different lifecycle. */
      type: 'operation_progress';
      operationId: string;
      phase: 'started' | 'progress' | 'done' | 'error';
      title: string;
      message: string;
      /** 0..1 fraction or null for indeterminate. */
      fraction: number | null;
      error?: string;
    }
  | { type: 'orphan_scan_started' }
  | {
      type: 'orphan_scan_result';
      /** First N orphans (newest first) when total exceeds the per-frame cap.
       *  Full count is `summary.totalOrphans`. */
      orphans: readonly OrphanAssetEntry[];
      summary: {
        readonly scannedTotal: number;
        readonly liveCharacterRefs: number;
        readonly liveModuleRefs: number;
        readonly liveJournalRefs: number;
        readonly charactersScanned: number;
        readonly modulesScanned: number;
        readonly elapsedMs: number;
        /** Total orphan count (may exceed `orphans.length` when truncated). */
        readonly totalOrphans: number;
        /** True when `orphans.length < totalOrphans`. UI should advise the
         *  user to delete the shown batch then re-scan to see the rest. */
        readonly truncated: boolean;
        /** Module regex rows whose envelope is gone, swept inline by the scan. */
        readonly orphanRegexCleaned?: number;
      };
      error?: string;
    }
  | {
      type: 'orphan_delete_result';
      requested: number;
      deleted: number;
      absent: number;
      failed: number;
      /** IDs that became live (referenced by a live character/module/journal)
       *  between scan and delete. Skipped to protect mid-import uploads. */
      skipped: number;
      /** Subset of `requested` that the BE skipped, so the FE keeps these in
       *  the orphan list. Empty when `skipped === 0`. */
      skippedIds: readonly string[];
      error?: string;
    }
  | {
      type: 'repair_scan_result';
      summary: RepairScanSummary;
      error?: string;
    }
  | {
      type: 'repair_apply_result';
      result: RepairApplyResult;
      error?: string;
    }
  | {
      type: 'log_state_pushed';
      enabled: boolean;
      includeChatData: boolean;
      level?: LogLevelWire;
      eventCount: number;
      bufferBytes: number;
    }
  | {
      type: 'log_export_pushed';
      events: readonly LogEventWire[];
      session: {
        readonly extensionVersion: string;
        readonly userId: string | null;
        readonly activeChatId: string | null;
        readonly activeCharacterId: string | null;
      };
    }
  | {
      type: 'request_alert';
      requestId: string;
      message: string;
      kind?: 'info' | 'error';
    }
  | {
      type: 'request_pick';
      requestId: string;
      title: string;
      options: readonly string[];
    }
  | RealmBackendToFrontend;

export interface LogEventWire {
  readonly ts: number;
  readonly level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly category: string;
  readonly message: string;
}

export type LogLevelWire = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Wire shape for one parsed toggle row. Mirrors `SidebarToggle` from
 *  `src/core/toggle-syntax.ts`, duplicated here to avoid a dep on `core/`. */
/** Per-toggle-key attribution: which module contributed this toggle. */
export interface AttributionWire {
  readonly name: string;
  readonly translatedName?: string;
  readonly moduleId: string;
}

export type SidebarToggleWire =
  | {
      readonly type: 'group';
      readonly key?: string;
      readonly value?: string;
      readonly translatedValue?: string;
      readonly moduleId?: string;
    }
  | {
      readonly type: 'groupEnd';
      readonly key?: string;
      readonly value?: string;
      readonly translatedValue?: string;
      readonly moduleId?: string;
    }
  | {
      readonly type: 'caption';
      readonly key?: string;
      readonly value: string;
      readonly translatedValue?: string;
      readonly moduleId?: string;
    }
  | {
      readonly type: 'divider';
      readonly key?: string;
      readonly value?: string;
      readonly translatedValue?: string;
      readonly moduleId?: string;
    }
  | {
      readonly type: 'select';
      readonly key: string;
      readonly value: string;
      readonly translatedValue?: string;
      readonly options: readonly string[];
      /** Partial map keyed by ORIGINAL option text. Missing entries fall back to original. */
      readonly translatedOptionsByOriginal?: Readonly<Record<string, string>>;
      readonly moduleId?: string;
    }
  | {
      readonly type: 'text' | 'textarea' | 'checkbox';
      readonly key: string;
      readonly value: string;
      readonly translatedValue?: string;
      readonly options?: readonly string[];
      readonly moduleId?: string;
    };

export interface AuxSamplersWire {
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

export interface VariableScopes {
  readonly local: Readonly<Record<string, string>>;
  readonly global: Readonly<Record<string, string>>;
  readonly chat: Readonly<Record<string, string>>;
}

export interface ModuleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Browser-translated cache (target language). Display-only. */
  readonly translatedName?: string;
  readonly translatedDescription?: string;
  readonly filename: string;
  readonly uploaded_at: number;
  readonly lorebook_count: number;
  readonly regex_count: number;
  readonly trigger_count: number;
  readonly asset_count: number;
  /** True if module declares `lowLevelAccess: true`. UI shows a badge. */
  readonly low_level_access: boolean;
  /** True if module has a `cjs` script body (Risu's CommonJS per-module hook). We don't run cjs; surfaces as degraded warning. */
  readonly has_cjs: boolean;
}

export interface ViewerData {
  readonly source:
    | { readonly kind: 'character'; readonly characterId: string; readonly name: string }
    | { readonly kind: 'module'; readonly moduleId: string; readonly name: string };
  readonly lorebook: readonly ViewerLorebookGroup[];
  /** Module-only: characters' regex lives in Lumi's `regex_scripts` table (native UI).
   *  Modules expose regex here for pre-attach inspection. */
  readonly regex: readonly ViewerRegexEntry[];
  /** Both kinds: triggers have no Lumi native UI. */
  readonly triggers: readonly ViewerTriggerEntry[];
  /** Both kinds: assets have no Lumi native viewer. */
  readonly assets: readonly ViewerAssetEntry[];
  /** Module-only (`module.cjs`); always `null` for characters. */
  readonly cjs: string | null;
  readonly backgroundHtml: string | null;
  /** Character-only Risu-parity master string ("name=value" lines).
   *  Module shape emits "". */
  readonly defaultVariablesText: string;
  /** True when the master string is a user edit, false when it reflects the
   *  card-side baseline. Drives the revert affordance. */
  readonly defaultVariablesUserEdited: boolean;
  /** ms-since-epoch when assembled, for "Last refreshed" UX. */
  readonly ts: number;
  /** Fetch issues / cross-tab routing notes for a banner. */
  readonly fetchWarnings: readonly string[];
  /** True when envelope.source is missing (pre-0.3.0 import). The Risu-faithful
   *  lorebook viewer can't render order-correctly without source-backed v6
   *  backfill, so the FE surfaces a re-import notice instead. */
  readonly lorebookNeedsReimport?: boolean;
  /** Character-only `creator_notes`, rendered in the Overview tab. */
  readonly creatorNotes?: string;
}

export interface ViewerLorebookGroup {
  /** character: world_book name; module: module name. */
  readonly groupName: string;
  /** Browser-translated cache (target language) at assemble time.
   *  FE prefers a fresh lookup against current modules[]/cards[] state. */
  readonly translatedGroupName?: string;
  /** world_book uuid for characters, literal "module" for modules. */
  readonly groupId: string;
  /** Set when this group's lore came from a module: the attached-module's
   *  envelope id (character source) or the source module itself (module source).
   *  Lets the FE substitute the latest cached translatedName at render time. */
  readonly moduleId?: string;
  readonly entries: readonly ViewerLorebookEntry[];
}

export interface ViewerLorebookEntry {
  readonly key: readonly string[];
  readonly content: string;
  readonly comment?: string;
  readonly disabled?: boolean;
  readonly constant?: boolean;
  /** Lumi entry uuid for characters, array index for modules. */
  readonly id: string;
  /** Risu source array position. Null when user-added or pre-v6 entry. */
  readonly arrayIndex?: number | null;
  /** Lumi `order_value`, tiebreak when arrayIndex is null. */
  readonly orderValue?: number;
  /** Lumi entry priority. */
  readonly priority?: number;
  /** Position enum 0..6 (before_char, after_char, depth-injected, etc.). */
  readonly position?: number;
  /** Depth for position=4 entries. */
  readonly depth?: number;
  /** True when extensions._risu_source_hash exists. False means user-added. */
  readonly fromRisu?: boolean;
  /** Risu's `mode` field. Folders render as headers, others as entries. */
  readonly risuMode?: string;
  /** For folder rows, Risu's folder identifier (matches children's risuFolderRef). */
  readonly risuFolderKey?: string;
  /** For child entries, the parent folder's key (matches a folder row's risuFolderKey). */
  readonly risuFolderRef?: string;
  /** Browser-translated comment (target language). Display-only. */
  readonly translatedComment?: string;
  /** Source hash that the translation cache uses to address this entry. */
  readonly sourceHash?: string;
}

export interface ViewerRegexEntry {
  readonly id: string;
  readonly name: string;
  readonly find: string;
  readonly replace: string;
  /** "ai_output", "user_input", etc. , joined when multiple. */
  readonly placement: string;
  readonly target: string;
  readonly disabled: boolean;
  /** Non-null for module-sourced rules pushed into Lumi's table at attach time. */
  readonly moduleId: string | null;
  /** Risu authors use rules with empty `in` as section headers, render as a
   *  divider row. Find/replace are empty for dividers. */
  readonly divider?: boolean;
}

export interface ViewerTriggerEntry {
  readonly id: string;
  /** Author display name (Risu's `comment` field, else "trigger #N"). */
  readonly name: string;
  readonly bindingType: string;
  /** First-effect's `triggerlua.code` if present, else null. */
  readonly lua: string | null;
  readonly effectCount: number;
  /** One-line summaries for non-`triggerlua` effects (lua is surfaced via `lua`). */
  readonly effects: readonly ViewerTriggerEffectSummary[];
}

export interface ViewerTriggerEffectSummary {
  readonly type: string;
  readonly indent: number;
  readonly summary: string;
}

export interface ViewerAssetEntry {
  readonly name: string;
  /** Lumi `/api/v1/images/<id>` URL ready for `<img src>`. Points at the first image id
   *  when multi-source (Risu's getAssetSrc semantics). */
  readonly url: string;
  readonly multi: boolean;
  /** Original ext if known — drives video-vs-image branching. */
  readonly ext?: string;
}

export interface ModuleLorebookEntry {
  readonly key: readonly string[];
  readonly content: string;
  readonly comment?: string;
  readonly constant?: boolean;
  readonly disabled?: boolean;
  readonly position?: string;
  readonly priority?: number;
  readonly order?: number;
  readonly secondary_keys?: readonly string[];
  readonly selective?: boolean;
  /** Carries module id for future cleanup of module-sourced entries. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Subset of `ModuleSummary` sufficient to render the per-character attached list. */
export interface AttachedModuleSummary {
  readonly id: string;
  readonly name: string;
  /** Browser-translated cache (target language). Display-only. */
  readonly translatedName?: string;
}

