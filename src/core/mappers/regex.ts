import type { CustomScript } from "../schemas/customscript.js";
import type {
  LumiRegexScript,
  LumiRegexPlacement,
  LumiRegexTarget,
  LumiRegexMacroMode,
  LumiRegexScope,
} from "../lumiverse/types.js";
import { wrapIslandMergeIfNeeded, wrapForIslandTriggerIfNeeded } from "./island-merge.js";
import { newUuid, nowMs } from "./util.js";
import { normalizeReplaceStringForSanitizer } from "../../util/sanitizer-doc-shape.js";
import { applyIframePolicy } from "./iframe-policy.js";
import { unprefixHtmlClasses, normalizeIncompleteHtmlEntities, unprefixCssInStyleBlocks } from "../../bghtml/rewriter.js";


// Risu scripts.ts+
const AT_ACTION_PREFIXES = [
  "@@emo",
  "@@inject",
  "@@move_top",
  "@@move_bottom",
  "@@repeat_back",
] as const;

// Risu scripts.ts
const ALLOWED_FLAG_LETTERS = "dgimsuvy";

/** Set on scripts our exporter emitted with the live, already-rewritten replace
 *  string. Survives a Risu round trip because Risu stores customscript objects
 *  wholesale. */
export const TRANSFORMED_FLAG = "lumirealm_transformed";

export interface AtAtAction {
  readonly index: number;
  readonly action: "emo" | "inject" | "move_top" | "move_bottom" | "repeat_back";
  readonly script: CustomScript;
  readonly flag: string;
  readonly phase: string;
  readonly actions: readonly string[];
  readonly order: number;
}

export interface MapRegexOptions {
  readonly characterId: string;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly userId?: string;
  readonly origin?: "character" | "module";
  // "global" makes rules apply across every chat (Risu globalscript parity),
  // used by standalone regex import. Defaults to "character".
  readonly scope?: LumiRegexScope;
  // scope_id for emitted rows, `null` for global scope. Defaults to characterId.
  readonly scopeId?: string | null;
  // Lumi regex folder for grouping in the UI. Defaults to "".
  readonly folder?: string;
}

export interface MapRegexResult {
  readonly rows: readonly LumiRegexScript[];
  readonly skipped: readonly AtAtAction[];
  readonly issues: readonly { path: string; message: string }[];
}

export type RegexMatchAction =
  | "move_top"
  | "move_bottom"
  | "repeat_back";

export function getRegexMatchActions(
  directAction: AtAtAction["action"] | null,
  flagActions: readonly string[],
): readonly RegexMatchAction[] {
  const actions: RegexMatchAction[] = [];
  if (directAction === "move_top" || flagActions.includes("move_top")) {
    actions.push("move_top");
  }
  if (directAction === "move_bottom" || flagActions.includes("move_bottom")) {
    actions.push("move_bottom");
  }
  if (directAction === "repeat_back" || flagActions.includes("repeat_back")) {
    actions.push("repeat_back");
  }
  return actions;
}

export function needsAtActionRuntime(
  directAction: AtAtAction["action"] | null,
  flagActions: readonly string[],
): boolean {
  return directAction === "emo"
    || directAction === "inject"
    || flagActions.includes("inject");
}

export function normalizeMatchActionDisplayReplaceString(
  replaceString: string,
  matchActions: readonly RegexMatchAction[],
  directAction: AtAtAction["action"] | null,
  preTransformed = false,
): string {
  const moves = matchActions.includes("move_top")
    || matchActions.includes("move_bottom");
  const normalized = directAction === "move_top"
    ? replaceString.replace("@@move_top ", "")
    : directAction === "move_bottom"
      ? replaceString.replace("@@move_bottom ", "")
      : replaceString;
  return normalizeDisplayReplaceString(normalized, {
    action: moves,
    preTransformed,
  });
}

