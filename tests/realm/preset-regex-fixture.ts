import type {
  RegexScriptCreateDTO,
  RegexScriptDTO,
  RegexScriptListOptionsDTO,
  SpindleAPI,
} from 'lumiverse-spindle-types';
import type { RealmBackendHandle } from '../../src/realm/backend.js';
import { setupRealmBackend } from '../../src/realm/backend.js';

export const PRESET_NAME = 'Synthetic Preset';

/** Neutral display/response rules. No card text, no third-party preset text. */
export const SYNTHETIC_REGEX: ReadonlyArray<Record<string, unknown>> = [
  { comment: 'tag alpha', in: '<alpha>(.+?)</alpha>', out: '<b>$1</b>', type: 'editdisplay', ableFlag: true, flag: 'g' },
  { comment: 'tag beta', in: '<beta>(.+?)</beta>', out: '<i>$1</i>', type: 'editdisplay', ableFlag: true, flag: 'g' },
  { comment: 'tag gamma', in: '<gamma>(.+?)</gamma>', out: '[gamma: $1]', type: 'editoutput', ableFlag: true, flag: 'g' },
];

export function syntheticPresetRaw(
  regex: ReadonlyArray<Record<string, unknown>> = SYNTHETIC_REGEX,
  name = PRESET_NAME,
): Record<string, unknown> {
  return {
    name,
    temperature: 80,
    promptTemplate: [
      { type: 'plain', role: 'system', name: 'Synthetic Rule', text: 'Synthetic instructions.' },
      { type: 'chat' },
    ],
    regex: [...regex],
  };
}

/** The decoder accepts plain JSON, so the synthetic archive needs no container. */
export function presetBytes(
  regex: ReadonlyArray<Record<string, unknown>> = SYNTHETIC_REGEX,
  name = PRESET_NAME,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(syntheticPresetRaw(regex, name)));
}

export interface StoredRegexRow {
  readonly userId: string;
  readonly dto: RegexScriptDTO;
}

export interface RegexStore {
  readonly calls: { list: number; create: number; update: number };
  /** Every create input, in call order, for first-import shape assertions. */
  readonly creates: RegexScriptCreateDTO[];
  all(): readonly StoredRegexRow[];
  rowsFor(userId: string): RegexScriptDTO[];
  api: Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;
}

/**
 * Minimal host stand-in: rows are per user, `can_mutate` marks extension-owned
 * rows, and paging is honored so the reconcile has to walk every page.
 */
export function makeRegexStore(options: {
  readonly userId?: string;
  readonly seed?: readonly RegexScriptDTO[];
} = {}): RegexStore {
  const owner = options.userId ?? 'u1';
  const stored: StoredRegexRow[] = (options.seed ?? []).map((dto) => ({ userId: owner, dto: { ...dto } }));
  const calls = { list: 0, create: 0, update: 0 };
  const creates: RegexScriptCreateDTO[] = [];
  let seq = stored.length;

  const api: Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'> = {
    async list(listOptions?: RegexScriptListOptionsDTO) {
      calls.list++;
      const userId = listOptions?.userId ?? '';
      const limit = listOptions?.limit ?? 200;
      const offset = listOptions?.offset ?? 0;
      const scoped = stored.filter(
        (row) =>
          row.userId === userId
          && (listOptions?.scope === undefined || row.dto.scope === listOptions.scope),
      );
      return {
        data: scoped.slice(offset, offset + limit).map((row) => ({ ...row.dto })),
        total: scoped.length,
      };
    },
    async create(input: RegexScriptCreateDTO, userId?: string) {
      calls.create++;
      creates.push(input);
      seq++;
      const dto: RegexScriptDTO = {
        id: `row-${seq}`,
        can_mutate: true,
        name: input.name,
        script_id: input.script_id ?? '',
        find_regex: input.find_regex,
        replace_string: input.replace_string ?? '',
        flags: input.flags ?? '',
        placement: [...(input.placement ?? [])],
        scope: input.scope ?? 'global',
        scope_id: input.scope_id ?? null,
        target: input.target ?? 'display',
        min_depth: input.min_depth ?? null,
        max_depth: input.max_depth ?? null,
        trim_strings: [...(input.trim_strings ?? [])],
        run_on_edit: input.run_on_edit ?? false,
        substitute_macros: input.substitute_macros ?? 'none',
        disabled: input.disabled ?? false,
        sort_order: input.sort_order ?? 0,
        description: input.description ?? '',
        folder: input.folder ?? '',
        metadata: { ...(input.metadata ?? {}) },
        created_at: 1000 + seq,
        updated_at: 1000 + seq,
      };
      stored.push({ userId: userId ?? '', dto });
      return { ...dto };
    },
    async update(scriptId: string, input: Partial<RegexScriptCreateDTO>, userId?: string) {
      calls.update++;
      const row = stored.find((r) => r.dto.id === scriptId && r.userId === (userId ?? ''));
      if (!row) throw new Error(`regex store: no row ${scriptId} for user ${userId ?? ''}`);
      if (row.dto.can_mutate !== true) {
        throw new Error(`regex store: row ${scriptId} is not mutable by this extension`);
      }
      const dto = row.dto;
      if (input.name !== undefined) dto.name = input.name;
      if (input.find_regex !== undefined) dto.find_regex = input.find_regex;
      if (input.replace_string !== undefined) dto.replace_string = input.replace_string;
      if (input.flags !== undefined) dto.flags = input.flags;
      if (input.placement !== undefined) dto.placement = [...input.placement];
      if (input.disabled !== undefined) dto.disabled = input.disabled;
      if (input.sort_order !== undefined) dto.sort_order = input.sort_order;
      dto.updated_at = dto.updated_at + 1;
      return { ...dto };
    },
  };

  return {
    calls,
    creates,
    api,
    all: () => stored,
    rowsFor: (userId: string) => stored.filter((row) => row.userId === userId).map((row) => ({ ...row.dto })),
  };
}

