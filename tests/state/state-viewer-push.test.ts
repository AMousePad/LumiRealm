import { describe, test, expect } from 'bun:test';
import {
  pushViewerData,
  type ViewerPushDeps,
  type ViewerPushSource,
} from '../../src/state/viewer-push.js';
import type { ViewerData } from '../../src/types/messages.js';

const FAKE_DATA: ViewerData = {
  kind: 'character',
  characterId: 'c-1',
  characterName: 'Char',
  creatorNotes: '',
  backgroundHtml: null,
  assets: [],
  triggers: [],
  lorebookGroups: [],
  lorebookFlat: [],
  lorebookNeedsReimport: false,
  regexEntries: [],
  cjs: null,
  warnings: [],
  defaultVariablesText: "", defaultVariablesUserEdited: false,
  toggles: [],
} as never;

interface CallTrace {
  readonly calls: string[];
}

function makeDeps(overrides?: Partial<ViewerPushDeps>): { deps: ViewerPushDeps; trace: CallTrace } {
  const trace: CallTrace = { calls: [] };
  const deps: ViewerPushDeps = {
    assembleCharacter: async (id, uid) => { trace.calls.push(`asm:char:${id}:${uid}`); return FAKE_DATA; },
    assembleModule: async (id, uid) => { trace.calls.push(`asm:mod:${id}:${uid}`); return FAKE_DATA; },
    send: (msg, uid) => { trace.calls.push(`send:${msg.type}:${uid}`); },
    warn: (msg) => { trace.calls.push(`warn:${msg}`); },
    errMsg: (err) => err instanceof Error ? err.message : String(err),
    ...overrides,
  };
  return { deps, trace };
}

describe('pushViewerData', () => {
  test('character source: assembles via assembleCharacter, sends on success', async () => {
    const { deps, trace } = makeDeps();
    const source: ViewerPushSource = { kind: 'character', characterId: 'c-1' };
    await pushViewerData({ source, context: 'test', userId: 'u-1' }, deps);
    expect(trace.calls).toEqual([
      'asm:char:c-1:u-1',
      'send:viewer_data_pushed:u-1',
    ]);
  });

  test('module source: assembles via assembleModule, sends on success', async () => {
    const { deps, trace } = makeDeps();
    const source: ViewerPushSource = { kind: 'module', moduleId: 'm-1' };
    await pushViewerData({ source, context: 'test', userId: 'u-1' }, deps);
    expect(trace.calls).toEqual([
      'asm:mod:m-1:u-1',
      'send:viewer_data_pushed:u-1',
    ]);
  });

  test('null assemble result: skips send, no warn', async () => {
    const { deps, trace } = makeDeps({
      assembleCharacter: async () => null,
    });
    await pushViewerData(
      { source: { kind: 'character', characterId: 'c-1' }, context: 'test', userId: 'u-1' },
      deps,
    );
    expect(trace.calls.find((c) => c.startsWith('send:'))).toBeUndefined();
    expect(trace.calls.find((c) => c.startsWith('warn:'))).toBeUndefined();
  });

  test('character assemble throws: warn fires with context prefix, no send', async () => {
    const { deps, trace } = makeDeps({
      assembleCharacter: async () => { throw new Error('boom'); },
    });
    await pushViewerData(
      { source: { kind: 'character', characterId: 'c-1' }, context: 'set_trigger_lua', userId: 'u-1' },
      deps,
    );
    expect(trace.calls.some((c) => c.startsWith('send:'))).toBe(false);
    expect(trace.calls.some((c) => c === 'warn:set_trigger_lua: viewer re-push failed: boom')).toBe(true);
  });

  test('module assemble throws: warn fires with context prefix, no send', async () => {
    const { deps, trace } = makeDeps({
      assembleModule: async () => { throw new Error('mod-fail'); },
    });
    await pushViewerData(
      { source: { kind: 'module', moduleId: 'm-1' }, context: 'add_asset', userId: 'u-1' },
      deps,
    );
    expect(trace.calls.some((c) => c.startsWith('send:'))).toBe(false);
    expect(trace.calls.some((c) => c === 'warn:add_asset: viewer re-push failed: mod-fail')).toBe(true);
  });

  test('send throwing inside try is also caught by warn', async () => {
    const { deps, trace } = makeDeps({
      send: () => { throw new Error('send-fail'); },
    });
    await pushViewerData(
      { source: { kind: 'character', characterId: 'c-1' }, context: 'set_default_variable', userId: 'u-1' },
      deps,
    );
    expect(trace.calls.some((c) => c.startsWith('warn:set_default_variable:'))).toBe(true);
  });

  test('does not swallow non-Error throws (errMsg coerces)', async () => {
    const { deps, trace } = makeDeps({
      assembleCharacter: async () => { throw 'plain-string-error'; },
    });
    await pushViewerData(
      { source: { kind: 'character', characterId: 'c-1' }, context: 'test', userId: 'u-1' },
      deps,
    );
    expect(trace.calls.some((c) => c === 'warn:test: viewer re-push failed: plain-string-error')).toBe(true);
  });

  test('parity: replicates inline shape (character branch)', async () => {
    const { deps: depsHelper, trace: traceHelper } = makeDeps();
    const { deps: depsInline, trace: traceInline } = makeDeps();

    const source: ViewerPushSource = { kind: 'character', characterId: 'c-99' };
    const userId = 'u-1';
    const context = 'set_background_html';

    await pushViewerData({ source, context, userId }, depsHelper);

    try {
      const data = source.kind === 'character'
        ? await depsInline.assembleCharacter(source.characterId, userId)
        : await depsInline.assembleModule((source as { moduleId: string }).moduleId, userId);
      if (data) depsInline.send({ type: 'viewer_data_pushed', data }, userId);
    } catch (err) {
      depsInline.warn(`${context}: viewer re-push failed: ${depsInline.errMsg(err)}`);
    }

    expect(traceHelper.calls).toEqual(traceInline.calls);
  });

  test('parity: replicates inline shape (module branch with throw)', async () => {
    const failure = new Error('disk-full');
    const { deps: depsHelper, trace: traceHelper } = makeDeps({
      assembleModule: async () => { throw failure; },
    });
    const { deps: depsInline, trace: traceInline } = makeDeps({
      assembleModule: async () => { throw failure; },
    });

    const source: ViewerPushSource = { kind: 'module', moduleId: 'm-7' };
    const userId = 'u-1';
    const context = 'set_trigger_lua';

    await pushViewerData({ source, context, userId }, depsHelper);

    const inlineSource = source as ViewerPushSource;
    try {
      const data = inlineSource.kind === 'character'
        ? await depsInline.assembleCharacter(inlineSource.characterId, userId)
        : await depsInline.assembleModule(inlineSource.moduleId, userId);
      if (data) depsInline.send({ type: 'viewer_data_pushed', data }, userId);
    } catch (err) {
      depsInline.warn(`${context}: viewer re-push failed: ${depsInline.errMsg(err)}`);
    }

    expect(traceHelper.calls).toEqual(traceInline.calls);
  });
});
