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

// PUA sentinels used to mark @@-action wrapped content for the second pass
// (move_top/move_bottom) or the display+prompt strip rules (inject editoutput).
// One PUA char each side, hash in the middle, paired per rule so multiple
// @@-actions in the same card can't cross-contaminate.
const SENTINEL_OPEN = "";
const SENTINEL_CLOSE = "";

function ruleHash(scriptId: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < scriptId.length; i++) {
    h ^= scriptId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 6);
}

function openSentinel(hash: string): string {
  return `${SENTINEL_OPEN}${hash}${SENTINEL_OPEN}`;
}
function closeSentinel(hash: string): string {
  return `${SENTINEL_CLOSE}${hash}${SENTINEL_CLOSE}`;
}

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
    let strippedOut = outNormalised;
    if (action) {
      const prefix = `@@${action}`;
      strippedOut = outNormalised.slice(prefix.length).replace(/^\s+/, "");
    }

    // emo / repeat_back need backend-side runtime context (active emotion sprite,
    // sibling message walk). Stash for the render-MCP sliver in backend.ts and
    // emit no Lumi rows.
    if (action === "emo" || action === "repeat_back") {
      skipped.push({
        index: i,
        action,
        script: s,
        flag: normalised.flag,
        phase: s.type,
        actions: normalised.actions,
        order: normalised.order ?? i,
      });
      continue;
    }

    const findPattern = String(s.in ?? "");
    // Drop `u` when find_regex has CBS: `{{` is invalid in Unicode mode.
    const findHasCbs = findPattern.indexOf("{{") >= 0;
    const baseFlags = findHasCbs ? normalised.flag.replace(/u/g, "") : normalised.flag;

    let baseReplace = (action === "inject") ? "" : strippedOut;
    if (baseReplace.endsWith(">") && !hasNoEndNl) baseReplace += "\n";
    // Rows our exporter emitted already carry the display rewrites. Re-applying
    // them double-wraps on every export/import cycle, so the transform is made
    // idempotent by skipping content that has already been through it.
    const preTransformed = (s as unknown as Record<string, unknown>)[TRANSFORMED_FLAG] === true;
    baseReplace = effectivePhase.target === "display"
      ? normalizeDisplayReplaceString(baseReplace, {
          action: action !== null,
          preTransformed,
        })
      : normalizeReplaceStringForSanitizer(baseReplace);

    const baseSubstitute: LumiRegexMacroMode = pickSubstituteMacroMode(
      baseReplace,
      findHasCbs,
    );
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
      },
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
      substitute_macros: overrides.substituteMacros ?? baseSubstitute,
      disabled: effectivePhase.disabled,
      sort_order: overrides.sortOrder,
      description: baseDescription,
      folder,
      pack_id: null,
      metadata: baseMetadata,
      created_at: now,
      updated_at: now,
    });

    if (!action) {
      rows.push(buildRow({
        id: uuid(),
        script_id: uuid(),
        find: findPattern,
        replace: baseReplace,
        sortOrder: baseSortOrder,
      }));
      continue;
    }

    const wrapId = uuid();
    const hash = ruleHash(wrapId);
    const open = openSentinel(hash);
    const close = closeSentinel(hash);

    if (action === "inject") {
      // @@inject ("save full text, hide from user, expose inner content to
      // next-turn LLM") only matters when the rule mutates persisted storage
      // (target=response). Other targets are in-memory only, strip is faithful.
      if (effectivePhase.target === "response") {
        rows.push(buildRow({
          id: wrapId,
          script_id: uuid(),
          find: findPattern,
          replace: `${open}$&${close}`,
          sortOrder: baseSortOrder,
        }));
        rows.push(buildRow({
          id: uuid(),
          script_id: uuid(),
          name: `${baseName}__display_strip`,
          find: `${open}[\\s\\S]*?${close}`,
          replace: "",
          flags: "g",
          placement: ["ai_output", "user_input"],
          target: "display",
          maxDepth: null,
          sortOrder: baseSortOrder + 1,
          substituteMacros: "none",
        }));
        rows.push(buildRow({
          id: uuid(),
          script_id: uuid(),
          name: `${baseName}__prompt_strip`,
          find: `${open}|${close}`,
          replace: "",
          flags: "g",
          placement: ["ai_output", "user_input", "world_info"],
          target: "prompt",
          maxDepth: null,
          sortOrder: baseSortOrder + 2,
          substituteMacros: "none",
        }));
      } else {
        rows.push(buildRow({
          id: wrapId,
          script_id: uuid(),
          find: findPattern,
          replace: "",
          sortOrder: baseSortOrder,
        }));
      }
      continue;
    }

    // move_top/move_bottom: pass 1 wraps the match with the substituted
    // out-template. Pass 2 lifts the wrapped block to top/bottom of the
    // message. Sentinels are consumed in the same chain so storage stays clean.
    const moveWrapFlags = baseFlags.replace(/g/g, "") || "u";
    rows.push(buildRow({
      id: wrapId,
      script_id: uuid(),
      find: findPattern,
      replace: `${open}${baseReplace}${close}`,
      flags: moveWrapFlags,
      sortOrder: baseSortOrder,
    }));
    rows.push(buildRow({
      id: uuid(),
      script_id: uuid(),
      name: `${baseName}__${action}_apply`,
      find: `^([\\s\\S]*?)${open}([\\s\\S]*?)${close}([\\s\\S]*)$`,
      replace: action === "move_top" ? "$2\n$1$3" : "$1$3\n$2",
      flags: "u",
      sortOrder: baseSortOrder + 1,
      substituteMacros: "none",
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
  findHasCbs: boolean,
): LumiRegexMacroMode {
  if (replaceString.indexOf("{{") < 0 && !findHasCbs) return "none";
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
    if (out.startsWith(prefix)) {
      return prefix.slice(2) as AtAtAction["action"];
    }
  }
  return null;
}

