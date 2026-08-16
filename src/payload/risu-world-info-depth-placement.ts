import type {
  WorldInfoInterceptorEntryDTO,
  WorldInfoInterceptorPlacementDTO,
  WorldInfoInterceptorRoleDTO,
} from 'lumiverse-spindle-types';

import { convertCharacterBook } from '../core/charx/module.js';
import { mapLoreBook } from '../core/mappers/lorebook.js';
import {
  LEGACY_ENTRY_HASH_FIELDS_V1,
  computeEntrySourceHash,
  computeEntrySourceHashWithFields,
} from '../core/mappers/lorebook-hash.js';
import {
  loreBookSchema,
  type LoreBook,
} from '../core/schemas/lorebook.js';
import type { ActiveCard } from '../interpreter/dispatch.js';

interface RuntimeModuleIdentity {
  readonly resolvedId: string;
  readonly persistedHandles: ReadonlySet<string>;
  readonly aliases: ReadonlySet<string>;
}

interface RuntimeSourceRow {
  readonly placement: WorldInfoInterceptorPlacementDTO;
  readonly sourceHashes: ReadonlySet<string>;
}

interface RuntimeSourcePlan {
  readonly baseRows: ReadonlyMap<number, RuntimeSourceRow>;
  readonly moduleRows: ReadonlyMap<
    string,
    ReadonlyMap<number, RuntimeSourceRow>
  >;
  readonly moduleIdentities: readonly RuntimeModuleIdentity[];
  readonly attachedModuleIds: ReadonlySet<string>;
  readonly attachedWorldBooks: Readonly<Record<string, string>>;
  readonly attachedWorldBookIds: ReadonlySet<string>;
}

