import { describe, test, expect } from 'bun:test';
import { computeDepthPromptSeed } from '../../src/state/depth-prompt-seed.js';

describe('computeDepthPromptSeed', () => {
  test('seeds authors_note from a valid CCSv3 depth_prompt', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'Stay in character.', depth: 4, role: 'system' } },
      {},
    );
    expect(decision.shouldWrite).toBe(true);
    expect(decision.outcome).toBe('seeded');
    expect(decision.preservedExisting).toBe(false);
    expect(decision.nextMetadata['_lumirealm_authors_note_seeded']).toBe(true);
    expect(decision.nextMetadata['authors_note']).toEqual({
      content: 'Stay in character.',
      depth: 4,
      role: 'system',
      position: 0,
    });
  });

  test('idempotent: seed flag set → returns shouldWrite=false', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'Stay in character.', depth: 4, role: 'system' } },
      { _lumirealm_authors_note_seeded: true, authors_note: { content: 'mine', depth: 8, role: 'user', position: 0 } },
    );
    expect(decision.shouldWrite).toBe(false);
    expect(decision.outcome).toBe('already_seeded');
  });

  test('preserves user-set authors_note on first seed', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'card-side note', depth: 4, role: 'system' } },
      { authors_note: { content: 'user wrote this', depth: 2, role: 'user', position: 0 } },
    );
    expect(decision.shouldWrite).toBe(true);
    expect(decision.preservedExisting).toBe(true);
    // Flag is set even though we didn't overwrite — prevents re-prompting.
    expect(decision.nextMetadata['_lumirealm_authors_note_seeded']).toBe(true);
    // User's value retained verbatim.
    expect(decision.nextMetadata['authors_note']).toEqual({
      content: 'user wrote this',
      depth: 2,
      role: 'user',
      position: 0,
    });
  });

  test('treats whitespace-only authors_note.content as empty (overwrites)', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'card', depth: 4, role: 'system' } },
      { authors_note: { content: '   ', depth: 0, role: 'system', position: 0 } },
    );
    expect(decision.shouldWrite).toBe(true);
    expect(decision.preservedExisting).toBe(false);
    const an = decision.nextMetadata['authors_note'] as { content: string };
    expect(an.content).toBe('card');
  });

  test('skips when depth_prompt missing', () => {
    const decision = computeDepthPromptSeed({}, {});
    expect(decision.shouldWrite).toBe(false);
    expect(decision.outcome).toBe('no_depth_prompt');
  });

  test('skips when depth_prompt is empty placeholder ({prompt: ""})', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: '', depth: 0 } },
      {},
    );
    expect(decision.shouldWrite).toBe(false);
    expect(decision.outcome).toBe('no_depth_prompt');
  });

  test('skips when depth_prompt prompt is whitespace-only', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: '   \n  \t  ', depth: 0 } },
      {},
    );
    expect(decision.shouldWrite).toBe(false);
  });

  test('coerces invalid depth → 4 (Lumi default)', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 'not a number' } },
      {},
    );
    expect(decision.shouldWrite).toBe(true);
    expect((decision.nextMetadata['authors_note'] as { depth: number }).depth).toBe(4);
  });

  test('coerces negative depth → 0', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: -3 } },
      {},
    );
    expect((decision.nextMetadata['authors_note'] as { depth: number }).depth).toBe(0);
  });

  test('coerces unknown role → "system"', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4, role: 'narrator' } },
      {},
    );
    expect((decision.nextMetadata['authors_note'] as { role: string }).role).toBe('system');
  });

  test('preserves valid roles (user, assistant)', () => {
    const userDecision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4, role: 'user' } }, {},
    );
    const asstDecision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4, role: 'assistant' } }, {},
    );
    expect((userDecision.nextMetadata['authors_note'] as { role: string }).role).toBe('user');
    expect((asstDecision.nextMetadata['authors_note'] as { role: string }).role).toBe('assistant');
  });

  test('null/undefined currentMetadata accepted', () => {
    const a = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4 } }, null,
    );
    const b = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4 } }, undefined,
    );
    expect(a.shouldWrite).toBe(true);
    expect(b.shouldWrite).toBe(true);
  });

  test('does not mutate input metadata', () => {
    const input: Record<string, unknown> = { existing: 'keep' };
    const decision = computeDepthPromptSeed(
      { depth_prompt: { prompt: 'x', depth: 4 } }, input,
    );
    expect(input).toEqual({ existing: 'keep' });
    expect(decision.nextMetadata['existing']).toBe('keep');
    expect(decision.nextMetadata).not.toBe(input);
  });

  test('rejects depth_prompt that is array (not object)', () => {
    const decision = computeDepthPromptSeed(
      { depth_prompt: ['x', 4, 'system'] }, {},
    );
    expect(decision.shouldWrite).toBe(false);
  });

  test('rejects depth_prompt that is null', () => {
    const decision = computeDepthPromptSeed({ depth_prompt: null }, {});
    expect(decision.shouldWrite).toBe(false);
  });
});
