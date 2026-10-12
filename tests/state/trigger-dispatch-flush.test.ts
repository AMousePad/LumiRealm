import { expect, test } from 'bun:test';
import type { ActiveCard } from '../../src/interpreter/dispatch.js';
import { createTriggerDispatcher } from '../../src/state/trigger-dispatch.js';

for (const kind of ['manual', 'button'] as const) {
  test(`${kind} dispatch awaits frontend completion before refreshing state`, async () => {
    const calls: unknown[] = [];
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const active = { card: { character_id: 'character' } } as ActiveCard;
    const dispatcher = createTriggerDispatcher({
      ensureActiveCardForChat: async () => active,
      execute: async (...args) => { calls.push(args); await pending; return undefined as never; },
      refreshBgHtml: async () => { calls.push('background'); },
      refreshVariables: async () => { calls.push('variables'); },
    });
    const done = kind === 'manual'
      ? dispatcher.dispatchManualTrigger('chat', 'run', undefined, 'user', 'session')
      : dispatcher.dispatchButtonClick('chat', 'run', undefined, 'user', 'session');
    await Promise.resolve();
    expect(calls).toEqual([['chat', 'character', kind === 'manual'
      ? { kind, name: 'run' } : { kind, value: 'run' }, 'user', 'session']]);
    complete();
    await done;
    expect(calls.slice(1)).toEqual(['background', 'variables']);
  });
}
