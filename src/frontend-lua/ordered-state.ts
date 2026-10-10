export interface StateRevision { readonly epoch: string; readonly sequence: number }
export type StatePatch = ReadonlyMap<string, unknown>;
interface PendingValue { value: unknown; previous?: PendingValue | undefined; next?: PendingValue | undefined }
interface PendingField { values: Map<symbol, PendingValue>; last?: PendingValue | undefined }

export function sameStateValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => Object.hasOwn(right, key)
    && sameStateValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export class RuntimeStateEpochError extends Error {
  constructor() { super('The runtime state belongs to a previous host connection'); this.name = 'RuntimeStateEpochError'; }
}

/** Persistence acknowledgements only retire their own optimistic mutation. */
export class OrderedRuntimeState {
  private readonly confirmed = new Map<string, unknown>();
  private readonly visible = new Map<string, unknown>();
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<symbol, Map<string, unknown>>();
  private readonly pendingByKey = new Map<string, PendingField>();
  private readonly epoch: string;
  private readonly initialSequence: number;

  constructor(revision: StateRevision, initial: StatePatch, private readonly changed: (keys: readonly string[]) => void) {
    this.epoch = revision.epoch;
    this.initialSequence = revision.sequence;
    for (const [key, value] of initial) { this.confirmed.set(key, value); this.visible.set(key, value); }
  }

  get(key: string): unknown {
    return this.visible.get(key);
  }

  keys(): string[] {
    return [...this.visible.keys()];
  }

  private publish(keys: Iterable<string>): void {
    const changed: string[] = [];
    for (const key of keys) {
      let value = this.confirmed.get(key);
      const pending = this.pendingByKey.get(key);
      if (pending?.last) value = pending.last.value;
      // Host JSON replies recreate objects even when their stored values have not changed.
      if (!sameStateValue(this.visible.get(key), value)) { this.visible.set(key, value); changed.push(key); }
    }
    if (changed.length) this.changed(changed);
  }

  apply(revision: StateRevision, patch: StatePatch): void {
    if (revision.epoch !== this.epoch) throw new RuntimeStateEpochError();
    const changed: string[] = [];
    for (const [key, value] of patch) {
      if (revision.sequence < (this.revisions.get(key) ?? this.initialSequence)) continue;
      this.revisions.set(key, revision.sequence);
      this.confirmed.set(key, value);
      changed.push(key);
    }
    if (changed.length) this.publish(changed);
  }

  begin(patch: StatePatch): symbol {
    const id = Symbol();
    this.pending.set(id, new Map(patch));
    for (const [key, value] of patch) {
      const pending = this.pendingByKey.get(key) ?? { values: new Map<symbol, PendingValue>() };
      const node: PendingValue = { value, previous: pending.last };
      if (pending.last) pending.last.next = node;
      pending.last = node;
      pending.values.set(id, node);
      this.pendingByKey.set(key, pending);
    }
    this.publish(patch.keys());
    return id;
  }

  settle(id: symbol, revision: StateRevision, patch: StatePatch): void {
    this.settleMany([id], revision, patch);
  }

  settleMany(ids: readonly symbol[], revision: StateRevision, patch: StatePatch, partialId?: symbol): void {
    if (ids.some(id => !this.pending.has(id))) throw new Error('Unknown runtime state mutation');
    if (revision.epoch !== this.epoch) throw new RuntimeStateEpochError();
    // Publish once, after removing this mutation, so display cannot observe an older intermediate state.
    for (const [key, value] of patch) {
      if (revision.sequence < (this.revisions.get(key) ?? this.initialSequence)) continue;
      this.revisions.set(key, revision.sequence);
      this.confirmed.set(key, value);
    }
    const changed = new Set([...ids.flatMap(id => [...this.pending.get(id)!.keys()]), ...patch.keys()]);
    for (const id of ids) this.remove(id);
    if (partialId && this.pending.has(partialId)) this.remove(partialId, patch.keys());
    this.publish(changed);
  }

  discard(id: symbol): void {
    const patch = this.pending.get(id);
    if (patch) { const keys = [...patch.keys()]; this.remove(id); this.publish(keys); }
  }

  private remove(id: symbol, keys?: Iterable<string>): void {
    const patch = this.pending.get(id)!;
    for (const key of keys ?? patch.keys()) {
      if (!patch.has(key)) continue;
      const pending = this.pendingByKey.get(key)!;
      const node = pending.values.get(id)!;
      if (node.previous) node.previous.next = node.next;
      if (node.next) node.next.previous = node.previous;
      else pending.last = node.previous;
      pending.values.delete(id);
      if (!pending.values.size) this.pendingByKey.delete(key);
      patch.delete(key);
    }
    if (!keys) this.pending.delete(id);
  }
}
