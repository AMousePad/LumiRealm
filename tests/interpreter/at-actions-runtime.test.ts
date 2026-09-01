import { describe, test, expect } from 'bun:test';
import {
  runAtActionsForPhase,
  getRuntimeAtActionDependencies,
  coerceAtActions,
  coerceAtActionsFromScripts,
  type RuntimeAtAtAction,
} from '../../src/interpreter/at-actions-runtime.js';
import type { HostApi, HostMessage } from '../../src/interpreter/host.js';

// Risu source: `processScriptFull` per-action switch case, Risu's scripts.ts:160-289.

interface MockApiState {
  expressionsSet: string[];
  messages: HostMessage[];
  edits: Array<{ id: string; content: string }>;
}

function makeMockApi(messages: HostMessage[] = []): { api: HostApi; state: MockApiState } {
  const state: MockApiState = { expressionsSet: [], messages, edits: [] };
  const api: HostApi = {
    chat: {
      getMessages: async () => state.messages,
      sendMessage: async () => ({ id: 'm' }),
      editMessage: async (id, content) => {
        state.edits.push({ id, content });
      },
      deleteMessage: async () => {},
      getMetadata: async () => null,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
      setExpression: async (name: string) => {
        state.expressionsSet.push(name);
      },
    },
  };
  return { api, state };
}

describe('runAtActionsForPhase: empty / no-match', () => {
  test('returns input unchanged when no actions', async () => {
    const { api } = makeMockApi();
    const out = await runAtActionsForPhase([], 'editoutput', 'hello', {
      api,
      chatIndex: 0,
    });
    expect(out).toBe('hello');
  });

  test('phase filter: actions for other phases are skipped', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      { action: 'emo', findRegex: 'happy', flag: '', out: '@@emo joy', phase: 'editinput', order: 0 },
    ];
    const out = await runAtActionsForPhase(actions, 'editoutput', 'happy day', { api, chatIndex: 0 });
    expect(out).toBe('happy day');
    expect(state.expressionsSet).toEqual([]); // editinput action didn't fire
  });
});

describe('@@emo', () => {
  test('matches → setExpression called with name', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      { action: 'emo', findRegex: '\\bhappy\\b', flag: '', out: '@@emo joyful', phase: 'editoutput', order: 0 },
    ];
    const out = await runAtActionsForPhase(actions, 'editoutput', 'I am happy', { api, chatIndex: 0 });
    expect(state.expressionsSet).toEqual(['joyful']);
    expect(out).toBe('I am happy'); // emo doesn't mutate text
  });

  test('no match → no setExpression call', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      { action: 'emo', findRegex: '\\bsad\\b', flag: '', out: '@@emo gloom', phase: 'editoutput', order: 0 },
    ];
    await runAtActionsForPhase(actions, 'editoutput', 'I am happy', { api, chatIndex: 0 });
    expect(state.expressionsSet).toEqual([]);
  });
});

