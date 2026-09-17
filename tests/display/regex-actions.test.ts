import { describe, expect, test } from 'bun:test';
import { decorateNativeRegexActions, type NativeRegexAction } from '../../src/display/regex-actions.js';
import { applyRegexScriptsCore, type RegexCoreScript } from '../../src/display/regex-core.js';

function action(overrides: Partial<NativeRegexAction> = {}): NativeRegexAction {
  return {
    id: 'pick', type: 'send', multi_select: false, cost: '1', limit: '5',
    title: 'Choose $1', subtitle: '', content: 'My choice: $1. {{char}}', ...overrides,
  };
}

function script(overrides: Partial<RegexCoreScript> = {}, actions = [action()]): RegexCoreScript {
  return {
    find_regex: '<choice>(.*?)</choice>', replace_string: '<button data-regex-action="pick">$1</button>',
    flags: 'g', substitute_macros: 'none', placement: ['ai_output'], target: 'display',
    min_depth: null, max_depth: null, trim_strings: [],
    decorateReplacement: (html, match, input) => decorateNativeRegexActions(html, 'choices', actions, match, input),
    ...overrides,
  };
}

function apply(content: string, scripts: RegexCoreScript[], evalTemplate = (text: string) => text, previousContent?: string): string {
  return applyRegexScriptsCore(content, scripts, {
    placement: 'ai_output', depth: 0, evalTemplate,
    ...(previousContent !== undefined ? { previousContent } : {}),
  });
}

function payloads(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/data-lumiverse-regex-action="([^"]+)"/g)]
    .map((match) => JSON.parse(decodeURIComponent(match[1]!)) as Record<string, unknown>);
}

describe('native display regex actions', () => {
  for (const mode of ['none', 'find', 'escaped', 'raw', 'after'] as const) {
    test(`binds match captures and protects action macros in ${mode} mode`, () => {
      const calls: string[] = [];
      const html = apply('<choice>left</choice> <choice>right</choice>', [script({ substitute_macros: mode })], (text) => {
        calls.push(text);
        return text.replaceAll('{{char}}', 'Character');
      });
      const bound = payloads(html);
      expect(bound.map((value) => value['content'])).toEqual(['My choice: left. {{char}}', 'My choice: right. {{char}}']);
      expect(bound.map((value) => value['instanceId'])).toEqual(['choices:0:21', 'choices:22:44']);
      expect(html).toContain(mode === 'escaped' ? '>$1</button>' : '>left</button>');
      if (mode === 'after') expect(calls.at(-1)).toContain('data-lumiverse-regex-action=');
      if (mode === 'raw') expect(calls.filter((text) => text.includes('<button'))).toEqual([
        '<button data-regex-action="pick">left</button>', '<button data-regex-action="pick">right</button>',
      ]);
    });
  }

  test('uses offsets from the current input after earlier rules change its length', () => {
    const html = apply('x<choice>left</choice>', [script({
      find_regex: '^x', replace_string: 'prefix',
    }), script()]);
    expect(payloads(html)[0]?.['instanceId']).toBe('choices:6:27');
  });

  test('uses the tightest positive multi-select limit and normalizes costs', () => {
    const actions = [
      action({ id: 'a', multi_select: true, cost: '$1', limit: '5' }),
      action({ id: 'b', type: 'append', multi_select: true, cost: 'invalid', limit: '3' }),
      action({ id: 'c', multi_select: true, limit: '-1' }),
    ];
    const html = apply('<choice>2</choice>', [script({
      replace_string: '<button data-regex-action="a"></button><button id="b"></button><input data-regex-action="c" />',
    }, actions)]);
    expect(payloads(html).map((value) => [value['type'], value['cost'], value['limit']])).toEqual([
      ['send', 2, 3], ['append', 1, 3], ['send', 1, 3],
    ]);
    expect(html.match(/data-lumiverse-regex-action-multi="true"/g)).toHaveLength(3);
  });

  test('captures state and draft values while preserving fixed keys and fork effects', () => {
    const html = apply('<choice>west</choice>', [script({}, [action({
      type: 'effects', effects: [
        { type: 'set_state', key: 'route', value: '$1' },
        { type: 'draft', mode: 'append', content: 'Go $1' }, { type: 'fork' },
      ],
    })])]);
    expect(payloads(html)[0]?.['effects']).toEqual([
      { type: 'set_state', key: 'route', value: 'west' },
      { type: 'draft', mode: 'append', content: 'Go west' }, { type: 'fork' },
    ]);
  });

  test('escapes captured labels and preserves literal payload content', () => {
    const text = 'a"&<b>🚀';
    const html = apply(text, [script({ find_regex: '([\\s\\S]+)', replace_string: '<button data-regex-action="pick">Choose</button>' })]);
    expect(payloads(html)[0]?.['title']).toBe(`Choose ${text}`);
    expect(html).toContain('title="Choose a&quot;&amp;&lt;b&gt;🚀"');
  });

  test('does not decorate unrelated or already decorated elements', () => {
    const html = '<button data-regex-action="other"></button><button data-regex-action="pick" data-lumiverse-regex-action="existing"></button>';
    expect(apply('<choice>left</choice>', [script({ replace_string: html })])).toBe(html);
  });

  test('preserves native sticky match count', () => {
    const html = apply('xx', [script({ find_regex: '(x)', flags: 'y' })]);
    expect(payloads(html)).toHaveLength(1);
    expect(html.endsWith('</button>x')).toBe(true);
  });

  test('advances empty Unicode matches by code point', () => {
    const html = apply('🚀', [script({ find_regex: '()', flags: 'gu' })]);
    expect(payloads(html).map((value) => value['instanceId'])).toEqual(['choices:0:0', 'choices:2:2']);
  });

  test('repeat-back binds the previous match and honors raw-match opt-out', () => {
    const previous = 'old <choice>left</choice>';
    const repeated = script({ matchActions: ['repeat_back'], repeatPosition: 'end' });
    expect(payloads(apply('now', [repeated], undefined, previous))[0]?.['instanceId']).toBe('choices:4:25');
    expect(apply('now', [{ ...repeated, repeatRawMatch: true }], undefined, previous)).toBe('now<choice>left</choice>');
  });

  for (const overrides of [{ disabled: true }, { min_depth: 1 }, { placement: ['user_input'] }]) {
    test(`does not decorate filtered rules: ${JSON.stringify(overrides)}`, () => {
      expect(apply('<choice>left</choice>', [script(overrides)])).toBe('<choice>left</choice>');
    });
  }
});
