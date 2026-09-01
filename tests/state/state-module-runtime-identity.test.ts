import { describe, expect, test } from 'bun:test';
import { createModulePushes } from '../../src/state/module-pushes.js';
import type {
  ModuleEnvelope,
  ModuleIndexEntry,
} from '../../src/state/modules-store.js';
import { mergeAttachedModulesIntoPayload } from '../../src/state/lumirealm-character.js';

describe('attached module runtime identity', () => {
  test('runtime loading preserves module-library order over attachment order', async () => {
    const moduleA = {
      schema_version: 1,
      id: 'module-a',
      filename: 'a.module',
      uploaded_at: 1,
      module: { lorebook: [{ key: 'a', content: 'A' }], trigger: [] },
      asset_index: {},
    } as unknown as ModuleEnvelope;
    const moduleB = {
      schema_version: 1,
      id: 'module-b',
      filename: 'b.module',
      uploaded_at: 2,
      module: { lorebook: [{ key: 'b', content: 'B' }], trigger: [] },
      asset_index: {},
    } as unknown as ModuleEnvelope;
    const library = [
      { id: moduleB.id } as unknown as ModuleIndexEntry,
      { id: moduleA.id } as unknown as ModuleIndexEntry,
    ];
    let resolveLibrary!: (value: readonly ModuleIndexEntry[]) => void;
    const libraryGate = new Promise<readonly ModuleIndexEntry[]>((resolve) => {
      resolveLibrary = resolve;
    });
    let libraryCalls = 0;
    let directReads = 0;

    const pushes = createModulePushes({
      translateLang: 'en',
      readLumirealm: async () => null,
      writeLumirealm: async () => {},
      readModuleEnvelope: async (_userId, moduleId) => {
        directReads += 1;
        return moduleId === moduleA.id
          ? moduleA
          : moduleId === moduleB.id
            ? moduleB
            : null;
      },
      writeModuleEnvelope: async () => {},
      // Current Risu filters this library array without reordering it.
      listModuleStore: () => {
        libraryCalls += 1;
        return libraryGate;
      },
      readGlobalModuleIds: async () => [],
      listLumirealmCharacters: async () => [],
      listCards: async () => [],
      pushCards: () => {},
      send: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error) => String(error),
    });

    const loadPromise = pushes.loadAttachedModulesForRuntime(
      'user',
      [moduleA.id, moduleB.id],
    );
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    const readsBeforeLibraryResolved = directReads;
    resolveLibrary(library);
    const loaded = await loadPromise;

    expect(libraryCalls).toBe(1);
    expect(readsBeforeLibraryResolved).toBe(2);
    expect(loaded.map((module) => module.id)).toEqual([
      moduleB.id,
      moduleA.id,
    ]);
  });

  test('namespace replacement retains the persisted old-id handle', async () => {
    const replacement = {
      schema_version: 1,
      id: 'module-new-id',
      filename: 'replacement.module',
      uploaded_at: 1,
      module: {
        namespace: 'module-old-id',
        lorebook: [{ key: 'replacement', content: 'RAW' }],
        trigger: [],
      },
      asset_index: {},
    } as unknown as ModuleEnvelope;
    const summary = {
      id: replacement.id,
    } as unknown as ModuleIndexEntry;
    let libraryCalls = 0;

    const pushes = createModulePushes({
      translateLang: 'en',
      readLumirealm: async () => null,
      writeLumirealm: async () => {},
      readModuleEnvelope: async (_userId, moduleId) =>
        moduleId === replacement.id ? replacement : null,
      writeModuleEnvelope: async () => {},
      listModuleStore: async () => {
        libraryCalls += 1;
        return [summary];
      },
      readGlobalModuleIds: async () => [],
      listLumirealmCharacters: async () => [],
      listCards: async () => [],
      pushCards: () => {},
      send: () => {},
      log: {
        info: () => {},
        warn: () => {},
      },
      errMsg: (error) => String(error),
    });

    const loaded = await pushes.loadAttachedModulesForRuntime(
      'user',
      ['module-old-id'],
    );

    expect(loaded).toHaveLength(1);
    expect(libraryCalls).toBe(1);
    expect(loaded[0]).toMatchObject({
      id: 'module-new-id',
      namespace: 'module-old-id',
      attachment_handles: ['module-old-id'],
      lorebook: [{ key: 'replacement', content: 'RAW' }],
    });
  });

  test('retains attached-module special regex actions in the runtime view', async () => {
    const module = {
      schema_version: 1,
      id: 'module-actions',
      filename: 'actions.module',
      uploaded_at: 1,
      module: {
        name: 'Actions',
        description: '',
        id: 'module-actions',
        trigger: [],
        regex: [
          {
            comment: 'display expression',
            in: 'happy',
            out: '@@emo Joy',
            type: 'editdisplay',
            flag: 'gi<order 42>',
            ableFlag: true,
          },
          {
            comment: 'ordinary',
            in: 'x',
            out: 'y',
            type: 'editdisplay',
            flag: 'g',
            ableFlag: true,
          },
        ],
      },
      asset_index: {},
    } as unknown as ModuleEnvelope;

    const pushes = createModulePushes({
      translateLang: 'en',
      readLumirealm: async () => null,
      writeLumirealm: async () => {},
      readModuleEnvelope: async (_userId, moduleId) =>
        moduleId === module.id ? module : null,
      writeModuleEnvelope: async () => {},
      listModuleStore: async () => [],
      readGlobalModuleIds: async () => [],
      listLumirealmCharacters: async () => [],
      listCards: async () => [],
      pushCards: () => {},
      send: () => {},
      log: { info: () => {}, warn: () => {} },
      errMsg: (error) => String(error),
    });

    const loaded = await pushes.loadAttachedModulesForRuntime(
      'user',
      [module.id],
    );

    expect(loaded[0]?.at_actions).toEqual([
      {
        action: 'emo',
        directAction: 'emo',
        findRegex: 'happy',
        flag: 'gi',
        out: '@@emo Joy',
        phase: 'editdisplay',
        order: 42,
        hasExplicitOrder: true,
        sourceIndex: 0,
        sourceRowIndex: 0,
        sourceOrigin: 'module:module-actions',
      },
    ]);
  });

  test('binds runtime actions to the stable installed host script id', () => {
    const merged = mergeAttachedModulesIntoPayload(
      {
        triggers: [],
        lua_scripts: [],
        at_actions: [],
        background_html: null,
        virtualscript: null,
        utility_bot: false,
        scriptstate_defaults: {},
        additional_assets: [],
        emotion_images: [],
        extra: {},
        translator_version: 'test',
        risu_spec_version: 'test',
        requires: {
          lua: false,
          lowLevelAccess: false,
          hostFeatures: [],
        },
      },
      {},
      [
        {
          id: 'module-actions',
          triggers: [],
          lua_scripts: [],
          at_actions: [
            {
              action: 'emo',
              sourceRowIndex: 1,
              sourceOrigin: 'module:module-actions',
            },
          ],
          lorebook: [],
          asset_index: {},
          low_level_access: false,
        },
      ],
      {
        'module-actions': ['divider-row', 'action-row'],
      },
    );

    expect(merged.at_actions).toEqual([
      {
        action: 'emo',
        sourceRowIndex: 1,
        sourceOrigin: 'module:module-actions',
        liveScriptId: 'action-row',
      },
    ]);
  });
});
