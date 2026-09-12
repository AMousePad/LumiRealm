import { describe, expect, it } from 'bun:test';
import { transformPresetTemplate } from '../../../src/core/preset/risup-translator.js';

describe('transformPresetTemplate', () => {
  it('preserves text without macros', () => {
    expect(transformPresetTemplate('Hello world')).toBe('Hello world');
  });

  it('translates {{? ...}} into {{risuCalc::...}}', () => {
    const input = '{{#if {{? {{getglobalvar::toggle_foo}} = 3}}}}Matched{{/if}}';
    const output = transformPresetTemplate(input);
    expect(output).toBe('{{#if {{risuCalc::{{var::toggle_foo}} = 3}}}}Matched{{/if}}');
  });

  it('translates nested parentheses and logic helpers in calc', () => {
    const input = '{{#if {{and::{{not_equal::{{getglobalvar::toggle_bar}}::null}}::{{? {{getglobalvar::toggle_bar}}>0}}}}}}Yes{{/if}}';
    const output = transformPresetTemplate(input);
    expect(output).toBe('{{#if {{risuAnd::{{ne::{{var::toggle_bar}}::null}}::{{risuCalc::{{var::toggle_bar}}>0}}}}}}Yes{{/if}}');
  });

  it('translates boolean helpers: contains, length, or, any, not, equal', () => {
    const input = '{{#if {{not::{{contains::{{getglobalvar::toggle_tags}}::nsfw}}}}}}{{equal::{{length::foo}}::3}}{{/if}}';
    const output = transformPresetTemplate(input);
    expect(output).toBe('{{#if {{risuNot::{{risuContains::{{var::toggle_tags}}::nsfw}}}}}}{{eq::{{risuLength::foo}}::3}}{{/if}}');
  });

  it('normalizes {{#if_pure ...}} and {{/if_pure}} to standard if tags', () => {
    const input = '{{#if_pure {{? {{getglobalvar::toggle_cueinput}}=1}}}}Name: {{/if}}{{/if_pure}}';
    const output = transformPresetTemplate(input);
    expect(output).toBe('{{#if {{risuCalc::{{var::toggle_cueinput}}=1}}}}Name: {{/if}}{{/if}}');
  });

  it('names numbered and anonymous conditional closers for the host', () => {
    expect(transformPresetTemplate('{{#if 1}}A{{/7}}')).toBe('{{#if 1}}A{{/if}}');
    expect(transformPresetTemplate('{{#if_pure 0}}A{{/}}')).toBe('{{#if 0}}A{{/if}}');
  });

  it('pairs arbitrary closers with the innermost block', () => {
    const input = '{{#if 1}}A{{#if 0}}B{{/2}}C{{/1}}';
    expect(transformPresetTemplate(input)).toBe('{{#if 1}}A{{#if 0}}B{{/if}}C{{/if}}');
    expect(transformPresetTemplate('{{#if 1}}{{#each a as x}}B{{/9}}{{/8}}'))
      .toBe('{{#if 1}}{{#each a as x}}B{{/each}}{{/if}}');
    expect(transformPresetTemplate('{{#if 1}}A{{/other}}')).toBe('{{#if 1}}A{{/if}}');
  });

  it('keeps nested condition macros intact and leaves orphan closers unchanged', () => {
    expect(transformPresetTemplate('{{/7}}{{#if {{? 1}}}}A{{/8}}{{/}}'))
      .toBe('{{/7}}{{#if {{risuCalc::1}}}}A{{/if}}{{/}}');
    expect(transformPresetTemplate('{{// note}}{{#if 1}}A{{/if}}'))
      .toBe('{{// note}}{{#if 1}}A{{/if}}');
  });
});
