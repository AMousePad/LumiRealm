// Lorebook read/write helpers. Preloaded at runtime construction; mutations kept in sync.

import { toStr } from '../../util/coerce.js';
import type { HostApi, HostWorldInfoEntry } from '../host.js';

export interface LorebookCache {
  entries: (HostWorldInfoEntry & { worldBookId?: string })[];
  primaryBookId: string | null;
}

export interface LorebookApi {
  getLorebookCount(): number;
  getLorebookEntry(index: unknown): string;
  getLorebookByIndex(index: unknown): string;
  getLorebookByKey(target: unknown): string;
  getLorebookIndexViaName(name: unknown): number;
  getAllLorebooks(): string[];
  getLorebookByName(name: unknown): number[];
  modifyLorebook(target: unknown, value: unknown): Promise<void>;
  modifyLorebookByIndex(index: unknown, name: unknown, key: unknown, content: unknown, order: unknown): Promise<void>;
  createLorebook(name: unknown, key: unknown, content: unknown, order: unknown): Promise<void>;
  deleteLorebookByIndex(index: unknown): Promise<void>;
  setLorebookActivation(index: unknown, value: boolean): Promise<void>;
  setLorebookAlwaysActive(index: unknown, value: boolean): Promise<void>;
}

function keyToArray(k: unknown): string[] {
  if (Array.isArray(k)) return k.map(toStr).filter(Boolean);
  const s = toStr(k);
  return s ? s.split(',').map((p) => p.trim()).filter(Boolean) : [];
}

