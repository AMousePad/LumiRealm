// Source-hash stamping for world_book entries. Lets migration paths detect
// whether a stored entry was edited by the user since we projected it.

export const LEGACY_ENTRY_HASH_FIELDS_V1: readonly string[] = [
  'key', 'keysecondary', 'content', 'comment',
  'position', 'depth', 'role', 'order_value',
  'selective', 'constant', 'disabled',
  'group_name', 'group_override', 'group_weight',
  'probability', 'scan_depth', 'case_sensitive', 'match_whole_words',
  'automation_id', 'use_regex',
  'prevent_recursion', 'exclude_recursion', 'delay_until_recursion',
  'priority', 'sticky', 'cooldown', 'delay',
  'selective_logic', 'use_probability',
];

export const ENTRY_HASH_FIELDS: readonly string[] = [
  ...LEGACY_ENTRY_HASH_FIELDS_V1,
  'exclude_greeting',
];

function fnv1aHash8(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

// System-managed keys injected post-stamp. `_risu_decorators` stays in the
// hash because it's translator output, not system metadata.
// `_risu_array_index` is excluded so adding it later doesn't invalidate the
// stored hash on existing entries (v6 migration backfills it).
const SYSTEM_MANAGED_EXTENSION_KEYS: readonly string[] = [
  '_risu_source_hash',
  '_risu_module_id',
  '_risu_array_index',
];

// Excludes id/uid/world_book_id (auto-generated), timestamps/vector_*
// (Lumi-managed), and the system-managed extension keys above.
export function computeEntrySourceHashWithFields(
  entry: Record<string, unknown>,
  hashFields: readonly string[],
): string {
  const fields: Record<string, unknown> = {};
  for (const k of hashFields) fields[k] = entry[k];
  const ext = entry['extensions'];
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    const cleaned: Record<string, unknown> = { ...(ext as Record<string, unknown>) };
    for (const k of SYSTEM_MANAGED_EXTENSION_KEYS) delete cleaned[k];
    fields['extensions'] = cleaned;
  } else {
    fields['extensions'] = {};
  }
  return fnv1aHash8(stableStringify(fields));
}

export function computeEntrySourceHash(entry: Record<string, unknown>): string {
  return computeEntrySourceHashWithFields(entry, ENTRY_HASH_FIELDS);
}

// Missing hash is treated as "not edited" so migrations against pre-stamping
// data silently overwrite. Going forward all entries carry the hash.
export function hasUserEditedAnyEntry(entries: readonly unknown[]): boolean {
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const eo = e as Record<string, unknown>;
    const ext = eo['extensions'];
    const stored = ext && typeof ext === 'object'
      ? (ext as Record<string, unknown>)['_risu_source_hash']
      : undefined;
    if (typeof stored !== 'string') continue;
    if (stored !== computeEntrySourceHash(eo)) return true;
  }
  return false;
}
