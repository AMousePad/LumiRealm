// Inverse of `mapRegex`, used only by the exporter.
//
// The forward mapping is not invertible: one Risu script can expand to three
// Lumi rows (the `@@inject` sentinel triple), `@@emo` / `@@repeat_back` emit no
// rows at all, and display-target replacements pass through island-merge,
// iframe policy, sanitizer normalisation and SVG placeholder substitution.
//
// So the source script stays authoritative and only edits that survive the
// round trip are overlaid. Anything else is reported, never silently dropped:
// `lumirealm.json` carries the live rows verbatim, so our own reimport is
// lossless regardless of what card.json can express.

import { mapRegex } from "../mappers/regex.js";
import type { CustomScript } from "../schemas/customscript.js";

export interface LiveRegexRow {
  readonly name?: unknown;
  readonly find_regex?: unknown;
  readonly replace_string?: unknown;
  readonly flags?: unknown;
  readonly disabled?: unknown;
  readonly sort_order?: unknown;
  readonly metadata?: unknown;
}

interface RisuMeta {
  readonly phase?: unknown;
  readonly origin?: unknown;
  readonly order_index?: unknown;
  readonly at_action?: unknown;
  readonly source_type?: unknown;
  readonly module_id?: unknown;
}

function risuMeta(row: LiveRegexRow): RisuMeta | null {
  const m = row.metadata;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const r = (m as Record<string, unknown>)["_risu"];
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  return r as RisuMeta;
}

export function regexSourceIndex(row: LiveRegexRow): number | null {
  const idx = risuMeta(row)?.order_index;
  return typeof idx === "number" ? idx : null;
}

/** Rows the forward mapping synthesized alongside a primary row. They carry the
 *  same order_index but must never be projected back as their own script. */
function isSynthetic(row: LiveRegexRow): boolean {
  const name = typeof row.name === "string" ? row.name : "";
  return name.endsWith("__display_strip")
    || name.endsWith("__prompt_strip")
    || name.endsWith("__move_top_apply")
    || name.endsWith("__move_bottom_apply");
}

export interface RegexDivergence {
  readonly sourceIndex: number;
  readonly comment: string;
  readonly reason: string;
}

export interface RegexReconcileResult {
  readonly scripts: readonly CustomScript[];
  readonly removed: number;
  readonly edited: number;
  /** Edits that card.json / module.risum cannot represent. Sidecar-only. */
  readonly divergences: readonly RegexDivergence[];
}

export function reconcileRegexScripts(
  sourceScripts: readonly CustomScript[],
  liveRows: readonly LiveRegexRow[],
  characterId: string,
  uuid: () => string,
): RegexReconcileResult {
  const projected = mapRegex(sourceScripts, {
    characterId,
    uuid,
    now: () => 0,
    origin: "module",
  });

  const projectedByIndex = new Map<number, LiveRegexRow[]>();
  for (const row of projected.rows) {
    const idx = regexSourceIndex(row as unknown as LiveRegexRow);
    if (idx === null) continue;
    const list = projectedByIndex.get(idx) ?? [];
    list.push(row as unknown as LiveRegexRow);
    projectedByIndex.set(idx, list);
  }
  const liveByIndex = new Map<number, LiveRegexRow[]>();
  for (const row of liveRows) {
    const idx = regexSourceIndex(row);
    if (idx === null) continue;
    const list = liveByIndex.get(idx) ?? [];
    list.push(row);
    liveByIndex.set(idx, list);
  }

  // @@emo / @@repeat_back run from payload.at_actions and never produce a Lumi
  // row, so absence is expected rather than a user deletion.
  const runtimeOnly = new Set<number>();
  for (const skipped of projected.skipped) runtimeOnly.add(skipped.index);

  const out: CustomScript[] = [];
  const divergences: RegexDivergence[] = [];
  let removed = 0;
  let edited = 0;

  for (let i = 0; i < sourceScripts.length; i++) {
    const source = sourceScripts[i]!;
    if (runtimeOnly.has(i)) {
      out.push(source);
      continue;
    }
    const live = (liveByIndex.get(i) ?? []).filter((r) => !isSynthetic(r));
    if (live.length === 0) {
      removed += 1;
      continue;
    }
    const primaryLive = live[0]!;
    const primaryProjected = (projectedByIndex.get(i) ?? []).filter((r) => !isSynthetic(r))[0];
    if (!primaryProjected) {
      out.push(source);
      continue;
    }

    const findChanged = String(primaryLive.find_regex ?? "") !== String(primaryProjected.find_regex ?? "");
    const replaceChanged = String(primaryLive.replace_string ?? "") !== String(primaryProjected.replace_string ?? "");
    const disabledChanged = primaryLive.disabled === true && primaryProjected.disabled !== true;
    const reEnabled = primaryLive.disabled === false && primaryProjected.disabled === true;

    if (!findChanged && !replaceChanged && !disabledChanged && !reEnabled) {
      out.push(source);
      continue;
    }
    edited += 1;

    const next: Record<string, unknown> = { ...source };
    if (findChanged) next["in"] = String(primaryLive.find_regex ?? "");

    // The forward transform only leaves replace_string byte-identical when it
    // took no display-target rewrite. Overlaying an edited one otherwise would
    // bake island wrappers and SVG placeholders into the exported card.
    if (replaceChanged) {
      const forwardWasIdentity = String(primaryProjected.replace_string ?? "")
        === String(source.out ?? "").replaceAll("$n", "\n");
      if (forwardWasIdentity) {
        next["out"] = String(primaryLive.replace_string ?? "");
      } else {
        divergences.push({
          sourceIndex: i,
          comment: source.comment ?? "",
          reason: "replace_string edited but the import transform is not reversible; source kept",
        });
      }
    }

    const meta = risuMeta(primaryLive);
    if (disabledChanged) next["type"] = "disabled";
    else if (reEnabled && typeof meta?.phase === "string" && meta.phase !== "disabled") {
      next["type"] = meta.phase;
    }

    out.push(next as unknown as CustomScript);
  }

  return { scripts: out, removed, edited, divergences };
}
