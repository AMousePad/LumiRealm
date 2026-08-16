import { describe, expect, test } from 'bun:test';
import type { WorldInfoInterceptorEntryDTO } from 'lumiverse-spindle-types';

import type { ActiveCard } from '../interpreter/dispatch.js';
import { convertCharacterBook } from '../core/charx/module.js';
import { mapLoreBookEntry } from '../core/mappers/lorebook.js';
import { computeEntrySourceHash } from '../core/mappers/lorebook-hash.js';
import { loreBookSchema } from '../core/schemas/lorebook.js';
import {
  buildRisuWorldInfoChatPlacements,
  resolveRisuChatDepthPlacement,
} from './risu-world-info-depth-placement.js';

describe('Risu world-info depth placement', () => {
  test('ports depth direction, role, and last-decorator behavior', () => {
    expect(resolveRisuChatDepthPlacement(
      '@@reverse_depth 3\n@@role assistant\nbody',
    )).toEqual({
      type: 'chat_depth',
      role: 'assistant',
      depth: 3,
      direction: 'from_end',
    });
    expect(resolveRisuChatDepthPlacement(
      '@@reverse_depth 3\n@@depth 1\nbody',
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: 1,
      direction: 'from_start',
    });
    expect(resolveRisuChatDepthPlacement('@@depth 0\nbody')).toBeNull();
    expect(resolveRisuChatDepthPlacement(
      '@@reverse_depth -4\nbody',
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: 0,
      direction: 'from_end',
    });
    const hugeDepth = '9'.repeat(400);
    expect(resolveRisuChatDepthPlacement(
      `@@depth ${hugeDepth}\nbody`,
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: Number.MAX_SAFE_INTEGER,
      direction: 'from_start',
    });
    expect(resolveRisuChatDepthPlacement(
      `@@reverse_depth ${hugeDepth}\nbody`,
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: Number.MAX_SAFE_INTEGER,
      direction: 'from_end',
    });
  });

  test('ports fallback suspension from CCardLib decorator parsing', () => {
    expect(resolveRisuChatDepthPlacement(
      '@@unknown\n@@@reverse_depth 2\nbody',
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: 2,
      direction: 'from_end',
    });
    expect(resolveRisuChatDepthPlacement(
      '@@depth 1\n@@@reverse_depth 2\nbody',
    )).toEqual({
      type: 'chat_depth',
      role: 'system',
      depth: 1,
      direction: 'from_start',
    });
  });

  test('matches an untouched source-indexed row and rejects a live edit', () => {
    const rawEntry = {
      keys: ['key'],
      secondary_keys: [],
      content: '@@reverse_depth 2\n@@role assistant\nbody',
      extensions: {},
      enabled: true,
      insertion_order: 10,
      name: 'entry',
      constant: false,
      selective: false,
      case_sensitive: false,
    };
    const lore = loreBookSchema.parse({
      key: 'key',
      secondkey: '',
      insertorder: 10,
      comment: 'entry',
      content: rawEntry.content,
      mode: 'normal',
      alwaysActive: false,
      selective: false,
      extentions: { risu_case_sensitive: false },
    });
    const projected = mapLoreBookEntry(
      lore,
      'book',
      new Map(),
      0,
      () => 'entry-id',
      0,
    );
    const entry = {
      ...projected,
      book_source: 'character',
    } as unknown as WorldInfoInterceptorEntryDTO;
    const active = {
      lumirealm: {
        source: {
          card: {
            data: {
              character_book: {
                entries: [rawEntry],
              },
            },
          },
          module: null,
        },
        user_overrides: {},
      },
      card: {
        risuPayload: {
          extra: {},
        },
      },
    } as unknown as ActiveCard;

    expect([...buildRisuWorldInfoChatPlacements(active, [entry])]).toEqual([[
      'entry-id',
      {
        type: 'chat_depth',
        role: 'assistant',
        depth: 2,
        direction: 'from_end',
      },
    ]]);
    expect(buildRisuWorldInfoChatPlacements(active, [{
      ...entry,
      content: 'user edit',
    }]).size).toBe(0);

    const unrelatedDraft = {
      ...entry,
      content: 'untouched content from another character book',
    };
    const unrelated = {
      ...unrelatedDraft,
      extensions: {
        ...unrelatedDraft.extensions,
        _risu_source_hash: computeEntrySourceHash(
          unrelatedDraft as unknown as Record<string, unknown>,
        ),
      },
    };
    expect(buildRisuWorldInfoChatPlacements(active, [unrelated]).size).toBe(0);
  });

  test('uses the imported CharacterBook depth fields', () => {
    const rawEntry = {
      keys: ['key'],
      secondary_keys: [],
      content: 'body',
      extensions: {
        position: 4,
        depth: 2,
        role: 1,
      },
      enabled: true,
      insertion_order: 10,
      name: 'entry',
      constant: false,
      selective: false,
      case_sensitive: false,
    };
    const lore = loreBookSchema.parse(
      convertCharacterBook({ entries: [rawEntry] })[0],
    );
    const entry = {
      ...mapLoreBookEntry(
        lore,
        'book',
        new Map(),
        0,
        () => 'entry-id',
        0,
      ),
      book_source: 'character',
    } as unknown as WorldInfoInterceptorEntryDTO;
    const active = {
      lumirealm: {
        source: {
          card: {
            data: {
              character_book: {
                entries: [rawEntry],
              },
            },
          },
          module: null,
        },
        user_overrides: {},
      },
      card: {
        risuPayload: {
          extra: {},
        },
      },
    } as unknown as ActiveCard;

    expect([...buildRisuWorldInfoChatPlacements(active, [entry])]).toEqual([[
      'entry-id',
      {
        type: 'chat_depth',
        role: 'user',
        depth: 2,
        direction: 'from_start',
      },
    ]]);
  });

  test('resolves placement from a module lorebook source', () => {
    const lore = loreBookSchema.parse({
      key: 'key',
      secondkey: '',
      insertorder: 10,
      comment: 'module entry',
      content: '@@reverse_depth 1\nbody',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    });
    const entry = {
      ...mapLoreBookEntry(
        lore,
        'book',
        new Map(),
        0,
        () => 'entry-id',
        0,
      ),
      book_source: 'character',
    } as unknown as WorldInfoInterceptorEntryDTO;
    const active = {
      lumirealm: {
        source: {
          card: null,
          module: {
            lorebook: [lore],
          },
        },
        user_overrides: {},
      },
      card: {
        risuPayload: {
          extra: {},
        },
      },
    } as unknown as ActiveCard;

    expect([...buildRisuWorldInfoChatPlacements(active, [entry])]).toEqual([[
      'entry-id',
      {
        type: 'chat_depth',
        role: 'system',
        depth: 1,
        direction: 'from_end',
      },
    ]]);
  });
});