function risuArrayIndex(entry: HostWorldInfoEntry): number | null {
  const extensions = entry['extensions'];
  if (!extensions || typeof extensions !== 'object') return null;
  const value = (extensions as Record<string, unknown>)['_risu_array_index'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sortLorebookEntriesBySourceOrder<T extends HostWorldInfoEntry>(
  entries: readonly T[],
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, risuIndex: risuArrayIndex(entry) }))
    .sort((a, b) => {
      if (a.risuIndex !== null && b.risuIndex !== null) return a.risuIndex - b.risuIndex;
      if (a.risuIndex !== null) return -1;
      if (b.risuIndex !== null) return 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function makeLorebookApi(api: HostApi, lorebook: LorebookCache): LorebookApi {
  const characterEntries = (): (HostWorldInfoEntry & { worldBookId?: string })[] =>
    lorebook.primaryBookId
      ? lorebook.entries.filter((entry) => entry.worldBookId === lorebook.primaryBookId)
      : lorebook.entries;

  const replaceEntry = (
    entry: HostWorldInfoEntry & { worldBookId?: string },
    updated: HostWorldInfoEntry,
  ): void => {
    const index = lorebook.entries.indexOf(entry);
    if (index >= 0) lorebook.entries[index] = { ...entry, ...updated };
  };

  return {
    getLorebookCount(): number { return characterEntries().length; },

    getLorebookEntry(index: unknown): string {
      const numericIndex = Number(index);
      const e = characterEntries()[Number.isNaN(numericIndex) ? 0 : numericIndex];
      return e ? toStr(e.content) : 'null';
    },
    getLorebookByIndex(index: unknown): string {
      const numericIndex = Number(index);
      if (Number.isNaN(numericIndex) || numericIndex < 0) return 'null';
      const e = characterEntries()[numericIndex];
      return e ? toStr(e.content) : 'null';
    },

    getLorebookByKey(target: unknown): string {
      const needle = toStr(target).toLowerCase();
      for (const e of characterEntries()) {
        const keys = keyToArray(e.key);
        if (keys.some((k) => k.toLowerCase() === needle)) return toStr(e.content);
      }
      return 'null';
    },

    getLorebookIndexViaName(name: unknown): number {
      const needle = toStr(name);
      const entries = characterEntries();
      for (let i = 0; i < entries.length; i++) {
        if (toStr(entries[i]!.comment) === needle) return i;
      }
      return -1;
    },

    getAllLorebooks(): string[] {
      return characterEntries().map((e) => toStr(e.content));
    },

    getLorebookByName(name: unknown): number[] {
      const matcher = new RegExp(toStr(name), 'i');
      const out: number[] = [];
      const entries = characterEntries();
      for (let i = 0; i < entries.length; i++) {
        if (matcher.test(toStr(entries[i]!.comment))) out.push(i);
      }
      return out;
    },

    async modifyLorebook(target: unknown, value: unknown): Promise<void> {
      if (!api.worldInfo?.entries) return;
      const needle = toStr(target).toLowerCase();
      const entries = characterEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const keys = keyToArray(e.key);
        if (keys.some((k) => k.toLowerCase() === needle)) {
          try {
            const updated = await api.worldInfo.entries.update(e.id, {
              key: keys, content: toStr(value), comment: toStr(e.comment),
            });
            replaceEntry(e, updated);
          } catch { /* */ }
          return;
        }
      }
    },

    async modifyLorebookByIndex(index: unknown, name: unknown, key: unknown, content: unknown, order: unknown): Promise<void> {
      const e = characterEntries()[Number(index)];
      if (!e || !api.worldInfo?.entries) return;
      try {
        const oldOrder = Number(e.orderValue);
        const replacedOrder = toStr(order).replace(
          /{{slot}}/g,
          Number.isFinite(oldOrder) ? String(oldOrder) : '100',
        );
        const nextOrder = Number(replacedOrder);
        const updated = await api.worldInfo.entries.update(e.id, {
          comment: toStr(name).replace(/{{slot}}/g, toStr(e.comment)),
          key: keyToArray(toStr(key).replace(/{{slot}}/g, keyToArray(e.key).join(','))),
          content: toStr(content).replace(/{{slot}}/g, toStr(e.content)),
          ...(Number.isNaN(nextOrder) ? {} : { orderValue: nextOrder }),
        });
        replaceEntry(e, updated);
      } catch { /* */ }
    },

    async createLorebook(name: unknown, key: unknown, content: unknown, order: unknown): Promise<void> {
      if (!lorebook.primaryBookId || !api.worldInfo?.entries) return;
      try {
        const created = await api.worldInfo.entries.create(lorebook.primaryBookId, {
          comment: toStr(name),
          key: keyToArray(key),
          content: toStr(content),
          orderValue: Number.isNaN(Number(order)) ? 100 : Number(order),
        });
        lorebook.entries.push({ ...created, worldBookId: lorebook.primaryBookId });
      } catch { /* */ }
    },

    async deleteLorebookByIndex(index: unknown): Promise<void> {
      const e = characterEntries()[Number(index)];
      if (!e || !api.worldInfo?.entries) return;
      try {
        await api.worldInfo.entries.delete(e.id);
        const actualIndex = lorebook.entries.indexOf(e);
        if (actualIndex >= 0) lorebook.entries.splice(actualIndex, 1);
      } catch { /* */ }
    },

    async setLorebookActivation(index: unknown, value: boolean): Promise<void> {
      const e = characterEntries()[Number(index)];
      if (!e || !api.worldInfo?.entries) return;
      try {
        const updated = await api.worldInfo.entries.update(e.id, {
          key: keyToArray(e.key), content: toStr(e.content), comment: toStr(e.comment), disabled: !value,
        });
        replaceEntry(e, updated);
      } catch { /* */ }
    },

    async setLorebookAlwaysActive(index: unknown, value: boolean): Promise<void> {
      const e = characterEntries()[Number(index)];
      if (!e || !api.worldInfo?.entries) return;
      try {
        const updated = await api.worldInfo.entries.update(e.id, {
          key: keyToArray(e.key), content: toStr(e.content), comment: toStr(e.comment), constant: !!value,
        });
        replaceEntry(e, updated);
      } catch { /* */ }
    },
  };
}
