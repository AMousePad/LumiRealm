import { describe, test, expect } from 'bun:test';
import {
  createModuleUploader,
  type ModuleUploaderDeps,
  type DecodedRisum,
  type ImageUploadInput,
  type ImageUploadResult,
  type SchemaParseResult,
  type UploadProgressFrame,
} from '../../src/state/module-upload.js';
import type { ModuleEnvelope } from '../../src/state/modules-store.js';
import type { RisuModule } from '../../src/core/schemas/module.js';

interface MockState {
  decodeCalls: number;
  charxDecodeCalls: number;
  parseCalls: number;
  uuidCalls: number;
  consentCalls: Array<{ title: string; userId: string }>;
  uploadOneCalls: Array<{ filename: string; mime: string; userId: string }>;
  uploadManyCalls: Array<{ items: readonly ImageUploadInput[]; userId: string }>;
  journalAppends: Array<{ moduleId: string; ids: readonly string[] }>;
  syncWorldBookCalls: Array<{ envId: string; userId: string }>;
  writeEnvelopeCalls: ModuleEnvelope[];
  progressFrames: Array<{ frame: UploadProgressFrame; userId: string }>;
  warns: string[];
  infos: string[];
}

function defaultModuleBody(): RisuModule {
  return {
    name: 'TestModule',
    description: 'd',
    id: 'src-id-aaa',
    lorebook: undefined,
    regex: undefined,
    cjs: undefined,
    trigger: undefined,
    lowLevelAccess: undefined,
    hideIcon: undefined,
    backgroundEmbedding: undefined,
    assets: undefined,
    namespace: undefined,
    customModuleToggle: undefined,
    mcp: undefined,
  } as unknown as RisuModule;
}

function makeMockDeps(overrides: {
  decoded?: DecodedRisum;
  decodedCharx?: DecodedRisum;
  parse?: SchemaParseResult;
  uuid?: () => string;
  consent?: ModuleUploaderDeps['requestConsent'];
  uploadOne?: ModuleUploaderDeps['uploadImageOne'];
  uploadMany?: ModuleUploaderDeps['uploadImageMany'];
  syncWorldBook?: ModuleUploaderDeps['syncWorldBook'];
  writeEnvelope?: ModuleUploaderDeps['writeEnvelope'];
  appendToJournal?: ModuleUploaderDeps['appendToJournal'];
  sniff?: ModuleUploaderDeps['sniffImageMime'];
  skipAssetThumbnails?: boolean;
} = {}): { deps: ModuleUploaderDeps; state: MockState } {
  const state: MockState = {
    decodeCalls: 0,
    charxDecodeCalls: 0,
    parseCalls: 0,
    uuidCalls: 0,
    consentCalls: [],
    uploadOneCalls: [],
    uploadManyCalls: [],
    journalAppends: [],
    syncWorldBookCalls: [],
    writeEnvelopeCalls: [],
    progressFrames: [],
    warns: [],
    infos: [],
  };
  const decoded: DecodedRisum = overrides.decoded ?? { module: {}, assets: [] };
  const decodedCharx: DecodedRisum = overrides.decodedCharx ?? decoded;
  const parse: SchemaParseResult = overrides.parse ?? { success: true, data: defaultModuleBody() };
  const uploadImageMany: ModuleUploaderDeps['uploadImageMany'] =
    overrides.uploadMany ?? (async (items, opts) => {
      state.uploadManyCalls.push({ items, userId: opts.userId });
      return items.map((_, i) => ({ id: `bimg-${state.uploadManyCalls.length}-${i}` }));
    });
  const baseDeps: ModuleUploaderDeps = {
    decodeRisum: () => { state.decodeCalls += 1; return decoded; },
    decodeCharx: () => { state.charxDecodeCalls += 1; return decodedCharx; },
    parseSchema: () => { state.parseCalls += 1; return parse; },
    newUuid: overrides.uuid ?? (() => { state.uuidCalls += 1; return `uuid-${state.uuidCalls}`; }),
    requestConsent: overrides.consent ?? (async (opts, userId) => {
      state.consentCalls.push({ title: opts.title, userId });
      return { confirmed: true };
    }),
    pairAssets: (manifest, bytesList) => {
      const out: { path: string; base64: string; mimeType: string; sourceIndex: number }[] = [];
      const n = Math.min(manifest.length, bytesList.length);
      for (let i = 0; i < n; i++) {
        const t = manifest[i];
        if (!t || typeof t[0] !== 'string' || t[0].length === 0) continue;
        out.push({
          path: t[0],
          base64: '',
          mimeType: 'application/octet-stream',
          sourceIndex: i,
        });
      }
      return out;
    },
    guessMimeType: (path) => path.endsWith('.png') ? 'image/png' : 'application/octet-stream',
    sniffImageMime: overrides.sniff ?? (() => null),
    getSkipAssetThumbnails: async () => overrides.skipAssetThumbnails === true,
    uploadImageOne: overrides.uploadOne ?? (async (input, userId) => {
      state.uploadOneCalls.push({ filename: input.filename, mime: input.mime_type, userId });
      return { id: `img-${state.uploadOneCalls.length}` };
    }),
    uploadImageMany,
    appendToJournal: overrides.appendToJournal ?? (async (_uid, moduleId, ids) => {
      state.journalAppends.push({ moduleId, ids });
    }),
    syncWorldBook: overrides.syncWorldBook ?? (async (env, userId) => {
      state.syncWorldBookCalls.push({ envId: env.id, userId });
      return null;
    }),
    writeEnvelope: overrides.writeEnvelope ?? (async (_uid, env) => {
      state.writeEnvelopeCalls.push(env);
    }),
    emitProgress: (frame, userId) => state.progressFrames.push({ frame, userId }),
    currentTranslatorSchemaVersion: 5,
    log: {
      info: (m) => state.infos.push(m),
      warn: (m) => state.warns.push(m),
    },
    errMsg: (e) => (e instanceof Error ? e.message : String(e)),
  };
  return { deps: baseDeps, state };
}

