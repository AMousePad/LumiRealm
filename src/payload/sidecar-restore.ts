// Applies a `.lumirealm.charx` sidecar on top of a normal import.
//
// Deliberately an overlay, not a second storage path: the archive is imported
// through the ordinary translate -> world_books -> characters -> assets ->
// regex pipeline, so a reimported card is stored exactly like one that arrived
// as a plain .charx. card.json and module.risum already carry the user's edited
// content, so the sidecar only supplies the fields Risu's shapes cannot express
// at all.

import type { LumirealmArchiveSidecar } from '../core/export/archive-types.js';
import type { LumirealmUserOverrides } from './types.js';

/** Attachment handles point at module ids in the exporting library and mean
 *  nothing here. Risu drops module wiring on export too, so a reimport starts
 *  unattached rather than referencing modules that may not exist. */
const NON_PORTABLE_OVERRIDE_KEYS: readonly string[] = [
  'attached_module_ids',
  'attached_module_world_books',
  'attached_module_regex_script_ids',
];

export interface CharacterSidecarOverlay {
  readonly userOverrides: Record<string, unknown>;
  readonly backgroundHtmlSource?: string;
  readonly translations?: unknown;
  readonly applied: readonly string[];
}

export function readCharacterSidecar(
  sidecar: LumirealmArchiveSidecar | null | undefined,
): CharacterSidecarOverlay | null {
  if (!sidecar || sidecar.kind !== 'character' || !sidecar.character) return null;
  const env = sidecar.character.envelope;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const e = env as Record<string, unknown>;
  const applied: string[] = [];

  const rawOverrides = e['user_overrides'];
  const userOverrides: Record<string, unknown> = {};
  if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
    for (const [k, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (NON_PORTABLE_OVERRIDE_KEYS.includes(k)) continue;
      userOverrides[k] = v;
      applied.push(`user_overrides.${k}`);
    }
  }

  const payload = e['payload'];
  let backgroundHtmlSource: string | undefined;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const bhs = (payload as Record<string, unknown>)['background_html_source'];
    if (typeof bhs === 'string' && bhs.length > 0) {
      backgroundHtmlSource = bhs;
      applied.push('payload.background_html_source');
    }
  }

  const translations = e['translations'];
  if (translations && typeof translations === 'object') applied.push('translations');

  return {
    userOverrides,
    ...(backgroundHtmlSource !== undefined ? { backgroundHtmlSource } : {}),
    ...(translations !== undefined ? { translations } : {}),
    applied,
  };
}

/** Sidecar values win: they are the user's own state, whereas the values the
 *  translator just derived came from a card.json that cannot represent them. */
export function mergeSidecarOverrides(
  base: { -readonly [K in keyof LumirealmUserOverrides]: LumirealmUserOverrides[K] },
  overlay: CharacterSidecarOverlay | null,
): void {
  if (!overlay) return;
  for (const [k, v] of Object.entries(overlay.userOverrides)) {
    if (v === undefined) continue;
    (base as Record<string, unknown>)[k] = v;
  }
}
