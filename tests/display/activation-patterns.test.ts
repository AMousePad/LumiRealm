import { expect, test } from 'bun:test';
import { ActivationPatternError, ACTIVATION_INPUT_DEP_KEY, createActivationPatternCache, hasNativeActivationFind, subscribeActivationPatternChanges } from '../../src/display/activation-patterns.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';

const context = { chatId: 'chat', characterId: 'char', personaId: 'persona', isUser: false, depth: 0 };
const activation = { source: 'ai_output', lifetime: 'latest', mappings: [{ capture: '0', value: 'yes', enabled: true, block_ids: ['block'] }] };
function rule(overrides: Partial<FeRegexScript> = {}): FeRegexScript {
  return { id: 'row', preset_id: 'preset', find_regex: '^{{getchatvar::mode}}$', replace_string: 'MATCH', flags: 'g',
    placement: ['ai_output'], substitute_macros: 'none', min_depth: null, max_depth: null, trim_strings: [],
    metadata: { prompt_activation: activation }, ...overrides };
}

test('only valid native preset activation rules use persisted input preparation', async () => {
  expect(hasNativeActivationFind(rule())).toBe(true);
  const invalid: FeRegexScript[] = [rule({ preset_id: null }), rule({ find_regex: 'plain' }), rule({ metadata: {} }),
    rule({ metadata: { prompt_activation: activation, _risu: { origin: 'character' } } }),
    rule({ metadata: { prompt_activation: activation, _risu: { origin: 'module' } } }),
    ...[null, [], {}, { ...activation, source: ['ai_output'] }, { ...activation, lifetime: 'forever' },
      { ...activation, mappings: [] }, { ...activation, mappings: Array(65).fill(activation.mappings[0]) },
      ...[{ capture: '100' }, { capture: 'bad-name' }, { value: '' }, { value: [] }, { value: [null] },
        { enabled: 1 }, { block_ids: [] }, { block_ids: [''] }].map(mapping => ({ ...activation, mappings: [{ ...activation.mappings[0], ...mapping }] }))]
      .map(prompt_activation => rule({ metadata: { prompt_activation } })),
  ];
  for (const script of invalid) expect(hasNativeActivationFind(script)).toBe(false);
  const touched = new Set<string>();
  const cache = createActivationPatternCache(async () => { throw new Error('Unexpected input request'); });
  expect((await cache.resolve(invalid, context, touched)).size).toBe(0);
  expect(touched.size).toBe(0);
});

test('concurrent bubbles share one request and collect persisted chat dependencies', async () => {
  let calls = 0;
  const cache = createActivationPatternCache(async (_preset, patterns) => {
    calls++;
    await Promise.resolve();
    return patterns.map(source => ({ source, resolved: '^saved$' }));
  });
  const touched = new Set<string>();
  const scripts = [rule(), rule({ id: 'duplicate' })];
  const results = await Promise.all(Array.from({ length: 50 }, () => cache.resolve(scripts, context, touched)));
  expect(calls).toBe(1);
  expect(results.every(result => result.get('row') === '^saved$' && result.get('duplicate') === '^saved$')).toBe(true);
  expect([...touched].sort()).toEqual([ACTIVATION_INPUT_DEP_KEY, 'chat:mode', 'local:mode'].sort());
  expect(cache.invalidate('other', ['chat:mode'])).toBe(false);
  expect(cache.invalidate('chat', ['local:unrelated'])).toBe(false);
  await cache.resolve(scripts, { ...context, depth: 5 }, touched);
  expect(calls).toBe(1);
  expect(cache.invalidate('chat', ['local:mode'])).toBe(true);
  await cache.resolve(scripts, context, touched);
  expect(calls).toBe(2);
});

test('chat, persona, character and preset contexts never share prepared values', async () => {
  let calls = 0;
  const cache = createActivationPatternCache(async (_preset, patterns) => {
    calls++;
    return patterns.map(source => ({ source, resolved: String(calls) }));
  });
  for (const delta of [{}, { chatId: 'second' }, { personaId: 'second' }, { characterId: 'second' }]) {
    await cache.resolve([rule()], { ...context, ...delta }, new Set());
  }
  await cache.resolve([rule({ preset_id: 'second' })], context, new Set());
  expect(calls).toBe(5);
});

