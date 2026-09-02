import { afterEach, describe, expect, test } from 'bun:test';

import type { UserStorageLike } from '../payload/installer.js';
import { writeStoredZip } from '../realm/import-formats/zip-writer.js';
import { createImportCardOrchestrator } from './import-card.js';

interface UploadItem {
  readonly data: Uint8Array;
  readonly filename?: string;
  readonly owner_character_id?: string;
  readonly skip_thumbnail_processing?: boolean;
}

interface HarnessOptions {
  readonly worldBook?: boolean;
  readonly avatar?: boolean;
  readonly skipAssetThumbnails?: boolean;
  readonly uploadMany?: (
    items: readonly UploadItem[],
    call: number,
  ) => Promise<Array<{ id?: string; error?: string }>>;
}

function cardBytes(
  lore: boolean,
  avatar: boolean,
  assetSizes: readonly number[] = [],
): Uint8Array {
  const data: Record<string, unknown> = {
    name: 'Ada',
    description: '',
    personality: '',
    scenario: '',
    first_mes: 'Hello',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '1',
    extensions: {},
  };
  if (lore) {
    data.character_book = {
      entries: [{ keys: ['key'], comment: 'Lore', content: 'Value', insertion_order: 1 }],
    };
  }
  if (avatar) {
    data.assets = [{ type: 'icon', name: 'main', uri: 'embeded://avatar.png', ext: 'png' }];
  }
  const entries = [{
    name: 'card.json',
    data: new TextEncoder().encode(JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data,
    })),
  }];
  if (avatar) entries.push({ name: 'avatar.png', data: Uint8Array.of(1, 2, 3) });
  for (let index = 0; index < assetSizes.length; index++) {
    entries.push({ name: `asset-${index}.bin`, data: new Uint8Array(assetSizes[index]!) });
  }
  return writeStoredZip(entries);
}

function memoryStorage(values: Map<string, unknown>): UserStorageLike {
  return {
    async getJson<T>(path: string, options?: { fallback?: T }) {
      return (values.has(path) ? values.get(path) : options?.fallback) as T;
    },
    async setJson(path, value) { values.set(path, value); },
    async delete(path) { values.delete(path); },
  };
}

function harness(options: HarnessOptions = {}) {
  const trace: string[] = [];
  const characterInputs: Record<string, unknown>[] = [];
  const characterUpdates: Record<string, unknown>[] = [];
  const batches: UploadItem[][] = [];
  const sent: Array<{
    type: string;
    phase?: string;
    message?: string;
    fraction?: number | null;
    error?: string;
  }> = [];
  const warnings: string[] = [];
  const storageValues = new Map<string, unknown>();
  const worldBookIds = new Map<string, readonly string[]>();
  const spindleMock = {
    characters: {
      async create(input: Record<string, unknown>) {
        trace.push('characters.create');
        characterInputs.push(input);
        return { id: 'char-1' };
      },
      async update(_id: string, input: Record<string, unknown>) {
        trace.push('characters.update');
        characterUpdates.push(input);
        return { id: 'char-1' };
      },
      async setAvatar() {
        trace.push('characters.setAvatar');
        if (options.avatar) throw new Error('avatar failed');
        return { id: 'char-1', image_id: 'avatar-1' };
      },
    },
    world_books: {
      async create() {
        trace.push('world_books.create');
        if (options.worldBook) throw new Error('world book failed');
        return { id: 'wb-1' };
      },
      async update() { trace.push('world_books.update'); return { id: 'wb-1' }; },
      entries: {
        async create() { trace.push('world_books.entries.create'); return { id: 'entry-1' }; },
      },
    },
    images: {
      async uploadMany(items: readonly UploadItem[]) {
        trace.push('images.uploadMany');
        batches.push([...items]);
        const call = batches.length;
        return options.uploadMany
          ? options.uploadMany(items, call)
          : items.map((_, index) => ({ id: `asset-${(call - 1) * 64 + index + 1}` }));
      },
    },
    regex_scripts: {},
  };
  (globalThis as { spindle?: unknown }).spindle = spindleMock;
  const orchestrator = createImportCardOrchestrator({
    extensionVersion: 'test',
    userStorage: () => memoryStorage(storageValues),
    requestConsent: async () => ({ confirmed: true }),
    worldBookIdsByCharacter: worldBookIds,
    pendingImportCompletions: new Map(),
    enterAssetUpload: () => {},
    exitAssetUpload: () => {},
    getSkipAssetThumbnails: async () => options.skipAssetThumbnails === true,
    nudgeGc: () => {},
    refreshRisuAssetMap: async () => {},
    send: (message) => sent.push(message as typeof sent[number]),
    listCards: async () => [],
    pushCards: () => {},
    toastFor: (_userId, _kind, message) => warnings.push(message),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  });
  return {
    orchestrator,
    trace,
    characterInputs,
    characterUpdates,
    batches,
    sent,
    warnings,
    storageValues,
    worldBookIds,
  };
}

