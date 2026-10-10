import type { RegexScriptCreateDTO, RegexScriptDTO, SpindleAPI } from 'lumiverse-spindle-types';

/** Set on a preset rule this extension disabled because its preset is not the active one. */
const SUSPENDED_KEY = 'lumirealm_preset_inactive';
const PAGE_SIZE = 200;

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'update'>;

const chains = new Map<string, Promise<unknown>>();

/** Runs one user's preset rule writes in order, so a switch never reads rows an import or an earlier switch is still writing. */
export function runPresetRegexExclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(userId, tail);
  void tail.then(() => { if (chains.get(userId) === tail) chains.delete(userId); });
  return run;
}

/** A just-created preset is never the active one, so its rules start suspended. */
export function suspendedPresetRule(rule: RegexScriptCreateDTO): RegexScriptCreateDTO {
  if (rule.disabled) return rule;
  return { ...rule, disabled: true, metadata: { ...rule.metadata, [SUSPENDED_KEY]: true } };
}

/**
 * Enables the preset rules this extension suspended for the active preset and suspends every other
 * enabled preset rule. Risu's setPreset replaces db.presetRegex with the selected preset's rules.
 */
export function applyActivePreset(api: RegexApi, userId: string, activePresetId: string | null): Promise<void> {
  return runPresetRegexExclusive(userId, async () => {
    const rows: (RegexScriptDTO & { readonly preset_id?: string | null })[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await api.list({ scope: 'global', limit: PAGE_SIZE, offset, userId });
      rows.push(...page.data);
      if (page.data.length < PAGE_SIZE) break;
    }
    for (const row of rows) {
      if (!row.can_mutate || !row.preset_id) continue;
      if (row.preset_id === activePresetId) {
        if (row.metadata[SUSPENDED_KEY] !== true) continue;
        const { [SUSPENDED_KEY]: _suspended, ...metadata } = row.metadata;
        await api.update(row.id, { disabled: false, metadata }, userId);
      } else if (!row.disabled) {
        // Only enabled rows are suspended, so rules disabled by the user or by their Risu phase stay off.
        await api.update(row.id, { disabled: true, metadata: { ...row.metadata, [SUSPENDED_KEY]: true } }, userId);
      }
    }
  });
}