test('preparation requests respect host count and character bounds', async () => {
  const sizes: number[] = [];
  const cache = createActivationPatternCache(async (_preset, patterns) => {
    expect(patterns.length).toBeLessThanOrEqual(100);
    expect(patterns.reduce((sum, pattern) => sum + pattern.length, 0)).toBeLessThanOrEqual(100_000);
    sizes.push(patterns.length);
    return patterns.map(source => ({ source, resolved: source }));
  });
  const scripts = Array.from({ length: 105 }, (_, i) => rule({ id: String(i), find_regex: `${i}{{char}}` }));
  expect((await cache.resolve(scripts, context, new Set())).size).toBe(105);
  expect(sizes).toEqual([100, 5]);
  sizes.length = 0;
  await cache.resolve(scripts.slice(0, 15).map(script => ({ ...script, find_regex: script.find_regex.padEnd(9000, 'x') })), context, new Set());
  expect(sizes).toEqual([11, 4]);
});

test('invalidation rejects an in-flight stale snapshot', async () => {
  let finish!: (value: { source: string; resolved: string }[]) => void;
  const cache = createActivationPatternCache(() => new Promise(resolve => { finish = resolve; }));
  const pending = cache.resolve([rule()], context, new Set());
  cache.invalidate('chat');
  finish([{ source: rule().find_regex, resolved: 'stale' }]);
  await expect(pending).rejects.toThrow(ActivationPatternError);
});

test('row errors remain explicit while successful patterns remain usable', async () => {
  const bad = rule({ id: 'bad', find_regex: '{{getchatvar::missing}}' });
  const cache = createActivationPatternCache(async (_preset, patterns) => patterns.map(source => source === bad.find_regex
    ? { source, error: 'Missing activation input' } : { source, resolved: 'saved' }));
  const resolved = await cache.resolve([rule(), bad], context, new Set());
  expect(resolved.get('row')).toBe('saved');
  expect(resolved.get('bad')).toBeInstanceOf(ActivationPatternError);
});

test('invalid responses and transport failures are not retried for every bubble', async () => {
  for (const response of [[], [{ source: 'wrong', resolved: 'x' }], [{ source: rule().find_regex }], null]) {
    let calls = 0;
    const cache = createActivationPatternCache(async () => { calls++; if (!response) throw new ActivationPatternError('HTTP 404'); return response; });
    for (let i = 0; i < 3; i++) await expect(cache.resolve([rule()], context, new Set())).rejects.toThrow(ActivationPatternError);
    expect(calls).toBe(1);
    cache.invalidate();
    await expect(cache.resolve([rule()], context, new Set())).rejects.toThrow(ActivationPatternError);
    expect(calls).toBe(2);
  }
});

test('host events refresh prepared values without invalidating on messages or unrelated variables', async () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const events = { on: (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler); return () => { handlers.delete(event); };
  }, emit: (event: string, payload: unknown) => handlers.get(event)?.(payload) };
  let calls = 0;
  const invalidated: string[][] = [];
  const cache = createActivationPatternCache(async (_preset, patterns) => { calls++; return patterns.map(source => ({ source, resolved: String(calls) })); });
  const cleanup = subscribeActivationPatternChanges(events, cache, keys => invalidated.push(keys));
  const read = () => cache.resolve([rule()], context, new Set());
  await read();
  for (const changedFields of [[], ['name'], ['metadata.message_count'], ['metadata.chat_variables', 'metadata.chat_variables.other']]) {
    events.emit('CHAT_CHANGED', { chat: { id: 'chat' }, changedFields }); await read();
  }
  events.emit('SETTINGS_UPDATED', { key: 'theme' });
  events.emit('CHAT_CHANGED', { chat: { id: 'other' }, changedFields: ['metadata.chat_variables'] });
  await read();
  expect(calls).toBe(1);
  for (const [event, payload] of [
    ['CHAT_CHANGED', { chat: { id: 'chat' }, changedFields: ['metadata.chat_variables', 'metadata.chat_variables.mode'] }],
    ['CHAT_CHANGED', { chat: { id: 'chat' }, changedFields: ['metadata.group'] }],
    ['PRESET_PROFILE_CHANGED', {}], ['PRESET_CHANGED', {}], ['REGEX_SCRIPT_CHANGED', {}],
    ['SETTINGS_UPDATED', { keys: ['activePersonaId'] }], ['CONNECTION_PROFILE_LOADED', {}], ['CONNECTED', {}], ['CHAT_SWITCHED', {}],
  ] as const) {
    const before = calls;
    events.emit(event, payload); await read();
    expect(calls).toBe(before + 1);
    expect(invalidated.at(-1)).toEqual([ACTIVATION_INPUT_DEP_KEY]);
  }
  cleanup();
  expect(handlers.size).toBe(0);
  expect(cache.invalidate()).toBe(false);
});