describe('createModuleUploader: schema + id validation', () => {
  test('schema parse failure throws with concatenated issues', async () => {
    const { deps } = makeMockDeps({
      parse: {
        success: false,
        error: { issues: [{ path: ['name'], message: 'bad' }, { path: ['id'], message: 'missing' }] },
      },
    });
    const u = createModuleUploader(deps);
    await expect(u.upload(new Uint8Array(0), 'm.risum', 'u-1')).rejects.toThrow(/schema validation/);
  });

  test('moduleBody.id missing throws', async () => {
    const body = defaultModuleBody();
    body.id = '';
    const { deps } = makeMockDeps({ parse: { success: true, data: body } });
    const u = createModuleUploader(deps);
    await expect(u.upload(new Uint8Array(0), 'm.risum', 'u-1')).rejects.toThrow(/missing an `id`/);
  });

  test('fresh UUID assigned to moduleBody.id', async () => {
    const body = defaultModuleBody();
    body.id = 'src-original-id';
    const { deps, state } = makeMockDeps({
      parse: { success: true, data: body },
      uuid: () => 'fresh-uuid-x',
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(result.envelope.id).toBe('fresh-uuid-x');
    expect(result.envelope.module.id).toBe('fresh-uuid-x');
    // syncWorldBook saw the fresh id, not the source
    expect(state.syncWorldBookCalls).toEqual([{ envId: 'fresh-uuid-x', userId: 'u-1' }]);
  });

  test('dispatches .charx files to the CharX decoder and still assigns a fresh id', async () => {
    const body = defaultModuleBody();
    body.id = 'charx-source-id';
    const { deps, state } = makeMockDeps({
      decodedCharx: { module: { name: 'raw-charx' }, assets: [] },
      parse: { success: true, data: body },
      uuid: () => 'fresh-charx-id',
    });
    const result = await createModuleUploader(deps)
      .upload(new Uint8Array([1]), 'weather.MODULE.CHARX', 'u-1');
    expect(state.charxDecodeCalls).toBe(1);
    expect(state.decodeCalls).toBe(0);
    expect(result.envelope.id).toBe('fresh-charx-id');
  });
});

describe('createModuleUploader: CharX icon', () => {
  test('uploads icon outside module assets, persists its id, and journals it', async () => {
    const body = defaultModuleBody();
    body.icon = '';
    const { deps, state } = makeMockDeps({
      decodedCharx: {
        module: {},
        assets: [],
        icon: { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ext: 'png' },
      },
      parse: { success: true, data: body },
      sniff: () => ({ ext: 'png', mime: 'image/png' }),
    });

    const result = await createModuleUploader(deps)
      .upload(new Uint8Array([1]), 'icons.module.charx', 'u-1');

    expect(state.uploadOneCalls).toEqual([
      { filename: 'module-icon.png', mime: 'image/png', userId: 'u-1' },
    ]);
    expect(result.envelope.module.icon).toBe('img-1');
    expect(result.envelope.asset_index).toEqual({});
    expect(state.journalAppends).toEqual([
      { moduleId: result.envelope.id, ids: ['img-1'] },
    ]);
  });
});

describe('createModuleUploader: lowLevelAccess consent', () => {
  function makeLowLevelDeps(consent: ModuleUploaderDeps['requestConsent']) {
    const body = defaultModuleBody();
    body.lowLevelAccess = true;
    return makeMockDeps({
      parse: { success: true, data: body },
      consent,
    });
  }

  test('consent confirmed continues', async () => {
    const { deps, state } = makeLowLevelDeps(async () => ({ confirmed: true }));
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.writeEnvelopeCalls).toHaveLength(1);
  });

  test('consent declined throws', async () => {
    const { deps } = makeLowLevelDeps(async () => ({ confirmed: false }));
    const u = createModuleUploader(deps);
    await expect(u.upload(new Uint8Array(0), 'm.risum', 'u-1')).rejects.toThrow(/consent declined/);
  });

  test('consent throws is treated as decline', async () => {
    const { deps, state } = makeLowLevelDeps(async () => { throw new Error('modal blew'); });
    const u = createModuleUploader(deps);
    await expect(u.upload(new Uint8Array(0), 'm.risum', 'u-1')).rejects.toThrow(/consent declined/);
    expect(state.warns.some((w) => w.includes('consent prompt threw'))).toBe(true);
  });
});

describe('createModuleUploader: asset upload (batched path)', () => {
  test('uploads assets via uploadImageMany only, uploadImageOne stays icon-only', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', ''], ['b.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1]), new Uint8Array([2])] },
      parse: { success: true, data: body },
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadManyCalls).toHaveLength(1);
    expect(state.uploadManyCalls[0]!.items).toHaveLength(2);
    expect(state.uploadOneCalls).toHaveLength(0);
    expect(Object.keys(result.envelope.asset_index)).toEqual(['a.png', 'b.png']);
  });

  test('skipAssetThumbnails stamps skip_thumbnail_processing on asset items, never on the icon', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', ''], ['b.png', '', '']];
    body.icon = '';
    const capturedOne: Array<boolean | undefined> = [];
    const { deps, state } = makeMockDeps({
      decoded: {
        module: {},
        assets: [new Uint8Array([1]), new Uint8Array([2])],
        icon: { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ext: 'png' },
      },
      parse: { success: true, data: body },
      skipAssetThumbnails: true,
      uploadOne: async (input) => {
        capturedOne.push(input.skip_thumbnail_processing);
        return { id: 'icon-1' };
      },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadManyCalls).toHaveLength(1);
    expect(state.uploadManyCalls[0]!.items.every((i) => i.skip_thumbnail_processing === true)).toBe(true);
    expect(capturedOne).toEqual([undefined]);
  });

  test('default settings leave skip_thumbnail_processing off module asset items', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1])] },
      parse: { success: true, data: body },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadManyCalls[0]!.items.every((i) => i.skip_thumbnail_processing === undefined)).toBe(true);
  });

  test('individual asset failure counted, others uploaded', async () => {
    const body = defaultModuleBody();
    body.assets = [['ok.png', '', ''], ['bad.png', '', '']];
    let call = 0;
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1]), new Uint8Array([2])] },
      parse: { success: true, data: body },
      uploadMany: async (items) => {
        call++;
        return items.map((_, i) => i === 0 ? { id: `okimg-${call}` } : { error: 'fail' });
      },
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(Object.keys(result.envelope.asset_index)).toEqual(['ok.png']);
    expect(state.warns.some((w) => w.includes('upload failed name=bad.png'))).toBe(true);
  });

  test('uploadImageMany throws => entire batch counted as failure', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1])] },
      parse: { success: true, data: body },
      uploadMany: async () => { throw new Error('net'); },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.warns.some((w) => w.includes('uploadMany batch failed'))).toBe(true);
    expect(state.warns.some((w) => w.includes('upload failed name=a.png'))).toBe(true);
  });

  test('uploadImageMany result without id => counted as failure', async () => {
    const body = defaultModuleBody();
    body.assets = [['x.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1])] },
      parse: { success: true, data: body },
      uploadMany: async (items) => items.map(() => ({})),
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(Object.keys(result.envelope.asset_index)).toEqual([]);
    expect(state.warns.some((w) => w.includes('upload failed name=x.png'))).toBe(true);
  });
});

