import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SpindleAPI, SpindleFileRef } from 'lumiverse-spindle-types';
import { stageBytes, readStagedBytes } from '../../src/host-services/files.js';
import { withStagedCard } from '../../src/core/charx/staged-reader.js';
import { readCharx } from '../../src/core/charx/reader.js';

// Run separately against a current Lumiverse checkout; never use its application data.
const root = resolve(process.env.LUMIVERSE_DIR ?? '../Lumiverse');
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const { env } = await load('src/env.ts');
const { WorkerHostFilesApi } = await load('src/spindle/worker-host-files-api.ts');
const { getStagedFile } = await load('src/spindle/files.ts');
const directory = await mkdtemp(join(tmpdir(), 'lumirealm-files-live-'));
env.dataDir = directory;
const pending = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>();
const api = new WorkerHostFilesApi({
  extensionId: 'live-test', identifier: 'live-test', hasPermission: () => true,
  resolveEffectiveUserId: () => 'user', enforceScopedUser: (id: string) => assert.equal(id, 'user'),
  postResponse(message: { requestId: string; error?: string; result?: unknown }) {
    const request = pending.get(message.requestId)!;
    pending.delete(message.requestId);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
  },
});
function call<T>(message: Record<string, unknown>): Promise<T> {
  const requestId = crypto.randomUUID();
  const result = Promise.withResolvers<unknown>();
  pending.set(requestId, result);
  api.dispatch({ ...message, requestId });
  return result.promise as Promise<T>;
}
const host = {
  files: {
    create: input => call({ type: 'files_create', input }),
    writeChunk: (fileId, offset, data, userId) => call({ type: 'files_write_chunk', fileId, offset, data, userId }),
    finish: (fileId, userId) => call({ type: 'files_finish', fileId, userId }),
    readChunk: (source, offset, userId) => call({ type: 'files_read_chunk', source, offset, userId }),
    delete: (fileId, userId) => call({ type: 'files_delete', fileId, userId }),
  },
  archives: {
    create: (entries, options) => call({ type: 'archives_create', entries, options }),
    extract: (source, options) => call({ type: 'archives_extract', source, options }),
  },
} as Pick<SpindleAPI, 'files' | 'archives'>;
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const mode = process.argv[2] ?? 'staged';
  const count = mode === 'large' ? 128 : 8;
  const assetSize = mode === 'large' ? 40 * 1024 ** 2 : 32 * 1024 ** 2;
  const bytes = new Uint8Array(assetSize).fill(123);
  const asset = await stageBytes(host.files, bytes, 'asset.bin', 'user');
  const card = await stageBytes(host.files, new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Synthetic' } })), 'card.json', 'user');
  const archive = await host.archives.create([
    { name: 'card.json', source: { fileId: card.fileId } },
    ...Array.from({ length: count }, (_, i) => ({ name: `assets/${i}.bin`, source: { fileId: asset.fileId }, store: true })),
  ], { userId: 'user', maxBytes: count * assetSize + 1024 ** 2 });
  let headerSeen = false;
  server = Bun.serve({ port: 0, fetch(request) {
    headerSeen = request.headers.get('x-risu-api-version') === '4';
    return new Response(Bun.file(getStagedFile(archive.fileId).path), { headers: { 'content-type': 'application/zip' } });
  } });
  const downloaded = await call<SpindleFileRef>({ type: 'files_fetch', url: server.url.href, options: { userId: 'user', maxBytes: 10 * 1024 ** 3, headers: { 'x-risu-api-version': '4' } } });
  assert(headerSeen);
  assert.equal(downloaded.size, archive.size);
  Bun.gc(true);
  const start = performance.now();
  let peak = process.memoryUsage().rss;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
  const timer = setInterval(sample, 5);
  try {
    if (mode === 'buffered') {
      const input = await readStagedBytes(host.files, { fileId: downloaded.fileId }, 'user', 1024 ** 3);
      const bundle = readCharx(input);
      assert.equal(bundle.assets.size, count);
      for (const data of bundle.assets.values()) assert.equal(data.length, assetSize);
      sample();
    } else {
      await withStagedCard(host, { fileId: downloaded.fileId }, 'card.charx', 'user', async prepared => {
        assert.equal(prepared.assets.size, count);
        for (const asset of prepared.assets.values()) {
          const data = await asset.read();
          assert.equal(data.length, assetSize);
          assert.equal(Bun.hash(data), Bun.hash(bytes));
          sample();
        }
      });
    }
  } finally { clearInterval(timer); }
  console.log(JSON.stringify({ mode, archiveBytes: archive.size, assets: count, elapsedMs: Math.round(performance.now() - start), peakRssMiB: Math.round(peak / 1024 ** 2) }));
} finally {
  server?.stop(true);
  await api.dispose();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert(basename(directory).startsWith('lumirealm-files-live-'));
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
