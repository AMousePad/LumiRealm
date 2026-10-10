import { describe, test, expect } from 'bun:test';
import { createRegexImporter } from '../../src/state/regex-import.js';
import { createImportTextHandlers } from '../../src/handlers/import-text.js';
import { parseDirectRegex } from '../../src/payload/regex-direct-import.js';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { sendImportText } from '../../src/ui/import-text-upload.js';
import type { BackendToFrontend, FrontendToBackend } from '../../src/types/messages.js';

function makeImporter() {
  const sent: BackendToFrontend[] = [];
  const importer = createRegexImporter({
    send: (msg) => { sent.push(msg); },
    log: { info: () => {}, warn: () => {} },
    errMsg: (e) => String(e),
    parseDirectRegex,
    mapRegex,
    regexApi: {
      list: async () => ({ data: [], total: 0 }),
      create: async (input) => ({ ...input, id: crypto.randomUUID() }) as never,
      update: async (_id, input) => ({ ...input, id: _id }) as never,
    },
  });
  return { importer, sent };
}

const REGEX_FILE = JSON.stringify({
  type: 'regex',
  data: [
    { comment: 'r1', in: '/foo/', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: true },
    { comment: 'r2', in: '/baz/', out: 'qux', type: 'editoutput' },
  ],
});

describe('createRegexImporter', () => {
  test('global import → scope global, scope_id null, imported_regex marker', async () => {
    const { importer, sent } = makeImporter();
    await importer.handle({ type: 'import_regex', json: REGEX_FILE, filename: 'mypack.json' }, 'u1');
    expect(sent).toHaveLength(1);
    const msg = sent[0] as Extract<BackendToFrontend, { type: 'standalone_regex_install' }>;
    expect(msg.ok).toBe(true);
    expect(msg.characterId).toBe(null);
    expect(msg.folder).toBe('mypack');
    expect(msg.scripts.length).toBeGreaterThanOrEqual(2);
    for (const s of msg.scripts) {
      expect(s.scope).toBe('global');
      expect(s.scope_id).toBe(null);
      expect(s.folder).toBe('mypack');
      expect((s.metadata as { _risu?: { imported_regex?: boolean } })._risu?.imported_regex).toBe(true);
    }
  });

  test('character import → scope character, scope_id = characterId', async () => {
    const { importer, sent } = makeImporter();
    await importer.handle({ type: 'import_regex', json: REGEX_FILE, filename: 'p.json', characterId: 'char-9' }, 'u1');
    const msg = sent[0] as Extract<BackendToFrontend, { type: 'standalone_regex_install' }>;
    expect(msg.ok).toBe(true);
    expect(msg.characterId).toBe('char-9');
    for (const s of msg.scripts) {
      expect(s.scope).toBe('character');
      expect(s.scope_id).toBe('char-9');
    }
  });

  test('unknown format → ok:false with reason', async () => {
    const { importer, sent } = makeImporter();
    await importer.handle({ type: 'import_regex', json: '{"nope":1}', filename: 'x.json' }, 'u1');
    const msg = sent[0] as Extract<BackendToFrontend, { type: 'standalone_regex_install' }>;
    expect(msg.ok).toBe(false);
    expect(msg.scripts).toHaveLength(0);
    expect(msg.reason).toBeTruthy();
  });
});