describe('createModuleUploader: MIME sniffing + ext handling', () => {
  test('sniffed PNG bytes get .png extension appended to filename', async () => {
    const body = defaultModuleBody();
    body.assets = [['noext', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([0x89, 0x50, 0x4e, 0x47])] },
      parse: { success: true, data: body },
      sniff: () => ({ ext: 'png', mime: 'image/png' }),
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadManyCalls[0]!.items[0]!.filename).toBe('noext.png');
    expect(state.uploadManyCalls[0]!.items[0]!.mime_type).toBe('image/png');
    expect(result.envelope.asset_index['noext']).toEqual({ imageId: 'bimg-1-0' as never, ext: 'png' });
  });

  test('asset name has extension and sniff returns null => uses name as-is, derives ext from name', async () => {
    const body = defaultModuleBody();
    body.assets = [['pic.jpg', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([0])] },
      parse: { success: true, data: body },
      sniff: () => null,
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadManyCalls[0]!.items[0]!.filename).toBe('pic.jpg');
    expect(result.envelope.asset_index['pic.jpg']).toEqual({ imageId: 'bimg-1-0' as never, ext: 'jpg' });
  });

  test('asset name with no extension and sniff null => no ext on entry', async () => {
    const body = defaultModuleBody();
    body.assets = [['noext', '', '']];
    const { deps } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([0])] },
      parse: { success: true, data: body },
      sniff: () => null,
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(result.envelope.asset_index['noext']).toEqual({ imageId: 'bimg-1-0' as never });
  });
});

