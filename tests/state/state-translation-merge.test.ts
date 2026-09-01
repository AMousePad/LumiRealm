import { describe, test, expect } from 'bun:test';
import { mergeLangBlock } from '../../src/state/translation-merge.js';

describe('mergeLangBlock', () => {
  test('empty existing + no lorebook items: passes name and description through', () => {
    const next = mergeLangBlock({
      existing: {},
      name: 'EN Name',
      description: 'EN Desc',
    });
    expect(next).toEqual({ name: 'EN Name', description: 'EN Desc' });
  });

  test('omitting name: existing.name preserved', () => {
    const next = mergeLangBlock({
      existing: { name: 'Existing' },
    });
    expect(next.name).toBe('Existing');
  });

  test('omitting description: existing.description preserved', () => {
    const next = mergeLangBlock({
      existing: { description: 'Existing Desc' },
    });
    expect(next.description).toBe('Existing Desc');
  });

  test('lorebook item with sourceHash and comment: added to map', () => {
    const next = mergeLangBlock({
      existing: {},
      lorebookItems: [{ sourceHash: 'h1', comment: 'CommentA' }],
    });
    expect(next.lorebook).toEqual({ h1: { comment: 'CommentA' } });
  });

  test('lorebook item without sourceHash: skipped', () => {
    const next = mergeLangBlock({
      existing: {},
      lorebookItems: [{ comment: 'Orphan' }, { sourceHash: 'h1', comment: 'Real' }],
    });
    expect(next.lorebook).toEqual({ h1: { comment: 'Real' } });
  });

  test('multiple items: each merged into the map', () => {
    const next = mergeLangBlock({
      existing: {},
      lorebookItems: [
        { sourceHash: 'h1', comment: 'A' },
        { sourceHash: 'h2', comment: 'B' },
        { sourceHash: 'h3', comment: 'C' },
      ],
    });
    expect(next.lorebook).toEqual({
      h1: { comment: 'A' },
      h2: { comment: 'B' },
      h3: { comment: 'C' },
    });
  });

  test('item with no comment but valid sourceHash: existing entry preserved', () => {
    const next = mergeLangBlock({
      existing: { lorebook: { h1: { comment: 'Old' } } },
      lorebookItems: [{ sourceHash: 'h1' }],
    });
    expect(next.lorebook?.['h1']).toEqual({ comment: 'Old' });
  });

  test('overwrite existing comment for same sourceHash', () => {
    const next = mergeLangBlock({
      existing: { lorebook: { h1: { comment: 'Old' } } },
      lorebookItems: [{ sourceHash: 'h1', comment: 'New' }],
    });
    expect(next.lorebook?.['h1']).toEqual({ comment: 'New' });
  });

  test('preserves existing lorebook entries not touched by items', () => {
    const next = mergeLangBlock({
      existing: { lorebook: { 'h-keep': { comment: 'Untouched' } } },
      lorebookItems: [{ sourceHash: 'h-new', comment: 'Fresh' }],
    });
    expect(next.lorebook).toEqual({
      'h-keep': { comment: 'Untouched' },
      'h-new': { comment: 'Fresh' },
    });
  });

  test('empty lorebookItems and no existing lorebook: lorebook key omitted', () => {
    const next = mergeLangBlock({
      existing: { name: 'X' },
      lorebookItems: [],
    });
    expect('lorebook' in next).toBe(false);
  });

  test('does not mutate existing.lorebook reference', () => {
    const existingLore = { h1: { comment: 'Original' } };
    const existing = { lorebook: existingLore };
    mergeLangBlock({
      existing,
      lorebookItems: [{ sourceHash: 'h1', comment: 'Mutated' }],
    });
    expect(existingLore['h1']).toEqual({ comment: 'Original' });
  });

  test('parity: replicates inline shape (module variant with name + description + lorebook)', () => {
    const existing = { name: 'OldName', lorebook: { h0: { comment: 'OldHash0' } } };
    const items = [
      { sourceHash: 'h0', comment: 'NewHash0' },
      { sourceHash: 'h1', comment: 'NewHash1' },
    ];
    const newName = 'NewName';
    const newDesc = 'NewDesc';

    const inlineLore: Record<string, { comment?: string }> = { ...(existing.lorebook ?? {}) };
    for (const item of items) {
      if (!item.sourceHash) continue;
      const prior = inlineLore[item.sourceHash] ?? {};
      inlineLore[item.sourceHash] = {
        ...prior,
        ...(item.comment !== undefined ? { comment: item.comment } : {}),
      };
    }
    const inlineNext = {
      ...existing,
      ...(newName !== undefined ? { name: newName } : {}),
      ...(newDesc !== undefined ? { description: newDesc } : {}),
      ...(Object.keys(inlineLore).length > 0 ? { lorebook: inlineLore } : {}),
    };

    const helper = mergeLangBlock({
      existing,
      name: newName,
      description: newDesc,
      lorebookItems: items,
    });
    expect(helper).toEqual(inlineNext);
  });

  test('parity: replicates inline shape (character variant without description)', () => {
    const existing = { name: 'C-Old' };
    const items = [{ sourceHash: 'h-c', comment: 'CharComment' }];
    const newName = 'C-New';

    const inlineLore: Record<string, { comment?: string }> = {};
    for (const item of items) {
      if (!item.sourceHash) continue;
      const prior = inlineLore[item.sourceHash] ?? {};
      inlineLore[item.sourceHash] = {
        ...prior,
        ...(item.comment !== undefined ? { comment: item.comment } : {}),
      };
    }
    const inlineNext = {
      ...existing,
      ...(newName !== undefined ? { name: newName } : {}),
      ...(Object.keys(inlineLore).length > 0 ? { lorebook: inlineLore } : {}),
    };

    const helper = mergeLangBlock({
      existing,
      name: newName,
      lorebookItems: items,
    });
    expect(helper).toEqual(inlineNext);
  });
});
