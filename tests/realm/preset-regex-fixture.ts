import type {
  RegexScriptCreateDTO,
  RegexScriptDTO,
  RegexScriptListOptionsDTO,
  SpindleAPI,
  UserPresetCreateDTO,
} from 'lumiverse-spindle-types';
import type { RealmBackendDeps, RealmBackendHandle } from '../../src/realm/backend.js';
import { setupRealmBackend } from '../../src/realm/backend.js';

const PRESET_NAME = 'Synthetic Preset';

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

/** A row as the current host projects it; the pinned types predate `preset_id`. */
export type HostRegexRow = RegexScriptDTO & { preset_id: string | null };

export interface StoredRegexRow {
  readonly userId: string;
  readonly dto: HostRegexRow;
}

export interface RegexStore {
  readonly calls: { list: number; create: number; update: number };
  /** Every create input, in call order, for first-import shape assertions. */
  readonly creates: RegexScriptCreateDTO[];
  all(): readonly StoredRegexRow[];
  rowsFor(userId: string): HostRegexRow[];
  /** The host's preset-delete cascade: every row bound to the preset goes with it. */
  deletePresetRows(presetId: string): void;
  api: Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update' | 'delete'>;
}

export interface RegexStoreOptions {
  /** Runs as each create reaches the host, before the row exists; throwing rejects the create. */
  readonly beforeCreate?: (input: RegexScriptCreateDTO) => void;
  /** Models a host that predates extension preset links and stores rows unbound. */
  readonly dropPresetLink?: boolean;
}

/**
 * Minimal host stand-in: rows are per user, `can_mutate` marks extension-owned
 * rows, and paging is honored so callers have to walk every page.
 */
export function makeRegexStore(options: RegexStoreOptions = {}): RegexStore {
  let stored: StoredRegexRow[] = [];
  const calls = { list: 0, create: 0, update: 0 };
  const creates: RegexScriptCreateDTO[] = [];
  let seq = 0;

  const api: Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update' | 'delete'> = {
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
      options.beforeCreate?.(input);
      seq++;
      const dto: HostRegexRow = {
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
        preset_id: options.dropPresetLink ? null : (input as { readonly preset_id?: string }).preset_id ?? null,
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
      if (input.metadata !== undefined) dto.metadata = { ...input.metadata };
      dto.updated_at = dto.updated_at + 1;
      return { ...dto };
    },
    async delete(scriptId: string, userId?: string) {
      const before = stored.length;
      stored = stored.filter((r) => !(r.dto.id === scriptId && r.userId === (userId ?? '')));
      return stored.length < before;
    },
  };

  return {
    calls,
    creates,
    api,
    all: () => stored,
    rowsFor: (userId: string) => stored.filter((row) => row.userId === userId).map((row) => ({ ...row.dto })),
    deletePresetRows: (presetId: string) => {
      stored = stored.filter((row) => row.dto.preset_id !== presetId);
    },
  };
}

export interface PresetBackendHarness {
  readonly backend: RealmBackendHandle;
  /** Every preset-create input, in call order. */
  readonly creates: UserPresetCreateDTO[];
  /** Ids of the presets created, in call order. */
  readonly presetIds: readonly string[];
  /** Ids of the presets deleted, in call order. */
  readonly deletedPresetIds: readonly string[];
  /** Every import_progress phase reported, in order. */
  readonly progress: readonly { readonly phase: string; readonly message: string }[];
}

export function makePresetBackend(
  store: RegexStore,
  extra: { readonly translatePresetLabels?: RealmBackendDeps['translatePresetLabels'] } = {},
): PresetBackendHarness {
  const creates: UserPresetCreateDTO[] = [];
  const presetIds: string[] = [];
  const deletedPresetIds: string[] = [];
  const progress: { phase: string; message: string }[] = [];
  const backend = setupRealmBackend({
    send: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    importCardFromBytes: async () => {},
    ...(extra.translatePresetLabels !== undefined
      ? { translatePresetLabels: extra.translatePresetLabels }
      : {}),
    createPreset: async (input) => {
      creates.push(input);
      const id = `preset-${creates.length}`;
      presetIds.push(id);
      return {
        id,
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
      };
    },
    deletePreset: async (presetId) => {
      deletedPresetIds.push(presetId);
      store.deletePresetRows(presetId);
      return true;
    },
    regexApi: store.api,
    notifyImportProgress: ({ phase, message }) => { progress.push({ phase, message }); },
    toast: () => {},
  });
  return { backend, creates, presetIds, deletedPresetIds, progress };
}
