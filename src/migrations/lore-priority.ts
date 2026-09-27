import {
  computeEntrySourceHash,
  computeEntrySourceHashWithFields,
  LEGACY_ENTRY_HASH_FIELDS_V1,
} from '../core/mappers/lorebook-hash.js';

interface PriorityTarget {
  readonly priority: number;
  readonly sourceHash: string;
}

export function lorePriorityTargets(
  projected: readonly Record<string, unknown>[],
): ReadonlyMap<string, PriorityTarget> {
  const targets = new Map<string, PriorityTarget>();
  for (const entry of projected) {
    if (typeof entry.priority !== 'number' || entry.priority === 0 || entry.priority !== entry.order_value) continue;
    const target = { priority: entry.priority, sourceHash: computeEntrySourceHash(entry) };
    const old = { ...entry, priority: 0 };
    targets.set(computeEntrySourceHash(old), target);
    targets.set(computeEntrySourceHashWithFields(old, LEGACY_ENTRY_HASH_FIELDS_V1), target);
    targets.set(computeEntrySourceHash({ ...old, exclude_greeting: false }), target);
  }
  return targets;
}

export function lorePriorityPatch(
  entry: { readonly priority?: number; readonly extensions: Readonly<Record<string, unknown>> | null },
  targets: ReadonlyMap<string, PriorityTarget>,
): { priority: number; extensions: Readonly<Record<string, unknown>> } | null {
  if (entry.priority !== 0) return null;
  const stamp = entry.extensions?.['_risu_source_hash'];
  if (typeof stamp !== 'string') return null;
  const target = targets.get(stamp);
  if (!target) return null;
  return {
    priority: target.priority,
    extensions: { ...entry.extensions, _risu_source_hash: target.sourceHash },
  };
}
