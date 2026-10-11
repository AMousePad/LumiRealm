import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { searchRealm, getRealmInfo } from '../../src/realm/api.js';
import type { SpindleAPI } from 'lumiverse-spindle-types';

const root = resolve(process.env.LUMIVERSE_DIR ?? '../Lumiverse');
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const { env } = await load('src/env.ts');
const { WorkerHost } = await load('src/spindle/worker-host.ts');
const { initDatabase, getDb, closeDatabase } = await load('src/db/connection.ts');
const { imagesRoutes } = await load('src/routes/images.routes.ts');
const directory = await mkdtemp(join(tmpdir(), 'lumirealm-content-live-'));
env.dataDir = directory;
const host = new WorkerHost('content-test', { identifier: 'content-test', name: 'Content test' }, {
  id: 'content-test', identifier: 'content-test', metadata: { install_scope: 'user', installed_by_user_id: 'user' },
});
host.hasPermission = () => true;
const pending = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>();
host.runtime = { mode: 'worker', pid: null, terminate() {}, postMessage(message: { requestId: string; error?: string; result?: unknown }) {
  const request = pending.get(message.requestId)!;
  pending.delete(message.requestId);
  if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
} };
function call<T>(message: Record<string, unknown>): Promise<T> {
  const requestId = crypto.randomUUID();
  const result = Promise.withResolvers<unknown>();
  pending.set(requestId, result);
  host.handleMessage({ ...message, requestId });
  return result.promise as Promise<T>;
}
const runtime = globalThis as typeof globalThis & { spindle?: Pick<SpindleAPI, 'cors'> };
const originalSpindle = runtime.spindle;
runtime.spindle = { cors: (url, options) => call({ type: 'cors_request', url, options }) };
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  initDatabase(':memory:');
  getDb().run('CREATE TABLE images (id TEXT PRIMARY KEY, user_id TEXT, filename TEXT, mime_type TEXT)');
  await mkdir(join(directory, 'images'));
  const bytes = new Uint8Array(50 * 1024 ** 2).fill(123);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  await Bun.write(join(directory, 'images', 'original.png'), bytes);
  getDb().run("INSERT INTO images VALUES ('original', 'user', 'original.png', 'image/png')");
  // Hono middleware supplies the same authenticated user used by the worker.
  const { Hono } = await import(pathToFileURL(join(root, 'node_modules/hono/dist/index.js')).href);
  const app = new Hono();
  app.use('*', (c: any, next: () => Promise<void>) => { c.set('userId', 'user'); return next(); });
  app.route('/images', imagesRoutes);
  server = Bun.serve({ port: 0, fetch: app.fetch });
  const response = await fetch(new URL('/images/original', server.url));
  assert.equal(response.status, 200);
  const oldBytes = new Uint8Array(await response.arrayBuffer());
  const nativeBytes = await call<Uint8Array>({ type: 'images_read_binary', imageId: 'original' });
  assert.equal(Bun.hash(nativeBytes), Bun.hash(oldBytes));
  assert.equal(nativeBytes.length, bytes.length);
  console.log('50 MiB original image: REST and Spindle return identical bytes');
  const results = await searchRealm({ search: '', page: 0, nsfw: false, sort: 'downloads' });
  assert(results.cards.length > 0);
  const info = await getRealmInfo(results.cards[0]!.id);
  assert(info && typeof info === 'object');
  console.log(`Live Realm search and detail through spindle.cors: ${results.cards.length} results`);
} finally {
  if (originalSpindle) runtime.spindle = originalSpindle;
  else delete runtime.spindle;
  server?.stop(true);
  closeDatabase();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert(basename(directory).startsWith('lumirealm-content-live-'));
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
