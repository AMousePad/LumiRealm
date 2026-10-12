export interface JournalStorageBasic {
  getJson<T>(
    path: string,
    opts?: { fallback?: T; userId?: string | undefined },
  ): Promise<T>;
  setJson(
    path: string,
    value: unknown,
    opts?: { userId?: string | undefined },
  ): Promise<void>;
  delete(path: string, userId?: string): Promise<void>;
}

export interface JournalStorage extends JournalStorageBasic {
  list(prefix: string, userId?: string): Promise<readonly string[]>;
}

export type ImageJournalStatus = 'active' | 'pending_delete';
export type ImageJournal<K extends string> = {
  schema_version: 1;
  imageIds: readonly string[];
  status: ImageJournalStatus;
  updated_at: number;
} & Record<K, string>;

export function createImageJournal<K extends 'characterId' | 'moduleId'>(directory: string, idKey: K) {
  const path = (id: string) => `${directory}/${id}.json`;
  const scope = (userId: string | undefined) => userId !== undefined ? { userId } : {};
  async function read(storage: JournalStorageBasic, userId: string | undefined, id: string): Promise<ImageJournal<K> | null> {
    const value = await storage.getJson<unknown>(path(id), { fallback: null, ...scope(userId) });
    if (!value || typeof value !== 'object') return null;
    const file = value as ImageJournal<K>;
    return file.schema_version === 1 && typeof file[idKey] === 'string' && Array.isArray(file.imageIds)
      && (file.status === 'active' || file.status === 'pending_delete') ? file : null;
  }
  return {
    read,
    async append(storage: JournalStorageBasic, userId: string | undefined, id: string, newIds: readonly string[]): Promise<void> {
      const cleanIds = newIds.filter(id => typeof id === 'string' && id.length > 0);
      if (cleanIds.length === 0) return;
      const existing = await read(storage, userId, id);
      if (existing?.status === 'pending_delete') return;
      const current = existing?.imageIds ?? [];
      const imageIds = Array.from(new Set([...current, ...cleanIds]));
      if (existing && imageIds.length === current.length) return;
      await storage.setJson(path(id), { schema_version: 1, [idKey]: id, imageIds, status: 'active', updated_at: Date.now() }, scope(userId));
    },
    async clear(storage: JournalStorageBasic, userId: string | undefined, id: string): Promise<void> {
      try { await storage.delete(path(id), userId); } catch { /* Already gone. */ }
    },
    async list(storage: JournalStorage, userId: string | undefined): Promise<readonly string[]> {
      let names: readonly string[];
      try { names = await storage.list(directory, userId); } catch { return []; }
      return names.filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/i, ''));
    },
  };
}
