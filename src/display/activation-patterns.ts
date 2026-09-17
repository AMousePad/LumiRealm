import type { SpindleDisplayContext, SpindleFrontendContext } from 'lumiverse-spindle-types';
import { isRisuRegexScript, type FeRegexScript } from './regex-apply.js';

export class ActivationPatternError extends Error {
  override readonly name = 'ActivationPatternError';
}

export const ACTIVATION_INPUT_DEP_KEY = '__native_activation_inputs__';
type PatternResult = string | ActivationPatternError;

interface PreparedPattern { source: string; resolved?: string; error?: string }
type Loader = (presetId: string, patterns: string[], context: SpindleDisplayContext) => Promise<PreparedPattern[]>;

async function loadPatterns(presetId: string, patterns: string[], context: SpindleDisplayContext): Promise<PreparedPattern[]> {
  const response = await fetch('/api/v1/regex-scripts/activation-patterns', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset_id: presetId, patterns, chat_id: context.chatId,
      character_id: context.characterId, persona_id: context.personaId }),
  });
  if (!response.ok) throw new ActivationPatternError(`Activation input preparation failed (${response.status}); the host must provide the activation-patterns endpoint`);
  const body = await response.json() as { patterns?: PreparedPattern[] };
  if (!Array.isArray(body.patterns)) throw new ActivationPatternError('Invalid activation input response');
  return body.patterns;
}

