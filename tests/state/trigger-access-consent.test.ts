import * as characterMigration from "../../src/migrations/character.js";
import { expect, test, spyOn } from 'bun:test';
import { translateFromStoredSource } from '../../src/core/pipeline/translate.js';
import { buildLumirealmData } from '../../src/payload/codec.js';
import { retranslateCharacterFromCurrentSource, type CharacterRetranslateDeps } from '../../src/state/character-retranslate.js';
import { migrateCharacterIfNeeded, CURRENT_CHARACTER_SCHEMA_VERSION, type MigrationDeps } from '../../src/migrations/character.js';
import { createMigrationsRunner, type MigrationsFactoryDeps } from '../../src/migrations/runner.js';
import { createRepairOrchestrator, type RepairOrchestratorDeps } from '../../src/state/repair-orchestrator.js';
import { createRepairHandlers } from '../../src/handlers/repair.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

const log = { info: () => {}, warn: () => {}, error: () => {} };
const args = { characterId: 'character', characterName: 'Access fixture', userId: 'user' };

function envelope(granted = false, required = true) {
  const source = { card: { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: 'Access fixture',
    assets: [{ type: 'x-risu-asset', name: 'inline', uri: 'data:image/png;base64,AA==', ext: 'png' }],
    extensions: { risuai: { lowLevelAccess: required, triggerscript: [{
      type: 'output', lowLevelAccess: required, conditions: [],
      effect: [{ type: 'triggerlua', code: 'onOutput = function() end' }],
    }] } },
  } }, module: null };
  const payload = translateFromStoredSource(structuredClone(source), { mode: 'full', emitPackScripts: false }).risuPayload!;
  return buildLumirealmData({ ...payload, requires: { ...payload.requires, lowLevelAccess: false } },
    'old', [], {}, {}, 1, granted ? { low_level_access_granted: true } : {},
    { schema_version: 1, captured_at: 1, ...source, path_to_image_id: {} }, CURRENT_CHARACTER_SCHEMA_VERSION - 1);
}

function repairDeps(writes: string[]): CharacterRetranslateDeps {
  return { extensionVersion: 'current', getAvatarImageId: async () => null,
    installCharacterRegexScripts: async () => { writes.push('install'); },
    writeEnvelope: async () => { writes.push('write'); }, dispatchSvgRasterize: () => { writes.push('raster'); },
    invalidateActiveForCharacter: () => {}, log };
}

test.each([false, true])('retranslation respects explicit consent %s', async (granted) => {
  const input = envelope(granted);
  const original = structuredClone(input);
  const writes: string[] = [];
  const result = await retranslateCharacterFromCurrentSource({ ...args, envelope: input }, repairDeps(writes));
  if (granted) {
    expect(result.kind).toBe('retranslated');
    expect(writes).toEqual(['install', 'write']);
  } else {
    expect(result).toMatchObject({ kind: 'failed', consentRequired: true });
    expect(writes).toEqual([]);
  }
  expect(input).toEqual(original);
});

test('retranslation needs no consent for a nonprivileged source', async () => {
  const writes: string[] = [];
  const result = await retranslateCharacterFromCurrentSource({ ...args, envelope: envelope(false, false) }, repairDeps(writes));
  expect(result.kind).toBe('retranslated');
  expect(writes).toEqual(['install', 'write']);
});

test('migration refuses access before changing any source, schema, assets or regex', async () => {
  const input = envelope();
  const original = structuredClone(input);
  const writes: string[] = [];
  const result = await migrateCharacterIfNeeded({ ...args, envelope: input }, {
    extensionVersion: 'current', log,
    applyCharacterRegexRowPatch: async () => { writes.push('regex'); return { scanned: 0, updated: 0, failed: 0 }; },
    writeEnvelope: async () => { writes.push('write'); },
  } as unknown as MigrationDeps);
  expect(result).toMatchObject({ kind: 'failed', consentRequired: true });
  expect(writes).toEqual([]);
  expect(input).toEqual(original);
});