afterEach(() => {
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe('card import current APIs', () => {
  test('delegates through current APIs in supported-host order', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(cardBytes(true, true), 'card.charx', 'user-1');

    expect(h.trace).toEqual([
      'world_books.create',
      'characters.create',
      'world_books.update',
      'characters.setAvatar',
      'images.uploadMany',
      'world_books.entries.create',
      'characters.update',
    ]);
    expect(h.characterInputs[0]?.world_book_ids).toEqual(['wb-1']);
    expect(h.worldBookIds.get('char-1')).toEqual(['wb-1']);
    expect(h.sent.some((message) => message.phase === 'done')).toBe(true);
  });

  test('does not call lore or avatar APIs when card data omits them', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(cardBytes(false, false), 'card.charx', 'user-1');

    expect(h.trace).toEqual(['characters.create', 'characters.update']);
    expect(h.characterInputs[0]?.world_book_ids).toBeUndefined();
    expect(h.worldBookIds.size).toBe(0);
    expect(h.warnings).toEqual([]);
  });

  test('keeps world-book and avatar RPC failures nonfatal', async () => {
    const h = harness({ worldBook: true, avatar: true });
    await h.orchestrator.importCardFromBytes(cardBytes(true, true), 'card.charx', 'user-1');

    expect(h.trace).toEqual([
      'world_books.create',
      'characters.create',
      'characters.setAvatar',
      'images.uploadMany',
      'characters.update',
    ]);
    expect(h.characterInputs[0]?.world_book_ids).toBeUndefined();
    expect(h.warnings).toEqual([
      'Failed to create world book: world book failed. Lorebook entries skipped.',
      'Failed to set character avatar: avatar failed',
    ]);
    expect(h.sent.some((message) => message.phase === 'done')).toBe(true);
    expect(h.sent.some((message) => message.phase === 'error')).toBe(false);
  });

  test('uploads 65 assets in stable 64-item batches with journaled progress', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(
      cardBytes(false, false, Array(65).fill(1)),
      'card.charx',
      'user-1',
    );

    expect(h.batches.map((batch) => batch.length)).toEqual([64, 1]);
    expect(h.batches.flat().map((item) => item.filename)).toEqual(
      Array.from({ length: 65 }, (_, index) => `asset-${index}.bin`),
    );
    expect(h.batches.flat().every((item) => item.owner_character_id === 'char-1')).toBe(true);
    expect(h.sent.filter((message) => message.message?.startsWith('Uploading assets (')))
      .toMatchObject([
        { message: 'Uploading assets (64/65)…' },
        { message: 'Uploading assets (65/65)…' },
      ]);
    expect(h.storageValues.get('lumirealm/image_journal/char-1.json')).toMatchObject({
      imageIds: Array.from({ length: 65 }, (_, index) => `asset-${index + 1}`),
    });
  });

  test('skipAssetThumbnails setting stamps skip_thumbnail_processing on every asset item', async () => {
    const h = harness({ skipAssetThumbnails: true });
    await h.orchestrator.importCardFromBytes(
      cardBytes(false, false, [1, 1, 1]),
      'card.charx',
      'user-1',
    );

    expect(h.batches.flat()).toHaveLength(3);
    expect(h.batches.flat().every((item) => item.skip_thumbnail_processing === true)).toBe(true);
  });

  test('default settings leave skip_thumbnail_processing off asset items', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(
      cardBytes(false, false, [1, 1]),
      'card.charx',
      'user-1',
    );

    expect(h.batches.flat()).toHaveLength(2);
    expect(h.batches.flat().every((item) => item.skip_thumbnail_processing === undefined)).toBe(true);
  });

  test('starts a new batch after the 16 MiB byte boundary', async () => {
    const h = harness();
    await h.orchestrator.importCardFromBytes(
      cardBytes(false, false, [16 * 1024 * 1024, 1]),
      'card.charx',
      'user-1',
    );

    expect(h.batches.map((batch) => batch.map((item) => item.data.byteLength))).toEqual([
      [16 * 1024 * 1024],
      [1],
    ]);
    expect(h.batches.flat().map((item) => item.filename)).toEqual([
      'asset-0.bin',
      'asset-1.bin',
    ]);
  });

  test('keeps partial and thrown batch failures nonfatal', async () => {
    const h = harness({
      uploadMany: async (items, call) => {
        if (call === 2) throw new Error('batch failed');
        return items.map((_, index) => index === 1
          ? { error: 'item failed' }
          : { id: `asset-${index + 1}` });
      },
    });
    await h.orchestrator.importCardFromBytes(
      cardBytes(false, false, Array(65).fill(1)),
      'card.charx',
      'user-1',
    );

    expect(h.batches.map((batch) => batch.length)).toEqual([64, 1]);
    expect(h.warnings).toEqual([
      '2 of 65 asset upload(s) failed; the card will work but may render fallback art.',
    ]);
    expect(h.sent.filter((message) => message.message?.startsWith('Uploading assets (')))
      .toMatchObject([
        { message: 'Uploading assets (64/65)…' },
        { message: 'Uploading assets (65/65)…' },
      ]);
    expect(h.sent.some((message) => message.phase === 'done')).toBe(true);
    expect(h.sent.some((message) => message.phase === 'error')).toBe(false);
    const extension = h.characterUpdates.at(-1)?.extensions as {
      lumirealm?: { source?: { path_to_image_id?: Record<string, string> } };
    };
    const pathToImageId = extension.lumirealm?.source?.path_to_image_id;
    expect(Object.keys(pathToImageId ?? {})).toHaveLength(63);
    expect(pathToImageId?.['asset-1.bin']).toBeUndefined();
    expect(pathToImageId?.['asset-64.bin']).toBeUndefined();
    expect(h.storageValues.get('lumirealm/image_journal/char-1.json')).toMatchObject({
      imageIds: Array.from({ length: 64 }, (_, index) => index + 1)
        .filter((id) => id !== 2)
        .map((id) => `asset-${id}`),
    });
  });
});
