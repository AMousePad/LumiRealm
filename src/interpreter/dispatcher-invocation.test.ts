import { describe, expect, test } from 'bun:test';

import {
  prepareTriggers,
  dispatchBinding,
  dispatchByManualName,
  makeDispatcherScriptNS,
  type DispatchCtx,
} from './dispatcher.js';

// Risu: a display-declared trigger matched by comment fires on a manual click,
// and `arg.displayMode` is set by a render pass only, so the write persists.
const displayTrigger = {
  comment: 'wiki',
  type: 'display',
  conditions: [],
  effect: [{ type: 'v2SetVar', operator: '=', var: 'bahasa', value: '6', valueType: 'value', indent: 0 }],
  lowLevelAccess: false,
};

function makeCtx(): { ctx: DispatchCtx; saved: Record<string, string> } {
  const store: Record<string, unknown> = {};
  const saved: Record<string, string> = {};
  const api = {
    chat: {
      getMetadata: async (k: string) => store[k],
      setMetadata: async (k: string, v: unknown) => {
        store[k] = v;
        if (k !== 'chat_variables') return;
        for (const key of Object.keys(saved)) delete saved[key];
        Object.assign(saved, v as Record<string, string>);
      },
      getMessages: async () => [],
      getId: () => 'chat-1',
    },
    character: { get: async () => ({ name: 'x' }) },
    log: () => {},
  };
  return {
    saved,
    ctx: {
      compiledTriggers: prepareTriggers({ triggers: [displayTrigger] } as never, 'char-1'),
      api: api as never,
      data: { chatId: 'chat-1', characterId: 'char-1' } as never,
      scriptNS: makeDispatcherScriptNS(),
      opts: {} as never,
    },
  };
}

describe('trigger invocation vs declaration', () => {
  test('a display-declared trigger persists variables when clicked', async () => {
    const { ctx, saved } = makeCtx();
    const fired = await dispatchByManualName(ctx, 'wiki');
    expect(fired).toBe(1);
    expect(saved['bahasa']).toBe('6');
  });

  test('the same trigger stays ephemeral during a display render pass', async () => {
    const { ctx, saved } = makeCtx();
    await dispatchBinding(ctx, 'display');
    expect(saved).toEqual({});
  });

  test('declared displayMode does not leak into the manual invocation', () => {
    const entry = prepareTriggers({ triggers: [displayTrigger] } as never, 'char-1')
      .find((e) => e.source?.comment === 'wiki')!;
    // The compiled entry still records the declared type; only the invocation decides.
    expect(entry.binding).toBe('display');
    expect(entry.rtOpts.displayMode).toBe(true);
  });
});