describe('@@repeat_back', () => {
  test('no match in current data → walks back, appends prior match', async () => {
    const { api } = makeMockApi([
      { id: 'm0', role: 'assistant', content: 'Greeting hello [TOKEN: alpha]' },
      { id: 'm1', role: 'user', content: 'user reply' },
      { id: 'm2', role: 'assistant', content: 'no token here' },
    ]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: '\\[TOKEN: \\w+\\]',
        flag: '',
        out: '@@repeat_back end',
        phase: 'editoutput',
        order: 0,
      },
    ];
    // chatIndex=1 means we're processing assistant m2 (Risu frame:
    // greeting at -1, user m1 at 0, assistant m2 at 1).
    const out = await runAtActionsForPhase(
      actions,
      'editoutput',
      'no token here',
      { api, chatIndex: 1, role: 'assistant' },
    );
    // Walked back through user m1 (skipped, role mismatch) → assistant
    // m0 (greeting) which has [TOKEN: alpha]. Appended.
    expect(out).toBe('no token here[TOKEN: alpha]');
  });

  test('match in current data → ordinary replacement and CBS reparse', async () => {
    const { api } = makeMockApi([
      { id: 'm0', role: 'assistant', content: '[TOKEN: alpha]' },
    ]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: '\\[TOKEN: \\w+\\]',
        flag: '',
        out: '@@repeat_back end',
        phase: 'editoutput',
        order: 0,
      },
    ];
    const out = await runAtActionsForPhase(
      actions,
      'editoutput',
      'current has [TOKEN: beta] in it',
      {
        api,
        chatIndex: 1,
        role: 'assistant',
        resolveTemplate: (text) => text.replace('@@repeat_back end', 'resolved'),
      },
    );
    expect(out).toBe('current has resolved in it');
  });

  test('tests only the nearest prior same-role message', async () => {
    const { api } = makeMockApi([
      { id: 'g', role: 'assistant', content: '[TOKEN: greeting]' },
      { id: 'm1', role: 'assistant', content: '[TOKEN: older]' },
      { id: 'm2', role: 'assistant', content: 'nearest has no token' },
    ]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: '\\[TOKEN: \\w+\\]',
        flag: '',
        out: '@@repeat_back end',
        phase: 'editoutput',
        order: 0,
      },
    ];

    const out = await runAtActionsForPhase(
      actions,
      'editoutput',
      'current',
      { api, chatIndex: 2, role: 'assistant' },
    );

    expect(out).toBe('current');
  });

  test('chatIndex === -1 (greeting) → no-op (Risu parity scripts.ts:252)', async () => {
    const { api } = makeMockApi([]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: 'X',
        flag: '',
        out: '@@repeat_back start',
        phase: 'editoutput',
        order: 0,
      },
    ];
    const out = await runAtActionsForPhase(actions, 'editoutput', 'data', {
      api,
      chatIndex: -1,
    });
    expect(out).toBe('data');
  });

  test('start position prepends instead of appends', async () => {
    const { api } = makeMockApi([
      { id: 'm0', role: 'assistant', content: '[T]' },
    ]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: '\\[T\\]',
        flag: '',
        out: '@@repeat_back start',
        phase: 'editoutput',
        order: 0,
      },
    ];
    const out = await runAtActionsForPhase(actions, 'editoutput', 'cur', {
      api,
      chatIndex: 1,
      role: 'assistant',
    });
    expect(out).toBe('[T]cur');
  });

  test('preserves literal split behavior when the directive has two spaces', async () => {
    const { api } = makeMockApi([
      { id: 'm0', role: 'assistant', content: '[T]' },
    ]);
    const actions: RuntimeAtAtAction[] = [
      {
        action: 'repeat_back',
        findRegex: '\\[T\\]',
        flag: '',
        out: '@@repeat_back  start_nl',
        phase: 'editoutput',
        order: 0,
      },
    ];

    const out = await runAtActionsForPhase(
      actions,
      'editoutput',
      'cur',
      { api, chatIndex: 1, role: 'assistant' },
    );
    expect(out).toBe('cur[T]');
  });

  test('unknown explicit placement leaves text unchanged', async () => {
    const { api } = makeMockApi([
      { id: 'm0', role: 'assistant', content: '[T]' },
    ]);
    const actions: RuntimeAtAtAction[] = [{
      action: 'repeat_back',
      findRegex: '\\[T\\]',
      flag: '',
      out: '@@repeat_back sideways',
      phase: 'editoutput',
      order: 0,
    }];
    const out = await runAtActionsForPhase(
      actions,
      'editoutput',
      'cur',
      { api, chatIndex: 1, role: 'assistant' },
    );
    expect(out).toBe('cur');
  });
});

describe('@@inject', () => {
  test('stores the full current text through the host effect then removes the match', async () => {
    const { api, state } = makeMockApi([
      { id: 'g', role: 'assistant', content: 'greeting' },
      { id: 'u', role: 'user', content: 'user' },
      { id: 'a', role: 'assistant', content: 'old' },
    ]);
    const actions: RuntimeAtAtAction[] = [{
      action: 'inject',
      findRegex: '\\[STATE\\]',
      flag: 'g',
      out: '@@inject',
      phase: 'editdisplay',
      order: 0,
    }];
    const input = 'before [STATE] after';
    const out = await runAtActionsForPhase(
      actions,
      'editdisplay',
      input,
      { api, chatIndex: 1, role: 'assistant' },
    );
    expect(out).toBe('before  after');
    expect(state.edits).toEqual([{ id: 'a', content: input }]);
  });

  test('greeting match follows the ordinary replacement branch', async () => {
    const { api, state } = makeMockApi([
      { id: 'g', role: 'assistant', content: '[STATE]' },
    ]);
    const actions: RuntimeAtAtAction[] = [{
      action: 'inject',
      findRegex: '\\[STATE\\]',
      flag: '',
      out: '@@inject',
      phase: 'editdisplay',
      order: 0,
    }];
    const out = await runAtActionsForPhase(
      actions,
      'editdisplay',
      '[STATE]',
      { api, chatIndex: -1, role: 'assistant' },
    );
    expect(out).toBe('@@inject');
    expect(state.edits).toEqual([]);
  });
});

