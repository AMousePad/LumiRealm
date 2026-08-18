import { expect, test } from 'bun:test';

import { createBgHtmlRefresher } from './bg-html.js';

test('does not publish background output from a stale refresh', async () => {
  const sent: unknown[] = [];
  const lastSent = new Map<string, string>();
  let current = true;
  const refresher = createBgHtmlRefresher({
    resolveReadonly: async () => {
      current = false;
      return '<div>background</div>';
    },
    lastSentBgHtmlByChat: lastSent,
    send: (message) => { sent.push(message); },
    listLiveCharacterCrossRuleRules: async () => [],
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    errMsg: String,
  });

  await refresher.refresh({
    card: {
      character_id: 'character',
      risuPayload: {
        background_html: '<div>background</div>',
        module_background_embedding: '',
      },
    },
  } as never, 'chat', 'user', () => current);

  expect(sent).toEqual([]);
  expect(lastSent.size).toBe(0);
});