// Matches Lumiverse's readPromptActivation validity gate, including legacy rows.
export function hasNativeActivationFind(script: FeRegexScript): boolean {
  if (isRisuRegexScript(script) || !script.preset_id || !script.find_regex.includes('{{')) return false;
  const raw = script.metadata?.['prompt_activation'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const config = raw as Record<string, unknown>;
  if (config['source'] !== 'user_input' && config['source'] !== 'ai_output') return false;
  if (config['lifetime'] !== 'latest' && config['lifetime'] !== 'chat') return false;
  const mappings = config['mappings'];
  if (!Array.isArray(mappings) || mappings.length === 0 || mappings.length > 64) return false;
  return mappings.every((mapping: unknown) => {
    if (!mapping || typeof mapping !== 'object') return false;
    const m = mapping as Record<string, unknown>;
    if (typeof m['capture'] !== 'string' || !/^(?:[0-9]|[1-9][0-9]|[A-Za-z_][A-Za-z0-9_]{0,63})$/.test(m['capture'])) return false;
    const values = Array.isArray(m['value']) ? m['value'] : [m['value']];
    const blocks = m['block_ids'];
    return values.length > 0 && values.length <= 64
      && values.every(value => typeof value === 'string' && !!value.trim() && value.length <= 1000)
      && typeof m['enabled'] === 'boolean'
      && Array.isArray(blocks) && blocks.length > 0 && blocks.length <= 128
      && blocks.every(id => typeof id === 'string' && !!id.trim() && id.length <= 200);
  });
}

export function createActivationPatternCache(load: Loader = loadPatterns) {
  const cache = new Map<string, { chatId: string | undefined; dependencies: Set<string>; result: Promise<Map<string, PatternResult>> }>();
  return {
    invalidate(chatId?: string, changedVars?: readonly string[]): boolean {
      let changed = false;
      for (const [key, entry] of cache) {
        if (chatId !== undefined && entry.chatId !== chatId) continue;
        if (changedVars && !changedVars.some(value => value === '*' || entry.dependencies.has(value))) continue;
        cache.delete(key);
        changed = true;
      }
      return changed;
    },
    async resolve(scripts: readonly FeRegexScript[], context: SpindleDisplayContext, touched: Set<string>): Promise<Map<string, PatternResult>> {
      const groups = new Map<string, FeRegexScript[]>();
      for (const script of scripts) {
        if (!hasNativeActivationFind(script)) continue;
        const rows = groups.get(script.preset_id!) ?? [];
        rows.push(script);
        groups.set(script.preset_id!, rows);
      }
      if (groups.size) touched.add(ACTIVATION_INPUT_DEP_KEY);
      const resolved = new Map<string, PatternResult>();
      await Promise.all([...groups].map(async ([presetId, rows]) => {
        const pending = [...new Set(rows.map(row => row.find_regex))].sort();
        while (pending.length) {
          const patterns: string[] = [];
          let size = 0;
          while (pending.length && patterns.length < 100 && (patterns.length === 0 || size + pending[0]!.length <= 100_000)) {
            const pattern = pending.shift()!;
            patterns.push(pattern);
            size += pattern.length;
          }
          const key = JSON.stringify([presetId, context.chatId, context.characterId, context.personaId, patterns]);
          let entry = cache.get(key);
          if (!entry) {
            const dependencies = new Set<string>();
            for (const pattern of patterns) {
              for (const match of pattern.matchAll(/\{\{\s*getchatvar\s*::\s*([^{}]*?)\s*\}\}/gi)) {
                dependencies.add(`local:${match[1]!.trim()}`);
                dependencies.add(`chat:${match[1]!.trim()}`);
              }
            }
            entry = { chatId: context.chatId, dependencies, result: Promise.resolve(new Map()) };
            const current = entry;
            entry.result = load(presetId, patterns, context).then(response => {
              if (cache.get(key) !== current) throw new ActivationPatternError('Activation inputs changed during preparation');
              if (response.length !== patterns.length) throw new ActivationPatternError('Incomplete activation input response');
              return new Map<string, PatternResult>(response.map((row, index) => {
                if (row.source !== patterns[index]) throw new ActivationPatternError('Invalid prepared activation pattern');
                if (typeof row.error === 'string') return [row.source, new ActivationPatternError(row.error)];
                if (typeof row.resolved !== 'string') throw new ActivationPatternError('Invalid prepared activation pattern');
                return [row.source, row.resolved];
              }));
            });
            cache.set(key, entry);
          }
          for (const dependency of entry.dependencies) touched.add(dependency);
          const batch = await entry.result;
          for (const row of rows) if (batch.has(row.find_regex)) resolved.set(row.id, batch.get(row.find_regex)!);
        }
      }));
      return resolved;
    },
  };
}

export type ActivationPatternCache = ReturnType<typeof createActivationPatternCache>;

export function subscribeActivationPatternChanges(
  events: SpindleFrontendContext['events'], cache: ActivationPatternCache, invalidate: (keys: string[]) => void,
): () => void {
  const refresh = (chatId?: string, keys?: string[]) => {
    if (cache.invalidate(chatId, keys)) invalidate([ACTIVATION_INPUT_DEP_KEY]);
  };
  const cleanups = [
    ...['PRESET_CHANGED', 'PRESET_DELETED', 'PRESET_PROFILE_CHANGED', 'REGEX_SCRIPT_CHANGED', 'REGEX_SCRIPT_DELETED',
      'CONNECTION_PROFILE_LOADED', 'MAIN_API_CHANGED', 'CHARACTER_EDITED', 'PERSONA_CHANGED', 'CONNECTED', 'CHAT_SWITCHED']
      .map(event => events.on(event, () => refresh())),
    events.on('SETTINGS_UPDATED', payload => {
      const data = payload as { key?: string; keys?: string[] };
      if ([...(data.keys ?? []), data.key].some(key => key === 'activePersonaId' || key?.startsWith('presetProfile:'))) refresh();
    }),
    events.on('CHAT_CHANGED', payload => {
      const data = payload as { chat?: { id: string }; chatId?: string; changedFields?: string[] };
      const chatId = data.chat?.id ?? data.chatId;
      if (!chatId) return;
      const fields = data.changedFields ?? [];
      if (fields.some(field => ['character_id', 'metadata.group', 'metadata.temporary'].includes(field))) {
        refresh(chatId);
      } else if (fields.includes('metadata.chat_variables')) {
        const keys = fields.filter(field => field.startsWith('metadata.chat_variables.'))
          .flatMap(field => { const key = field.slice('metadata.chat_variables.'.length); return [`local:${key}`, `chat:${key}`]; });
        refresh(chatId, keys.length ? keys : undefined);
      }
    }),
  ];
  return () => { for (const cleanup of cleanups) cleanup(); cache.invalidate(); };
}
