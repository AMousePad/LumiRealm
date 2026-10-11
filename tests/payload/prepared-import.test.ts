import { expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { importCard, type SpindleImportApi } from '../../src/payload/import.js';
import { withStagedCard } from '../../src/core/charx/staged-reader.js';
import { stageBytes } from '../../src/host-services/files.js';
import { stagedHost } from '../helpers/staged-host.js';
import type { UserStorageLike } from '../../src/payload/installer.js';

test('prepared import uploads the same avatar and assets as buffered import', async () => {
  const bytes = zipSync({
    'card.json': new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Example', assets: [{ type: 'icon', uri: 'embeded://assets/icon/main.png', name: 'main', ext: 'png' }] } })),
    'assets/icon/main.png': Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1),
    'assets/extra.bin': Uint8Array.of(0, 128, 255),
  });
  function dependencies() {
    const calls: unknown[] = [];
    const unused = async (): Promise<never> => { throw new Error('Unexpected lore operation'); };
    const spindle: SpindleImportApi = {
      characters: {
        async create(input) { calls.push(input); return { id: 'character' }; },
        async update() {},
        async setAvatar(_id, input) { calls.push(input); return { id: 'character', image_id: 'avatar' }; },
      },
      world_books: { create: unused, update: unused, entries: { create: unused } },
      images: { async uploadMany(items) { calls.push(items); return items.map((_, i) => ({ id: `image-${i}` })); } },
    };
    const userStorage: UserStorageLike = { async getJson<T>(_path: string, opts?: { fallback?: T }) { return opts?.fallback as T; }, async setJson() {}, async delete() {} };
    return { calls, spindle, userStorage };
  }
  const buffered = dependencies();
  const staged = dependencies();
  const options = { fileName: 'example.charx', extensionVersion: 'test', userId: 'user' };
  await importCard({ ...options, ...buffered, bytes });
  const { host } = stagedHost();
  const source = await stageBytes(host.files, bytes, options.fileName, 'user');
  await withStagedCard(host, { fileId: source.fileId }, options.fileName, 'user', async prepared => {
    await importCard({ ...options, ...staged, prepared });
  });
  expect(staged.calls).toEqual(buffered.calls);
});