describe('@@move_top / @@move_bottom', () => {
  test('direct move_top removes one match and expands capture templates', async () => {
    const { api } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [{
      action: 'move_top',
      findRegex: '\\[NOTICE: ([^\\]]+)\\]',
      flag: 'g',
      out: '@@move_top notice=$1/$&',
      phase: 'editdisplay',
      order: 0,
    }];
    const out = await runAtActionsForPhase(
      actions,
      'editdisplay',
      'a [NOTICE: one] b [NOTICE: two]',
      { api, chatIndex: 0 },
    );
    expect(out).toBe(
      'notice=one/[NOTICE: one]\na  b [NOTICE: two]',
    );
  });

  test('flag-meta move_bottom uses the ordinary OUT text', async () => {
    const { api } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [{
      action: 'move_bottom',
      flagActions: ['move_bottom'],
      findRegex: 'X(\\d)',
      flag: 'g',
      out: 'bottom-$1',
      phase: 'editdisplay',
      order: 0,
    }];
    const out = await runAtActionsForPhase(
      actions,
      'editdisplay',
      'X1 mid X2',
      { api, chatIndex: 0 },
    );
    expect(out).toBe(' mid X2\nbottom-1');
  });
});

describe('flag-meta runtime behavior', () => {
  test('<cbs> resolves IN and reparses the ordinary replacement result', async () => {
    const { api } = makeMockApi();
    const calls: string[] = [];
    const actions: RuntimeAtAtAction[] = [{
      action: 'replace',
      flagActions: ['cbs'],
      findRegex: '{{pattern}}',
      flag: 'g',
      out: '<b>{{value}}</b>',
      phase: 'editdisplay',
      order: 0,
    }];
    const out = await runAtActionsForPhase(
      actions,
      'editdisplay',
      'A A',
      {
        api,
        chatIndex: 0,
        resolveTemplate: (text) => {
          calls.push(text);
          return text
            .replaceAll('{{pattern}}', 'A')
            .replaceAll('{{value}}', 'ok');
        },
      },
    );
    expect(out).toBe('<b>ok</b>\n <b>ok</b>\n');
    expect(calls).toEqual([
      '{{pattern}}',
      '<b>{{value}}</b>\n <b>{{value}}</b>\n',
    ]);
  });

  test('<no_end_nl> suppresses Risu HTML newline suffix', async () => {
    const { api } = makeMockApi();
    const base: RuntimeAtAtAction = {
      action: 'replace',
      findRegex: 'X',
      flag: '',
      out: '<span>ok</span>',
      phase: 'editdisplay',
      order: 0,
    };
    expect(await runAtActionsForPhase(
      [base],
      'editdisplay',
      'X',
      { api, chatIndex: 0 },
    )).toBe('<span>ok</span>\n');
    expect(await runAtActionsForPhase(
      [{ ...base, flagActions: ['no_end_nl'] }],
      'editdisplay',
      'X',
      { api, chatIndex: 0 },
    )).toBe('<span>ok</span>');
  });
});

describe('per-action isolation', () => {
  test('one bad regex does not abort siblings', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      // Invalid regex — will throw during compile.
      { action: 'emo', findRegex: '[invalid(', flag: '', out: '@@emo bad', phase: 'editoutput', order: 0 },
      // Valid — should still fire.
      { action: 'emo', findRegex: 'happy', flag: '', out: '@@emo joy', phase: 'editoutput', order: 1 },
    ];
    await runAtActionsForPhase(actions, 'editoutput', 'happy', { api, chatIndex: 0 });
    expect(state.expressionsSet).toEqual(['joy']); // bad regex skipped, joy fired
  });
});