test('automatic migration reports consent through an error toast, without the legacy modal', async () => {
  const toasts: Array<{ kind: string; message: string }> = [];
  const sends: BackendToFrontend[] = [];
  const runner = createMigrationsRunner({
    extensionVersion: 'current', log, translatorMigrationChecked: new Set(),
    toastFor: (_userId: string, kind: string, message: string) => { toasts.push({ kind, message }); },
    send: (message: BackendToFrontend) => { sends.push(message); },
  } as unknown as MigrationsFactoryDeps);
  expect(await runner.runCharacterMigration(args.characterId, args.characterName, args.userId, envelope(), { silent: true })).toBe('failed');
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toMatchObject({ kind: 'error' });
  expect(toasts[0]!.message).toMatch(/consent.*open|open.*consent/i);
  expect(sends).toEqual([]);
});

test('consent failure reaches the existing repair error result instead of reporting completion', async () => {
  const messages: BackendToFrontend[] = [];
  const phases: string[] = [];
  const data = envelope();
  const repair = createRepairOrchestrator({
    listLumirealmCharacters: async () => [{ character: { id: args.characterId, name: args.characterName }, data }],
    retranslateCharacter: async () => ({ kind: 'failed', error: 'consent required', consentRequired: true }),
    emitOperationProgress: (_user: string, _id: string, phase: string) => { phases.push(phase); },
    log, errMsg: (error: unknown) => String(error),
  } as unknown as RepairOrchestratorDeps);
  const handlers = createRepairHandlers({
    assetUploadsInFlightRef: { current: 0 }, repairInFlightByUser: new Set(),
    scanRepairTargets: async () => { throw new Error('unused'); },
    applyRepair: repair.applyRepair, log, errMsg: (error) => error instanceof Error ? error.message : String(error),
  });
  await handlers.apply_repair({ type: 'apply_repair', options: {
    applyStaleCharRegex: false, applyStaleModuleRegex: false, applyDeadJournals: false, applyForceRetranslate: true,
  } }, { userId: args.userId, send: (message) => { messages.push(message); }, log, errMsg: String });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ type: 'repair_apply_result', error: expect.stringMatching(/consent.*open|open.*consent/i) });
  expect(phases.at(-1)).toBe('error');
});

test.each([false, true])('opening a blocked card records only explicit consent and retries migration: %s', async (confirmed) => {
  const input = envelope();
  const original = structuredClone(input);
  const migrated: any[] = [], writes: any[] = [], prompts: any[] = [];
  const migrate = spyOn(characterMigration, 'migrateCharacterIfNeeded').mockImplementation(async (request) => {
    migrated.push(request);
    return request.envelope.user_overrides.low_level_access_granted
      ? { kind: 'migrated', from: 1, to: 2, stepsApplied: [], elapsedMs: 0 } as any
      : { kind: 'failed', from: 1, to: 2, consentRequired: true, error: 'consent required' };
  });
  try {
    const runner = createMigrationsRunner({
      extensionVersion: 'current', log, translatorMigrationChecked: new Set(),
      requestCardAccess: async (...request: any[]) => { prompts.push(request); return { confirmed }; },
      updateLumirealm: async (characterId: string, userId: string, mutate: any) => {
        expect([characterId, userId]).toEqual([args.characterId, args.userId]);
        const updated = mutate(input); writes.push(updated); return updated;
      },
      invalidateActiveForCharacter() {}, toastFor() {},
    } as unknown as MigrationsFactoryDeps);
    const result = await runner.runCharacterMigration(args.characterId, args.characterName, args.userId, input, { firePromptOnNeedsReimport: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0][0]).toBe(args.characterName);
    expect(prompts[0][1]).toContain('LLM API calls');
    expect(prompts[0][2]).toBe(args.userId);
    expect(writes).toHaveLength(confirmed ? 1 : 0);
    expect(migrated).toHaveLength(confirmed ? 2 : 1);
    expect(result).toBe(confirmed ? 'migrated' : 'failed');
    expect(input).toEqual(original);
    if (confirmed) {
      expect(writes[0].user_overrides.low_level_access_granted).toBe(true);
      expect(writes[0].user_overrides.consent_acknowledged_at).toBeGreaterThan(0);
    }
  } finally { migrate.mockRestore(); }
});