// Keep every Risu display-regex source on one Lumiverse renderer adaptation.
export function normalizeDisplayReplaceString(
  replaceString: string,
  options: {
    readonly action?: boolean;
    readonly preTransformed?: boolean;
  } = {},
): string {
  const action = options.action === true;
  const preTransformed = options.preTransformed === true;
  let normalized = replaceString;
  if (!preTransformed && !action) {
    normalized = wrapIslandMergeIfNeeded(normalized);
  }
  if (!preTransformed) {
    normalized = applyIframePolicy(normalized).html;
  }
  if (!preTransformed && !action) {
    normalized = wrapForIslandTriggerIfNeeded(normalized);
  }
  normalized = normalizeReplaceStringForSanitizer(normalized);
  if (!preTransformed && normalized.length > 0) {
    normalized = unprefixHtmlClasses(normalized);
    normalized = unprefixCssInStyleBlocks(normalized);
    normalized = normalizeIncompleteHtmlEntities(normalized);
  }
  return normalized;
}

export function mapRegex(
  scripts: readonly CustomScript[],
  opts: MapRegexOptions,
): MapRegexResult {
  const now = (opts.now ?? nowMs)();
  const uuid = opts.uuid ?? newUuid;
  const origin = opts.origin ?? "character";
  const scope: LumiRegexScope = opts.scope ?? "character";
  const scopeId = opts.scopeId !== undefined ? opts.scopeId : opts.characterId;
  const folder = opts.folder ?? "";

  const rows: LumiRegexScript[] = [];
  const skipped: AtAtAction[] = [];
  const issues: { path: string; message: string }[] = [];

  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]!;
    const path = `${origin === "character" ? "customscript" : "module.regex"}[${i}]`;

    if (typeof s.in !== "string" || s.in.length === 0) {
      const dividerLabel = typeof s.comment === "string" ? s.comment : "";
      if (dividerLabel.length === 0) {
        issues.push({ path, message: "empty `in` and `comment`, skipped" });
        continue;
      }
      const id = opts.uuid ? opts.uuid() : newUuid();
      rows.push({
        id,
        user_id: opts.userId ?? "",
        name: dividerLabel,
        script_id: opts.uuid ? opts.uuid() : newUuid(),
        find_regex: "(?!)",
        replace_string: "",
        flags: "g",
        placement: ["ai_output"] as LumiRegexPlacement[],
        scope,
        scope_id: scopeId,
        target: "display",
        min_depth: null,
        max_depth: null,
        trim_strings: [],
        run_on_edit: false,
        substitute_macros: "none",
        disabled: true,
        sort_order: i * 10,
        description: dividerLabel,
        folder,
        pack_id: null,
        metadata: { _risu: { phase: s.type, origin, order_index: i, source_type: "divider" } },
        created_at: now,
        updated_at: now,
      });
      continue;
    }
    if (typeof s.out !== "string") {
      issues.push({ path, message: "non-string `out` field, skipped" });
      continue;
    }

    const phase = RISU_PHASE_MAP[s.type];
    if (!phase) {
      issues.push({
        path,
        message: `unknown Risu regex phase \`${s.type}\`, entry preserved as disabled display-target`,
      });
    }
    const effectivePhase = phase ?? UNKNOWN_PHASE_FALLBACK;

    const normalised = normaliseRisuFlag(s.flag, !!s.ableFlag);
    const hasNoEndNl = normalised.actions.includes("no_end_nl");
    // Risu sorts <order N> descending, Lumi reads sort_order ASC: negate.
    const baseSortOrder = i * 10 - (normalised.order ?? 0) * 100000;

    const outNormalised = s.out.replaceAll("$n", "\n");
    const action = detectAtAction(outNormalised);
    if (needsAtActionRuntime(action, normalised.actions)) {
      skipped.push({
        index: i,
        action: action === "emo" ? "emo" : "inject",
        script: s,
        flag: normalised.flag,
        phase: s.type,
        actions: normalised.actions,
        order: normalised.order ?? i,
      });
      continue;
    }
    const matchActions = getRegexMatchActions(action, normalised.actions);
    const movesMatch = matchActions.includes("move_top")
      || matchActions.includes("move_bottom");

    const findPattern = String(s.in ?? "");
    // Risu resolves IN only when the explicit <cbs> modifier is present.
    const findHasCbs = findPattern.indexOf("{{") >= 0;
    const resolveFindCbs = normalised.actions.includes("cbs");
    let baseFlags = findHasCbs && resolveFindCbs
      ? normalised.flag.replace(/u/g, "")
      : normalised.flag;
    if (movesMatch) {
      baseFlags = baseFlags.replace(/g/g, "");
    }
    if (baseFlags.length === 0) baseFlags = "u";

    let baseReplace = outNormalised;
    if (baseReplace.endsWith(">") && !hasNoEndNl) baseReplace += "\n";
    const repeatPosition = matchActions.includes("repeat_back")
      ? baseReplace.split(" ", 2)[1]
      : undefined;
    // Rows our exporter emitted already carry the display rewrites. Re-applying
    // them double-wraps on every export/import cycle, so the transform is made
    // idempotent by skipping content that has already been through it.
    const preTransformed = (s as unknown as Record<string, unknown>)[TRANSFORMED_FLAG] === true;
    baseReplace = effectivePhase.target === "display"
      ? normalizeMatchActionDisplayReplaceString(
          baseReplace,
          matchActions,
          action,
          preTransformed,
        )
      : normalizeReplaceStringForSanitizer(
          action === "move_top"
            ? baseReplace.replace("@@move_top ", "")
            : action === "move_bottom"
              ? baseReplace.replace("@@move_bottom ", "")
              : baseReplace,
        );

    const baseSubstitute: LumiRegexMacroMode = movesMatch
      ? "none"
      : pickSubstituteMacroMode(baseReplace, false);
    const substituteMacros: LumiRegexMacroMode =
      resolveFindCbs && baseSubstitute === "none"
        ? "find"
        : baseSubstitute;
    const baseName = nonEmpty(s.comment, `risu_${effectivePhase.target}_${i}`);
    const baseDescription = s.comment ?? "";
    const baseMetadata: Record<string, unknown> = {
      _risu: {
        phase: s.type,
        origin,
        order_index: i,
        has_meta: normalised.actions.length > 0,
        ...(normalised.order !== undefined ? { order_flag: normalised.order } : {}),
        ...(action ? { at_action: action } : {}),
        ...(normalised.actions.length > 0 ? { flag_actions: normalised.actions } : {}),
      },
      ...(matchActions.length > 0 ? { match_actions: matchActions } : {}),
      ...(repeatPosition !== undefined ? { repeat_position: repeatPosition } : {}),
    };

    const buildRow = (overrides: {
      readonly id: string;
      readonly script_id: string;
      readonly name?: string;
      readonly find: string;
      readonly replace: string;
      readonly flags?: string;
      readonly placement?: readonly LumiRegexPlacement[];
      readonly target?: LumiRegexTarget;
      readonly maxDepth?: number | null;
      readonly sortOrder: number;
      readonly substituteMacros?: LumiRegexMacroMode;
    }): LumiRegexScript => ({
      id: overrides.id,
      user_id: opts.userId ?? "",
      name: overrides.name ?? baseName,
      script_id: overrides.script_id,
      find_regex: overrides.find,
      replace_string: overrides.replace,
      flags: overrides.flags ?? baseFlags,
      placement: (overrides.placement ?? effectivePhase.placement) as LumiRegexPlacement[],
      scope,
      scope_id: scopeId,
      target: overrides.target ?? effectivePhase.target,
      min_depth: null,
      max_depth: overrides.maxDepth !== undefined ? overrides.maxDepth : (effectivePhase.maxDepth ?? null),
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: overrides.substituteMacros ?? substituteMacros,
      disabled: effectivePhase.disabled,
      sort_order: overrides.sortOrder,
      description: baseDescription,
      folder,
      pack_id: null,
      metadata: baseMetadata,
      created_at: now,
      updated_at: now,
    });

    rows.push(buildRow({
      id: uuid(),
      script_id: uuid(),
      find: findPattern,
      replace: baseReplace,
      sortOrder: baseSortOrder,
    }));
  }

  return { rows, skipped, issues };
}