describe('coerceAtActions', () => {
  test('drops rows missing required fields', () => {
    const out = coerceAtActions([
      null,
      { action: 'unknown' as unknown },
      { action: 'emo', script: { in: 'x', out: '@@emo y' }, flag: '', phase: 'editoutput', order: 0 },
      { action: 'emo', script: {}, flag: '', phase: 'editoutput', order: 0 }, // no `in`
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.action).toBe('emo');
  });

  test('preserves order field', () => {
    const out = coerceAtActions([
      { action: 'emo', script: { in: 'a', out: '@@emo a', flag: 'g<order 5>', ableFlag: true }, flag: '', phase: 'editoutput', order: 5 },
      { action: 'emo', script: { in: 'b', out: '@@emo b', flag: 'g<order 2>', ableFlag: true }, flag: '', phase: 'editoutput', order: 2 },
    ]);
    expect(out[0]!.order).toBe(5);
    expect(out[1]!.order).toBe(2);
    expect(out.every((action) => action.hasExplicitOrder)).toBe(true);
  });

  test('preserves mapper flag actions and direct-action identity', () => {
    const out = coerceAtActions([{
      action: 'repeat_back',
      actions: ['cbs', 'repeat_back'],
      script: {
        in: '{{find}}',
        out: '@@repeat_back end',
        flag: 'gi<cbs><repeat_back>',
        ableFlag: true,
      },
      flag: 'gi',
      phase: 'editprocess',
      order: 0,
    }]);
    expect(out).toEqual([expect.objectContaining({
      action: 'repeat_back',
      directAction: 'repeat_back',
      flagActions: ['cbs', 'repeat_back'],
      phase: 'editprocess',
    })]);
  });
});

describe('coerceAtActionsFromScripts', () => {
  test('projects every direct action and supported flag-meta action', () => {
    const out = coerceAtActionsFromScripts([
      { in: 'a', out: '@@emo joy', type: 'editdisplay' },
      { in: 'b', out: '@@inject', type: 'editdisplay' },
      { in: 'c', out: '@@move_top $&', type: 'editdisplay' },
      { in: 'd', out: '@@move_bottom $&', type: 'editdisplay' },
      { in: 'e', out: '@@repeat_back end', type: 'editdisplay' },
      {
        in: '{{f}}',
        out: 'replacement',
        type: 'editprocess',
        ableFlag: true,
        flag: 'gi<cbs, repeat_back><order 7>',
      },
    ], 'module:m1');
    expect(out.map((action) => action.action)).toEqual([
      'emo',
      'inject',
      'move_top',
      'move_bottom',
      'repeat_back',
      'repeat_back',
    ]);
    expect(out[5]).toEqual(expect.objectContaining({
      flagActions: ['cbs', 'repeat_back'],
      flag: 'gi',
      order: 7,
      hasExplicitOrder: true,
      sourceOrigin: 'module:m1',
      sourceIndex: 5,
    }));
    expect(out[5]?.directAction).toBeUndefined();
  });

  test('missing/false ableFlag ignores angle-bracket meta actions like Risu', () => {
    expect(coerceAtActionsFromScripts([{
      in: 'x',
      out: 'y',
      type: 'editdisplay',
      flag: 'g<inject>',
    }], 'module:m1')).toEqual([]);
  });
});

describe('getRuntimeAtActionDependencies', () => {
  test('reports cache dependencies without marking pure text moves volatile', () => {
    expect(getRuntimeAtActionDependencies({
      action: 'move_top',
      flagActions: ['move_top'],
      findRegex: 'x',
      flag: '',
      out: 'x',
      phase: 'editdisplay',
      order: 0,
    })).toEqual({ messages: false, effects: false });
    expect(getRuntimeAtActionDependencies({
      action: 'repeat_back',
      directAction: 'repeat_back',
      flagActions: ['inject'],
      findRegex: 'x',
      flag: '',
      out: '@@repeat_back',
      phase: 'editdisplay',
      order: 0,
    })).toEqual({ messages: true, effects: true });
  });
});

describe('order-stable dispatch', () => {
  test('preserves declaration order without an explicit order directive', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo third', phase: 'editoutput', order: 30 },
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo first', phase: 'editoutput', order: 10 },
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo second', phase: 'editoutput', order: 20 },
    ];
    await runAtActionsForPhase(actions, 'editoutput', 'X', { api, chatIndex: 0 });
    expect(state.expressionsSet).toEqual(['third', 'first', 'second']);
  });

  test('sorts explicit order descending and leaves unannotated actions at zero', async () => {
    const { api, state } = makeMockApi();
    const actions: RuntimeAtAtAction[] = [
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo zero-a', phase: 'editoutput', order: 0 },
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo low', phase: 'editoutput', order: 10, hasExplicitOrder: true },
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo high', phase: 'editoutput', order: 30, hasExplicitOrder: true },
      { action: 'emo', findRegex: 'X', flag: '', out: '@@emo zero-b', phase: 'editoutput', order: 0 },
    ];
    await runAtActionsForPhase(actions, 'editoutput', 'X', { api, chatIndex: 0 });
    expect(state.expressionsSet).toEqual(['high', 'low', 'zero-a', 'zero-b']);
  });
});