const planByActiveCard = new WeakMap<ActiveCard, RuntimeSourcePlan>();

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function arrayIndexOf(entry: WorldInfoInterceptorEntryDTO): number | null {
  const value = entry.extensions['_risu_array_index'];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function moduleIdOf(entry: WorldInfoInterceptorEntryDTO): string | null {
  const value = entry.extensions['_risu_module_id'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function matchesRuntimeSource(
  entry: WorldInfoInterceptorEntryDTO,
  sourceRow: RuntimeSourceRow,
): boolean {
  const stored = entry.extensions['_risu_source_hash'];
  if (typeof stored !== 'string') return false;
  if (!sourceRow.sourceHashes.has(stored)) return false;
  const source = entry as unknown as Record<string, unknown>;
  return stored === computeEntrySourceHash(source) ||
    stored === computeEntrySourceHashWithFields(
      source,
      LEGACY_ENTRY_HASH_FIELDS_V1,
    );
}

/**
 * Direct port of RisuAI's pre-v2 lore update used before decorator parsing.
 */
function migrateLegacyLoreContent(lore: LoreBook): string {
  const version = lore.bookVersion ?? 1;
  if (version >= 2) return lore.content;
  let content = lore.content;
  if (lore.activationPercent) {
    content = `@@probability ${String(lore.activationPercent)}\n${content}`;
  }
  return content
    .replace(/@@@?end/g, '@@depth 0')
    .replace(/\<(char|bot)\>/g, '{{char}}')
    .replace(/\<(user)\>/g, '{{user}}');
}

type DecoratorHook = (
  name: string,
  args: readonly string[],
) => false | void;

/**
 * Direct port of CCardLib.decorator.parse used by RisuAI.
 */
function parseRisuDecorators(data: string, hook: DecoratorHook): void {
  const lines = data.trim().split('\n');
  let suspended = false;
  for (let index = 0; index < lines.length; index++) {
    let line = (lines[index] ?? '').trim();
    if (line === '@@@end') line = '@@end';
    if (!line.startsWith('@@')) return;
    if (line.startsWith('@@@') && !suspended) continue;
    let spaceIndex = line.indexOf(' ');
    if (spaceIndex === -1) spaceIndex = line.length;
    const name = line.slice(
      line.startsWith('@@@') ? 3 : 2,
      spaceIndex,
    );
    const args = line
      .slice(spaceIndex)
      .split(',')
      .map((arg) => arg.trim())
      .filter((arg) => arg !== '');
    suspended = name !== '' ? hook(name, args) === false : false;
  }
}

/**
 * Port of RisuAI's lorebook placement callback. Non-placement cases retain
 * their return behavior because it controls @@@ fallback execution.
 */
export function resolveRisuChatDepthPlacement(
  content: string,
): WorldInfoInterceptorPlacementDTO | null {
  let position = '';
  let depth = 0;
  let role: WorldInfoInterceptorRoleDTO = 'system';

  parseRisuDecorators(content, (name, args) => {
    switch (name) {
      case 'end':
        position = 'depth';
        depth = 0;
        return;
      case 'activate_only_after':
      case 'activate_only_every':
      case 'is_greeting':
        return Number.isNaN(parseInt(args[0] as string)) ? false : undefined;
      case 'keep_activate_after_match':
      case 'dont_activate_after_match':
      case 'instruct_depth':
      case 'reverse_instruct_depth':
      case 'instruct_scan_depth':
      case 'is_user_icon':
        return false;
      case 'depth':
      case 'reverse_depth': {
        const parsed = parseInt(args[0] as string);
        if (Number.isNaN(parsed)) return false;
        depth = parsed;
        position = name;
        return;
      }
      case 'role':
        if (
          args[0] === 'user' ||
          args[0] === 'assistant' ||
          args[0] === 'system'
        ) {
          role = args[0];
          return;
        }
        return false;
      case 'position': {
        const value = args[0];
        if (
          value !== undefined &&
          (
            value.startsWith('pt_') ||
            value === 'after_desc' ||
            value === 'before_desc' ||
            value === 'personality' ||
            value === 'scenario'
          )
        ) {
          position = value;
          return;
        }
        return false;
      }
      case 'disable_ui_prompt':
        return args[0] === 'post_history_instructions' ||
          args[0] === 'system_prompt'
          ? undefined
          : false;
      case 'scan_depth':
      case 'inject_lore':
      case 'inject_at':
      case 'inject_replace':
      case 'inject_prepend':
      case 'ignore_on_max_context':
      case 'additional_keys':
      case 'exclude_keys':
      case 'exclude_keys_all':
      case 'match_full_word':
      case 'match_partial_word':
      case 'activate':
      case 'dont_activate':
      case 'probability':
      case 'priority':
      case 'unrecursive':
      case 'recursive':
      case 'no_recursive_search':
        return;
      default:
        return false;
    }
  });

  if (position === 'depth' && depth > 0 && Number.isFinite(depth)) {
    return {
      type: 'chat_depth',
      role,
      depth,
      direction: 'from_start',
    };
  }
  if (position === 'depth' && depth === Number.POSITIVE_INFINITY) {
    return {
      type: 'chat_depth',
      role,
      depth: Number.MAX_SAFE_INTEGER,
      direction: 'from_start',
    };
  }
  if (position === 'reverse_depth') {
    return {
      type: 'chat_depth',
      role,
      // Negative reverse depths append. Positive infinity is represented by
      // the largest accepted integer and still resolves to the first boundary.
      depth: depth === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, depth),
      direction: 'from_end',
    };
  }
  return null;
}

function buildModuleRows(
  rawRows: readonly unknown[],
  dropEmpty: boolean,
): ReadonlyMap<number, RuntimeSourceRow> {
  const loreRows: LoreBook[] = [];
  for (const raw of rawRows) {
    const parsed = loreBookSchema.safeParse(raw);
    if (!parsed.success) continue;
    const lore = parsed.data;
    if (dropEmpty && lore.key.length === 0 && lore.content.length === 0) {
      continue;
    }
    loreRows.push(lore);
  }

  const placements = loreRows.map((lore) =>
    resolveRisuChatDepthPlacement(migrateLegacyLoreContent(lore))
  );
  if (!placements.some((placement) => placement !== null)) return new Map();

  const projected = mapLoreBook(loreRows, {
    worldBookId: 'runtime-source',
    now: () => 0,
    uuid: () => 'runtime-source',
  });
  const rows = new Map<number, RuntimeSourceRow>();
  for (let index = 0; index < loreRows.length; index++) {
    const placement = placements[index];
    if (!placement) continue;
    const projectedRow = projected[index] as unknown as Record<string, unknown>;
    rows.set(index, {
      placement,
      sourceHashes: new Set([
        computeEntrySourceHash(projectedRow),
        computeEntrySourceHashWithFields(
          projectedRow,
          LEGACY_ENTRY_HASH_FIELDS_V1,
        ),
      ]),
    });
  }
  return rows;
}

function buildCharacterBookRows(
  characterBook: Readonly<Record<string, unknown>> | null,
): ReadonlyMap<number, RuntimeSourceRow> {
  const rawEntries = characterBook?.['entries'];
  if (!Array.isArray(rawEntries)) return new Map();
  const validEntries = rawEntries.filter((entry) => record(entry) !== null);
  return buildModuleRows(
    convertCharacterBook({ entries: validEntries }),
    false,
  );
}

function buildModuleIdentities(
  active: ActiveCard,
  moduleRows: RuntimeSourcePlan['moduleRows'],
): RuntimeModuleIdentity[] {
  const identities: RuntimeModuleIdentity[] = [];
  const extra = record(active.card.risuPayload.extra);
  const encoded = record(extra?.['runtime_module_identities']);
  if (encoded) {
    for (const [resolvedId, rawIdentity] of Object.entries(encoded)) {
      const identity = record(rawIdentity);
      if (!identity) continue;
      identities.push({
        resolvedId,
        persistedHandles: new Set(
          stringArray(identity['persisted_handles']),
        ),
        aliases: new Set([
          resolvedId,
          ...stringArray(identity['aliases']),
          ...stringArray(identity['persisted_handles']),
        ]),
      });
    }
  }
  for (const moduleId of moduleRows.keys()) {
    if (identities.some((identity) => identity.resolvedId === moduleId)) {
      continue;
    }
    identities.push({
      resolvedId: moduleId,
      persistedHandles: new Set([moduleId]),
      aliases: new Set([moduleId]),
    });
  }
  return identities;
}

function buildRuntimeSourcePlan(active: ActiveCard): RuntimeSourcePlan {
  const sourceCard = record(active.lumirealm.source?.card);
  const cardData = record(sourceCard?.['data']) ?? sourceCard;
  const sourceModule = record(active.lumirealm.source?.module);
  const sourceModuleLore = sourceModule?.['lorebook'];
  const parsedBaseModuleRows = Array.isArray(sourceModuleLore)
    ? sourceModuleLore
      .map((row) => loreBookSchema.safeParse(row))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
    : [];
  const baseRows = Array.isArray(sourceModuleLore)
    ? buildModuleRows(parsedBaseModuleRows, false)
    : buildCharacterBookRows(record(cardData?.['character_book']));

  const extra = record(active.card.risuPayload.extra);
  const rawAttached = record(extra?.['runtime_module_lorebooks']);
  const moduleRows = new Map<
    string,
    ReadonlyMap<number, RuntimeSourceRow>
  >();
  if (rawAttached) {
    for (const [moduleId, rows] of Object.entries(rawAttached)) {
      if (!Array.isArray(rows)) continue;
      moduleRows.set(moduleId, buildModuleRows(rows, true));
    }
  }

  const attachedModuleIds = new Set(
    active.lumirealm.user_overrides.attached_module_ids ?? [],
  );
  const attachedWorldBooks =
    active.lumirealm.user_overrides.attached_module_world_books ?? {};
  return {
    baseRows,
    moduleRows,
    moduleIdentities: buildModuleIdentities(active, moduleRows),
    attachedModuleIds,
    attachedWorldBooks,
    attachedWorldBookIds: new Set(Object.values(attachedWorldBooks)),
  };
}

function sourcePlan(active: ActiveCard): RuntimeSourcePlan {
  const cached = planByActiveCard.get(active);
  if (cached) return cached;
  const built = buildRuntimeSourcePlan(active);
  planByActiveCard.set(active, built);
  return built;
}

function resolveModuleRows(
  plan: RuntimeSourcePlan,
  moduleId: string,
  worldBookId: string,
): ReadonlyMap<number, RuntimeSourceRow> | null {
  const matches = plan.moduleIdentities.filter((identity) => {
    if (!identity.aliases.has(moduleId)) return false;
    if (
      ![...identity.persistedHandles].some((handle) =>
        plan.attachedModuleIds.has(handle)
      )
    ) {
      return false;
    }
    return [...identity.aliases].some(
      (alias) => plan.attachedWorldBooks[alias] === worldBookId,
    );
  });
  if (matches.length !== 1) return null;
  return plan.moduleRows.get(matches[0]!.resolvedId) ?? null;
}

/**
 * Resolve source-owned chat-depth placement without changing stored rows.
 */
export function buildRisuWorldInfoChatPlacements(
  active: ActiveCard,
  entries: readonly WorldInfoInterceptorEntryDTO[],
): ReadonlyMap<string, WorldInfoInterceptorPlacementDTO> {
  const plan = sourcePlan(active);
  const placements = new Map<string, WorldInfoInterceptorPlacementDTO>();

  for (const entry of entries) {
    if (entry.book_source !== 'character') continue;
    const index = arrayIndexOf(entry);
    if (index === null) continue;
    const moduleId = moduleIdOf(entry);
    let sourceRow: RuntimeSourceRow | undefined;
    if (moduleId !== null) {
      sourceRow = resolveModuleRows(
        plan,
        moduleId,
        entry.world_book_id,
      )?.get(index);
    } else if (!plan.attachedWorldBookIds.has(entry.world_book_id)) {
      sourceRow = plan.baseRows.get(index);
    }
    if (sourceRow && matchesRuntimeSource(entry, sourceRow)) {
      placements.set(entry.id, sourceRow.placement);
    }
  }

  return placements;
}