interface PhaseMapEntry {
  readonly placement: readonly LumiRegexPlacement[];
  readonly target: LumiRegexTarget;
  readonly disabled: boolean;
  readonly maxDepth?: number | null;
}

const RISU_PHASE_MAP: Readonly<Record<string, PhaseMapEntry>> = {
  // Risu runs on user-input regex at send-time; Lumi has no message-create
  // hook so we approximate by patching the trailing user message at assembly.
  editinput: { placement: ["user_input"], target: "prompt", disabled: false, maxDepth: 0 },
  // Risu chat-history loop only. NOT world_info / desc / jailbreak / authornote.
  editprocess: { placement: ["user_input", "ai_output"], target: "prompt", disabled: false },
  editoutput: { placement: ["ai_output"], target: "response", disabled: false },
  // Risu runs on every rendered message regardless of role.
  editdisplay: { placement: ["ai_output", "user_input"], target: "display", disabled: false },
  // Risu runs after translation. Lumi has no equivalent pipeline so stash disabled.
  edittrans: { placement: ["ai_output", "user_input"], target: "display", disabled: true },
  disabled: { placement: ["ai_output", "user_input"], target: "display", disabled: true },
};

const UNKNOWN_PHASE_FALLBACK: PhaseMapEntry = {
  placement: ["ai_output"],
  target: "display",
  disabled: true,
};


