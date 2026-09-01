/**
 * Regression pin: ImportResult.createdWorldBookIds must be populated
 * whenever the import created a world_book. Backend's
 * `importCardFromBytes` reads this to pre-seed the
 * `worldBookIdsByCharacter` cache so a CHARACTER_DELETED that fires
 * BEFORE any chat is opened still surfaces the world_book id to the
 * cleanup cascade. Without this, an import-then-delete (no chat
 * opened) orphans the world_book in Lumi.
 *
 * Tests the contract at the type / return-shape level rather than
 * full live-fire because the latter requires a real Lumi instance.
 */

import { describe, test, expect } from 'bun:test';
import type { ImportResult } from '../../src/payload/import.js';

describe('ImportResult type contract', () => {
  test('createdWorldBookIds is a required readonly string array on the type', () => {
    // This compiles only if the type guarantees the field exists. The
    // test itself is a tautology at runtime; the value is the
    // tsc-time pin.
    const fixture: ImportResult = {
      characterId: 'c1',
      characterName: 'Reimu',
      lumirealm: {
        schema_version: 1,
        imported_at: 0,
        extension_version: 'test',
        translator_version: 'test',
        payload: {
          triggers: [],
          lua_scripts: [],
          at_actions: [],
          additional_assets: [],
          emotion_images: [],
          background_html: null,
          utility_bot: false,
          scriptstate_defaults: {},
          requires: { lua: false, lowLevelAccess: false, hostFeatures: [] },
        },
        asset_index: {},
        emotion_index: {},
        regex_scripts: [],
        user_overrides: {},
      },
      imageIds: [],
      pendingRegexScripts: [],
      warnings: [],
      createdWorldBookIds: ['wb-A'],
      pendingSvgRasters: [],
    };
    expect(fixture.createdWorldBookIds).toEqual(['wb-A']);
    // Empty array is also valid (card had no lorebook entries).
    const empty: ImportResult = { ...fixture, createdWorldBookIds: [] };
    expect(empty.createdWorldBookIds).toEqual([]);
  });
});
