/**
 * substituteForPreview tests — Phase F.
 *
 * Covers the smallest-substitution helper that powers the Portal-tab
 * sandboxed iframe preview. Goal is "user recognizes their panel by
 * structure" — full fidelity is the chat-runtime's job.
 */

import { describe, test, expect } from 'bun:test';
import { substituteForPreview } from '../../src/core/preview/substitute.js';

describe('substituteForPreview: empty / passthrough', () => {
  test('empty string → empty string', () => {
    expect(substituteForPreview('')).toBe('');
  });

  test('plain HTML with no macros / captures passes through unchanged', () => {
    const html = '<div class="panel"><span>plain content</span></div>';
    expect(substituteForPreview(html)).toBe(html);
  });

  test('unknown macros pass through verbatim', () => {
    expect(substituteForPreview('{{somerandommacro::arg}}'))
      .toBe('{{somerandommacro::arg}}');
  });
});

describe('substituteForPreview: built-in name macros', () => {
  test('{{user}} → context userName', () => {
    expect(substituteForPreview('Hello {{user}}', { userName: 'Alice' }))
      .toBe('Hello Alice');
  });

  test('{{char}} → context charName', () => {
    expect(substituteForPreview('I am {{char}}', { charName: 'Bora' }))
      .toBe('I am Bora');
  });

  test('{{character}} alias also resolves to charName', () => {
    expect(substituteForPreview('I am {{character}}', { charName: 'Bora' }))
      .toBe('I am Bora');
  });

  test('{{user}} default to "User" when no name in context', () => {
    expect(substituteForPreview('Hello {{user}}'))
      .toBe('Hello User');
  });

  test('{{char}} default to "Character"', () => {
    expect(substituteForPreview('Hello {{char}}'))
      .toBe('Hello Character');
  });

  test('whitespace inside braces is trimmed', () => {
    expect(substituteForPreview('Hello {{ user }}', { userName: 'Bob' }))
      .toBe('Hello Bob');
  });
});

describe('substituteForPreview: getvar with defaults', () => {
  test('{{getvar::X}} → defaults.X when known', () => {
    expect(substituteForPreview(
      'Phase: {{getvar::phase}}',
      { defaults: { phase: 'A' } },
    )).toBe('Phase: A');
  });

  test('{{getvar::X}} preserves verbatim when X not in defaults', () => {
    expect(substituteForPreview(
      'Phase: {{getvar::unknown_var}}',
      { defaults: { phase: 'A' } },
    )).toBe('Phase: {{getvar::unknown_var}}');
  });

  test('retired prefixed names remain verbatim', () => {
    expect(substituteForPreview(
      'Phase: {{risu_getvar::phase}}',
      { defaults: { phase: 'B' } },
    )).toBe('Phase: {{risu_getvar::phase}}');
  });

  test('{{getvar::X}} preserves when defaults map is absent entirely', () => {
    expect(substituteForPreview('{{getvar::foo}}'))
      .toBe('{{getvar::foo}}');
  });
});

describe('substituteForPreview: capture refs', () => {
  test('$1 → ‹$1›', () => {
    expect(substituteForPreview('Captured: $1'))
      .toBe('Captured: ‹$1›');
  });

  test('multiple numbered captures', () => {
    expect(substituteForPreview('$1 then $2 then $3'))
      .toBe('‹$1› then ‹$2› then ‹$3›');
  });

  test('$<name> named capture', () => {
    expect(substituteForPreview('Got $<phase>'))
      .toBe('Got ‹$phase›');
  });

  test('$& full match — preserved verbatim', () => {
    expect(substituteForPreview('Match was: $&'))
      .toBe('Match was: $&');
  });

  test('$$ literal dollar — preserved verbatim', () => {
    expect(substituteForPreview('Cost: $$5'))
      .toBe('Cost: $$5');
  });
});

describe('substituteForPreview: real-world panel templates', () => {
  test('mixed macros + captures + plain HTML', () => {
    const tpl = '<div class="affection"><img src="$1"><span>{{getvar::affection_total}}%</span></div>';
    const out = substituteForPreview(tpl, {
      userName: 'Alice',
      charName: 'Bora',
      defaults: { affection_total: '45' },
    });
    expect(out).toBe('<div class="affection"><img src="‹$1›"><span>45%</span></div>');
  });

  test('greeting-style template with name + character', () => {
    const tpl = 'Hello {{user}}, I am {{char}}.';
    const out = substituteForPreview(tpl, { userName: 'Alice', charName: 'Bora' });
    expect(out).toBe('Hello Alice, I am Bora.');
  });

  test('unresolved getvar surfaces visually so user knows what is missing', () => {
    // Reviewer can see "{{getvar::not_in_defaults}}" literally → can
    // tell which macros need realtime values vs which are baked.
    const tpl = '<p>Phase: {{getvar::phase}}, Mood: {{getvar::mood_unset}}</p>';
    const out = substituteForPreview(tpl, { defaults: { phase: 'A' } });
    expect(out).toBe('<p>Phase: A, Mood: {{getvar::mood_unset}}</p>');
  });
});