export interface NormalisedFlag {
  readonly flag: string;
  readonly actions: readonly string[];
  readonly order?: number;
}

// Port of Risu's flag-meta parser + char-filter from scripts.ts.
export function normaliseRisuFlag(rawFlag: string | undefined, ableFlag: boolean): NormalisedFlag {
  let raw = ableFlag ? (rawFlag ?? "g") : "g";
  const actions: string[] = [];
  let order: number | undefined;

  if (ableFlag && raw.indexOf("<") >= 0) {
    const acc: string[] = [];
    let i = 0;
    while (i < raw.length) {
      const ch = raw.charCodeAt(i);
      if (ch === 0x3c /* < */) {
        const close = raw.indexOf(">", i + 1);
        if (close < 0) break;
        const inner = raw.slice(i + 1, close);
        for (const meta of splitCommaTrim(inner)) {
          if (meta.startsWith("order ")) {
            const n = Number.parseInt(meta.slice(6), 10);
            if (!Number.isNaN(n)) order = n;
          } else if (meta.length > 0) {
            actions.push(meta);
          }
        }
        i = close + 1;
      } else {
        acc.push(raw[i]!);
        i++;
      }
    }
    raw = acc.join("");
  }

  const seen = new Set<string>();
  let flag = "";
  for (const ch of raw.trim()) {
    if (ALLOWED_FLAG_LETTERS.indexOf(ch) < 0) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    flag += ch;
  }
  if (flag.length === 0) flag = "u";

  if (actions.includes("move_top") || actions.includes("move_bottom")) {
    flag = flag.replace("g", "");
    if (flag.length === 0) flag = "u";
  }

  return { flag, actions, ...(order !== undefined ? { order } : {}) };
}

// Only `chat_index` is threaded per-message by Lumi's display-regex
// (useDisplayRegex `dynamicMacros`); the other chat-position macros are
// chat-wide in every mode, so this is the sole escaped-vs-after divergence.
const PER_MESSAGE_MACRO_RE = /\{\{\s*chat[_-]?index\b/i;

// 'escaped' pre-resolves replace_string once chat-wide with no per-message
// context, so a {{chat_index}} gate resolves wrong and the rule renders
// flakily. Force 'after' (one per-message evaluate, Risu processScriptFull
// parity) when captures or a per-message macro are present.
export function pickSubstituteMacroMode(
  replaceString: string,
  _findHasCbs: boolean,
): LumiRegexMacroMode {
  if (replaceString.indexOf("{{") < 0) return "none";
  if (/\$(?:\d+|&|`|'|<[^>]+>)/.test(replaceString)) return "after";
  if (PER_MESSAGE_MACRO_RE.test(replaceString)) return "after";
  return "escaped";
}

// Reused by the v13 translator migration to detect existing 'escaped' rows
// that the picker would now route to 'after'.
export function replaceStringHasPerMessageMacro(replaceString: string): boolean {
  return PER_MESSAGE_MACRO_RE.test(replaceString);
}


function splitCommaTrim(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || s[i] === ",") {
      const seg = s.slice(start, i).trim();
      if (seg.length > 0) out.push(seg);
      start = i + 1;
    }
  }
  return out;
}

function nonEmpty(s: string | undefined | null, fallback: string): string {
  if (typeof s === "string" && s.length > 0) return s;
  return fallback;
}

export function detectAtAction(out: string): AtAtAction["action"] | null {
  for (const prefix of AT_ACTION_PREFIXES) {
    if (out.startsWith(prefix) && (prefix !== "@@emo" || out.startsWith("@@emo "))) {
      return prefix.slice(2) as AtAtAction["action"];
    }
  }
  return null;
}

