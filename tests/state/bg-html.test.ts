import { expect, test } from 'bun:test';
import { createBgHtmlRefresher } from '../../src/state/bg-html.js';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';

test('background refresh resolves only background HTML and preserves an empty render for layout styles', async () => {
  const resolved: string[] = [];
  const sent: unknown[] = [];
  const noop = () => {};
  const refresher = createBgHtmlRefresher({
    resolveReadonly: async text => { resolved.push(text); return text; },
    lastSentBgHtmlByChat: new Map(),
    send: message => { sent.push(message); },
    log: { info: noop, warn: noop, error: noop, debug: noop },
  });
  const active = { card: { character_id: 'character', risuPayload: {
    background_html: '<style>.background{color:red}</style>',
    at_actions: [{ out: '<style>.window{opacity:0}</style>' }],
  } } } as unknown as ActiveCard;
  await refresher.refresh(active, 'chat', 'user');
  expect(resolved).toEqual(['<style>.background{color:red}</style>']);
  expect(sent).toEqual([{ type: 'render_bg_html', chatId: 'chat', bgHtml: resolved[0] }]);
  await refresher.refresh({ card: { character_id: 'character', risuPayload: {} } } as unknown as ActiveCard, 'empty', 'user');
  expect(sent.at(-1)).toEqual({ type: 'render_bg_html', chatId: 'empty', bgHtml: '' });
});