/** One neutral rule shaped like the translator's output. */
export function syntheticRule(over: Partial<RegexScriptCreateDTO> & { readonly name: string }): RegexScriptCreateDTO {
  return {
    find_regex: '(?!)',
    replace_string: '',
    flags: 'g',
    placement: ['ai_output'],
    scope: 'global',
    scope_id: null,
    target: 'display',
    min_depth: null,
    max_depth: null,
    trim_strings: [],
    run_on_edit: false,
    substitute_macros: 'none',
    disabled: false,
    sort_order: 0,
    description: '',
    folder: PRESET_NAME,
    metadata: {},
    ...over,
  };
}

/** A stored row built from a rule projection. Defaults to a row this extension
 *  does not own, which is how host and other-extension rows look. */
export function seededRow(
  rule: RegexScriptCreateDTO,
  options: { readonly id?: string; readonly canMutate?: boolean } = {},
): RegexScriptDTO {
  return {
    id: options.id ?? 'foreign-row-1',
    can_mutate: options.canMutate ?? false,
    name: rule.name,
    script_id: 'foreign_script',
    find_regex: rule.find_regex,
    replace_string: rule.replace_string ?? '',
    flags: rule.flags ?? '',
    placement: [...(rule.placement ?? [])],
    scope: rule.scope ?? 'global',
    scope_id: rule.scope_id ?? null,
    target: rule.target ?? 'display',
    min_depth: rule.min_depth ?? null,
    max_depth: rule.max_depth ?? null,
    trim_strings: [...(rule.trim_strings ?? [])],
    run_on_edit: rule.run_on_edit ?? false,
    substitute_macros: rule.substitute_macros ?? 'none',
    disabled: false,
    sort_order: rule.sort_order ?? 0,
    description: rule.description ?? '',
    folder: rule.folder ?? '',
    metadata: { ...(rule.metadata ?? {}) },
    created_at: 1,
    updated_at: 1,
  };
}

export interface PresetBackendHarness {
  readonly backend: RealmBackendHandle;
  readonly logs: readonly string[];
  readonly warns: readonly string[];
}

export function makePresetBackend(store: RegexStore): PresetBackendHarness {
  const logs: string[] = [];
  const warns: string[] = [];
  const backend = setupRealmBackend({
    send: () => {},
    log: {
      info: (m: string) => { logs.push(m); },
      warn: (m: string) => { warns.push(m); },
      error: () => {},
    },
    importCardFromBytes: async () => {},
    createPreset: async (input) => ({
      id: `preset-${logs.length}`,
      name: input.name,
      provider: input.provider,
      engine: input.engine ?? 'classic',
      parameters: input.parameters ?? {},
      prompt_order: input.prompt_order ?? [],
      prompts: {},
      metadata: input.metadata ?? {},
      cache_revision: 0,
      created_at: 1,
      updated_at: 1,
    }),
    regexApi: store.api,
    toast: () => {},
  });
  return { backend, logs, warns };
}