describe('createModuleUploader: world_book sync', () => {
  test('syncWorldBook returns wbId => installed_world_book_id present', async () => {
    const { deps } = makeMockDeps({
      syncWorldBook: async () => 'wb-x',
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(result.envelope.installed_world_book_id).toBe('wb-x');
  });

  test('syncWorldBook returns null => installed_world_book_id absent', async () => {
    const { deps } = makeMockDeps({ syncWorldBook: async () => null });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect('installed_world_book_id' in result.envelope).toBe(false);
  });

  test('syncWorldBook throws => caught + warn + null wb', async () => {
    const { deps, state } = makeMockDeps({
      syncWorldBook: async () => { throw new Error('wb-bad'); },
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect('installed_world_book_id' in result.envelope).toBe(false);
    expect(state.warns.some((w) => w.includes('syncModuleWorldBook failed'))).toBe(true);
  });
});

describe('createModuleUploader: writeEnvelope + final shape', () => {
  test('writeEnvelope receives the final envelope', async () => {
    const { deps, state } = makeMockDeps();
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.writeEnvelopeCalls).toHaveLength(1);
    expect(state.writeEnvelopeCalls[0]).toBe(result.envelope);
  });

  test('writeEnvelope throws => propagates', async () => {
    const { deps } = makeMockDeps({
      writeEnvelope: async () => { throw new Error('disk full'); },
    });
    const u = createModuleUploader(deps);
    await expect(u.upload(new Uint8Array(0), 'm.risum', 'u-1')).rejects.toThrow(/disk full/);
  });

  test('envelope shape: schema_version, fresh id, filename, asset_index, translator_schema_version', async () => {
    const { deps } = makeMockDeps({
      uuid: () => 'fixed-id',
    });
    const u = createModuleUploader(deps);
    const result = await u.upload(new Uint8Array(0), 'mybook.risum', 'u-1');
    expect(result.envelope.schema_version).toBe(1);
    expect(result.envelope.id).toBe('fixed-id');
    expect(result.envelope.filename).toBe('mybook.risum');
    expect(result.envelope.translator_schema_version).toBe(5);
    expect(result.envelope.asset_index).toEqual({});
  });
});

describe('createModuleUploader: pairing + journal', () => {
  test('decoded assets > paired assets => warn about dropped count', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', '']]; // only 1 manifest entry
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1]), new Uint8Array([2])] }, // 2 bytes
      parse: { success: true, data: body },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.warns.some((w) => w.includes("couldn't be paired"))).toBe(true);
  });

  test('appendToJournal called with uploaded image ids', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1])] },
      parse: { success: true, data: body },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.journalAppends).toHaveLength(1);
    expect(state.journalAppends[0]!.ids).toEqual(['bimg-1-0']);
  });

  test('zero assets => no upload calls, no journal flushes', async () => {
    const { deps, state } = makeMockDeps();
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.uploadOneCalls).toHaveLength(0);
    expect(state.uploadManyCalls).toHaveLength(0);
    expect(state.journalAppends).toHaveLength(0);
  });
});

describe('createModuleUploader: progress emission', () => {
  test('emits at least one progress frame after asset upload', async () => {
    const body = defaultModuleBody();
    body.assets = [['a.png', '', '']];
    const { deps, state } = makeMockDeps({
      decoded: { module: {}, assets: [new Uint8Array([1])] },
      parse: { success: true, data: body },
    });
    const u = createModuleUploader(deps);
    await u.upload(new Uint8Array(0), 'm.risum', 'u-1');
    expect(state.progressFrames.length).toBeGreaterThan(0);
    const last = state.progressFrames[state.progressFrames.length - 1]!;
    expect(last.frame.phase).toBe('uploading_assets');
    expect(last.userId).toBe('u-1');
  });
});