describe('createImportTextHandlers — tus upload redemption', () => {
  function makeCtx() {
    const sent: BackendToFrontend[] = [];
    return {
      sent,
      ctx: {
        userId: 'u1',
        send: (msg: BackendToFrontend) => { sent.push(msg); },
        log: { info: () => {}, warn: () => {}, error: () => {} },
        errMsg: (e: unknown) => String(e),
      },
    };
  }

  function makeHandlers(uploads: Record<string, string>) {
    const regexCalls: Array<Extract<FrontendToBackend, { type: 'import_regex' }>> = [];
    const lorebookCalls: unknown[] = [];
    const deleted: string[] = [];
    const handlers = createImportTextHandlers({
      regexImporter: { handle: async (m) => { regexCalls.push(m); } },
      lorebookImporter: { handle: async (m) => { lorebookCalls.push(m); } },
      getUpload: async (uploadId) => {
        const text = uploads[uploadId];
        if (text === undefined) return null;
        const data = new TextEncoder().encode(text);
        return { fileName: 'up.json', size: data.byteLength, data };
      },
      deleteUpload: async (uploadId) => { deleted.push(uploadId); return true; },
    });
    return { handlers, regexCalls, lorebookCalls, deleted };
  }

  test('decodes upload bytes and dispatches to regex importer, then deletes', async () => {
    const full = '{"type":"regex","data":[]}';
    const { handlers, regexCalls, deleted } = makeHandlers({ up1: full });
    const { ctx } = makeCtx();
    await handlers.import_text_from_upload(
      { type: 'import_text_from_upload', uploadId: 'up1', kind: 'regex', filename: 'big.json', characterId: 'c1' },
      ctx,
    );
    expect(regexCalls).toHaveLength(1);
    expect(regexCalls[0]!.json).toBe(full);
    expect(regexCalls[0]!.characterId).toBe('c1');
    expect(regexCalls[0]!.filename).toBe('big.json');
    expect(deleted).toEqual(['up1']);
  });

  test('missing upload → ok:false result, no dispatch', async () => {
    const { handlers, regexCalls } = makeHandlers({});
    const { ctx, sent } = makeCtx();
    await handlers.import_text_from_upload(
      { type: 'import_text_from_upload', uploadId: 'nope', kind: 'regex', characterId: null },
      ctx,
    );
    expect(regexCalls).toHaveLength(0);
    const msg = sent.find((m) => m.type === 'standalone_regex_install') as Extract<BackendToFrontend, { type: 'standalone_regex_install' }>;
    expect(msg.ok).toBe(false);
    expect(msg.reason).toContain('not found');
  });

  test('lorebook kind routes to the lorebook importer', async () => {
    const { handlers, lorebookCalls } = makeHandlers({ up2: '{"entries":[]}' });
    const { ctx } = makeCtx();
    await handlers.import_text_from_upload(
      { type: 'import_text_from_upload', uploadId: 'up2', kind: 'lorebook', characterId: null },
      ctx,
    );
    expect(lorebookCalls).toHaveLength(1);
  });
});

describe('sendImportText (FE)', () => {
  test('small payload → single message, no upload', async () => {
    const sent: FrontendToBackend[] = [];
    let uploaded = false;
    const r = await sendImportText(
      (m) => sent.push(m),
      { kind: 'regex', text: '{"type":"regex","data":[]}', filename: 'a.json', characterId: 'c1' },
      async () => { uploaded = true; return 'never'; },
    );
    expect(r.chunked).toBe(false);
    expect(uploaded).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('import_regex');
  });

  test('large payload → tus upload then import_text_from_upload', async () => {
    const sent: FrontendToBackend[] = [];
    const big = 'x'.repeat(2_000_000);
    let uploadedBytes = 0;
    const r = await sendImportText(
      (m) => sent.push(m),
      { kind: 'lorebook', text: big, filename: 'b.json', characterId: null },
      async (bytes) => { uploadedBytes = bytes.byteLength; return 'up-42'; },
    );
    expect(r.chunked).toBe(true);
    expect(uploadedBytes).toBe(big.length);
    expect(sent).toHaveLength(1);
    const msg = sent[0] as Extract<FrontendToBackend, { type: 'import_text_from_upload' }>;
    expect(msg.type).toBe('import_text_from_upload');
    expect(msg.uploadId).toBe('up-42');
    expect(msg.kind).toBe('lorebook');
    expect(msg.filename).toBe('b.json');
  });
});
