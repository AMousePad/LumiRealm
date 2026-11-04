import { describe, expect, test } from 'bun:test';
import { logStore, redact } from '../../src/log/store.js';

const STORY = 'She whispered the secret name';

describe('redact with chat data off', () => {
  test.each([
    ['message split by escaped quotes', JSON.stringify({ content: `"${STORY}," he said, "and left."` })],
    ['short message', JSON.stringify({ content: STORY })],
    ['nested JSON in a string', JSON.stringify({ extra: JSON.stringify({ content: STORY }) })],
    ['frame prefix', `[WS] ← MESSAGE_EDITED ${JSON.stringify({ message: { content: STORY } })}`],
    ['cut preview', `DONE elapsed=3ms result_type=string result_preview="${STORY}`],
    ['object preview', `result_preview=${JSON.stringify([{ content: STORY }])}`],
    ['variable sample', `varsCache_sample: $note="${STORY}" $other="${STORY}"`],
    ['named field', `dispatching prompt="${STORY}" conn=abc`],
    ['non-ASCII key', JSON.stringify({ [STORY]: 1 })],
    ['value after a token key', `${JSON.stringify({ type: STORY })}`],
    ['array under an id key', JSON.stringify({ ids: [STORY] })],
    ['credential text ending a string', JSON.stringify({ a: 'my password: foo', b: STORY })],
    ['apostrophes across strings', JSON.stringify({ a: "it's", b: `${'x'.repeat(90)} it's`, c: STORY })],
    ['url query', `GET https://example.com/a?q=whispered -> 200 len=3`],
  ])('removes %s', (_name, line) => {
    expect(redact(line)).not.toContain('whispered');
  });

  test('removes short non-ASCII text', () => {
    expect(redact(JSON.stringify({ name: '엘리시온' }))).not.toContain('엘리시온');
  });

  test('removes non-ASCII names outside strings and keeps template symbols', () => {
    expect(redact('← trigger DONE name=start-엘리시온 elapsed=3ms')).toBe('← trigger DONE name=start-[REDACTED] elapsed=3ms');
  });

  test('keeps the structure needed to read a trace', () => {
    const id = '8a01088c-c601-499e-ad7e-a43b40757037';
    const line = `[WS] ← SPINDLE_PRE_GENERATION_ACTIVITY ${JSON.stringify({
      chatId: id, phase: 'context_handler', status: 'started', extensionName: 'Concurrent Alternate Trajectories',
      identifier: 'lumirealm', type: 'display_snapshot', role: 'assistant', count: 3, ok: true, imageIds: [id],
    })}`;
    expect(redact(line)).toBe(line);
  });

  test('reports the length of removed values', () => {
    expect(redact(JSON.stringify({ content: STORY }))).toBe(`{"content":"[REDACTED] len=${STORY.length}"}`);
  });

  test('is idempotent across capture and export', () => {
    const once = redact(JSON.stringify({ content: STORY, type: 'x' }));
    expect(redact(once)).toBe(once);
    const script = redact(STORY, 'runtime.lua');
    expect(redact(script, 'runtime.lua')).toBe(script);
  });

  test('still removes credentials', () => {
    const out = redact('{"auth":"Bearer abc.def","note":"sk-aaaaaaaaaaaaaaaaaaaaaaaa"} api_key=hunter2');
    for (const secret of ['abc.def', 'aaaaaaaa', 'hunter2']) expect(out).not.toContain(secret);
  });

  test('handles a large frame with many escapes in linear time', () => {
    const frame = JSON.stringify({ content: '"quote" \\ '.repeat(200_000) });
    const startedAt = performance.now();
    expect(redact(frame)).toBe(`{"content":"[REDACTED] len=${frame.length - 14}"}`);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test('script log output is removed whole when captured', () => {
    logStore.setState({ enabled: true, includeChatData: false, level: 'trace' });
    try {
      logStore.push('debug', 'runtime.lua', `plain ${STORY}`);
      expect(logStore.snapshot().events.at(-1)?.message).toBe(`[REDACTED] len=${STORY.length + 6}`);
    } finally {
      logStore.setState({ enabled: false, includeChatData: false });
    }
  });

  test('chat data on leaves lines untouched', () => {
    logStore.setState({ enabled: true, includeChatData: true, level: 'trace' });
    try {
      logStore.push('debug', 'runtime.lua', STORY);
      expect(logStore.snapshot().events.at(-1)?.message).toBe(STORY);
    } finally {
      logStore.setState({ enabled: false, includeChatData: false });
    }
  });
});
