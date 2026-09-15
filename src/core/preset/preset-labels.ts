// Display-label translation for imported presets. Only the strings the host
// renders as UI labels are rewritten: a category block's name, a variable's
// label, and a select option's label. Variable names, ids, option values,
// defaults and block content are carried through untouched so prompt behavior
// and the user's stored choices are unaffected.

import type { UserPresetCreateDTO } from 'lumiverse-spindle-types';

// A label is translated only when it carries a non-ASCII letter, so emoji
// decoration and labels the author already wrote in Latin stay untouched.
const LETTER = /\p{L}/u;

function needsTranslation(text: string): boolean {
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x7f && LETTER.test(ch)) return true;
  }
  return false;
}

export interface PresetLabelPrompt {
  readonly system: string;
  readonly user: string;
}

export interface PresetLabelGenerateRequest {
  readonly system: string;
  readonly user: string;
  readonly connectionId: string;
  readonly userId: string;
}

export interface PresetLabelTranslateDeps {
  /** Runs one completion on the selected connection profile. */
  readonly generate: (request: PresetLabelGenerateRequest) => Promise<string>;
}

function label(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Every display label the host renders for a preset's toggle categories, in
 * document order and without duplicates. Only labels written in a non-Latin
 * script are returned: the translation targets imported Korean text and must
 * never rewrite labels that are already Latin.
 */
export function collectPresetLabels(preset: UserPresetCreateDTO): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const text = label(value);
    if (text.length === 0 || seen.has(text) || !needsTranslation(text)) return;
    seen.add(text);
    labels.push(text);
  };
  for (const block of preset.prompt_order ?? []) {
    if (block.marker !== 'category') continue;
    push(block.name);
    for (const variable of block.variables ?? []) {
      push(variable.label);
      if (variable.type === 'select' || variable.type === 'multiselect') {
        for (const option of variable.options) push(option.label);
      }
    }
  }
  return labels;
}

export function buildPresetLabelPrompt(labels: readonly string[]): PresetLabelPrompt {
  return {
    system: [
      'You translate the user-interface labels of an imported chat prompt preset into English.',
      'Reply with one JSON object and nothing else: a key for every input string, exactly as given, mapped to its English translation.',
      'Translate short labels literally. Keep emoji, placeholders, numbers, and inline code as they are.',
      'Never add, drop, reorder, or comment on entries.',
    ].join(' '),
    user: `Translate these labels to English:\n${JSON.stringify(labels, null, 2)}`,
  };
}

/** Parses the model reply. Every requested label must come back non-empty. */
export function parsePresetLabelResponse(raw: string, labels: readonly string[]): Map<string, string> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('preset label translation: reply contained no JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error(`preset label translation: reply was not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('preset label translation: reply was not a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const translations = new Map<string, string>();
  const missing: string[] = [];
  for (const text of labels) {
    const value = record[text];
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(text);
      continue;
    }
    translations.set(text, value.trim());
  }
  if (missing.length > 0) {
    throw new Error(
      `preset label translation: reply omitted ${missing.length} of ${labels.length} label(s), first=${JSON.stringify(missing[0])}`,
    );
  }
  return translations;
}

/** Rewrites label fields only, by exact source-label match. */
export function applyPresetLabelTranslations(
  preset: UserPresetCreateDTO,
  translations: ReadonlyMap<string, string>,
): UserPresetCreateDTO {
  if (translations.size === 0) return preset;
  let changed = false;
  const prompt_order = (preset.prompt_order ?? []).map((block) => {
    if (block.marker !== 'category') return block;
    const translatedName = translations.get(label(block.name));
    const nameChanged = translatedName !== undefined && translatedName !== block.name;
    const source = block.variables;
    const variables = (source ?? []).map((variable) => {
      const translatedLabel = translations.get(label(variable.label));
      const labelChanged = translatedLabel !== undefined && translatedLabel !== variable.label;
      if (variable.type === 'select' || variable.type === 'multiselect') {
        const options = variable.options.map((option) => {
          const translatedOption = translations.get(label(option.label));
          return translatedOption === undefined || translatedOption === option.label
            ? option
            : { ...option, label: translatedOption };
        });
        const optionsChanged = options.some((option, index) => option !== variable.options[index]);
        if (!labelChanged && !optionsChanged) return variable;
        return {
          ...variable,
          ...(labelChanged ? { label: translatedLabel } : {}),
          ...(optionsChanged ? { options } : {}),
        };
      }
      return labelChanged ? { ...variable, label: translatedLabel } : variable;
    });
    const labelsChanged = variables.some((variable, index) => variable !== source?.[index]);
    if (!nameChanged && !labelsChanged) return block;
    changed = true;
    return {
      ...block,
      ...(nameChanged ? { name: translatedName } : {}),
      ...(source !== undefined ? { variables } : {}),
    };
  });
  return changed ? { ...preset, prompt_order } : preset;
}

/**
 * Translates a preset's display labels through the selected connection. Returns
 * the preset unchanged when it carries no non-ASCII label, and throws when the
 * reply cannot be applied, so a failed translation never imports half a preset.
 */
export async function translatePresetLabels(
  preset: UserPresetCreateDTO,
  opts: { readonly connectionId: string; readonly userId: string },
  deps: PresetLabelTranslateDeps,
): Promise<UserPresetCreateDTO> {
  const labels = collectPresetLabels(preset);
  if (labels.length === 0) return preset;
  const prompt = buildPresetLabelPrompt(labels);
  const raw = await deps.generate({
    system: prompt.system,
    user: prompt.user,
    connectionId: opts.connectionId,
    userId: opts.userId,
  });
  return applyPresetLabelTranslations(preset, parsePresetLabelResponse(raw, labels));
}
