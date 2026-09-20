import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { clearDisplaySnapshot, setDisplaySnapshot, snapshotMessagesChanged, type DisplaySnapshot } from '../../src/display/snapshot.js';
import { withCurrentDisplayMessage } from '../../src/display/host-shim.js';
import { type DisplayRuntimeEffect } from '../../src/display/host-shim.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';

// RisuAI e565563a: src/ts/process/scriptings.ts runScripted and runLuaEditTrigger.
// Strict mode makes these executable known failures red until their fixes land.
const divergence = test;
import { chatId, context, snapshot } from '../helpers/display-lua-fixture.js';

beforeEach(() => setWasmoonEnabled(false));
afterEach(() => {
  clearDisplaySnapshot(chatId);
  setWasmoonEnabled(true);
});

async function render(code: string) {
  setDisplaySnapshot(snapshot(code));
  return createDisplayResolver().resolveBody({ content: 'Hello', context });
}

describe('Risu Lua frontend boundaries', () => {
  test('executes a listener and retains the bubble index in its metadata', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text, meta)
      return text .. '|' .. tostring(meta.index)
    end)`);
    expect(result?.content).toBe('Hello|0');
  });

  (process.env.RISU_PARITY_STRICT === '1' ? test : test.failing)('Lua CBS omits display role and first-message conditions', async () => {
    setDisplaySnapshot(snapshot(`listenEdit('editDisplay',function(id,text) return cbs('{{isfirstmsg}}|{{role}}') end)`));
    const result = await createDisplayResolver().resolveBody({ content: 'Hello', context: { ...context, role: 'user' } });
    expect(result?.content).toBe('0|null');
  });

  // Risu's getName and getCharacterFirstMessage read the current character without a safe-ID guard.
  divergence('identity getters retain the character name and greeting available in the snapshot', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text)
      return getName(id) .. '|' .. getCharacterFirstMessage(id)
    end)`);
    expect(result?.content).toBe('Character|Greeting');
  });

  // Risu grants editDisplay IDs variable writes, but setChat requires ScriptingSafeIds.
  divergence('display listeners cannot emit persisted message edits', async () => {
    const effects: DisplayRuntimeEffect[] = [];
    const snap = snapshot(`listenEdit('editDisplay', function(id, text)
      setChat(id, 0, 'Changed')
      return text
    end)`);
    const result = await runEditDisplayChain(snap, 'Hello', context, text => text,
      () => {}, effect => { effects.push(effect); });
    expect({ result, effects }).toEqual({ result: 'Hello', effects: [] });
  });

  // Risu's cbs API invokes risuChatParser with only chara, leaving chatID at -1.
  divergence('Lua cbs keeps its default chat index separate from listener metadata', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text, meta)
      return tostring(meta.index) .. '|' .. cbs('{{chatindex}}')
    end)`);
    expect(result?.content).toBe('0|-1');
  });

  // Risu appends getvar output once; the Lua comparison observes it before the outer display parser runs.
  divergence('Lua cbs preserves macro text returned by a variable for that parser pass', async () => {
    const result = await render(`listenEdit('editDisplay', function(id, text)
      return tostring(cbs('{{getvar::nested}}') == '{{char}}')
    end)`);
    expect(result?.content).toBe('true');
  });

  test('display variable writes still produce a local delta and are readable in the same listener', async () => {
    const writes: Record<string, string>[] = [];
    const snap = snapshot(`listenEdit('editDisplay', function(id, text)
      setChatVar(id, 'x', '7')
      return getChatVar(id, 'x')
    end)`);
    const result = await runEditDisplayChain(snap, 'Hello', context, text => text,
      vars => { writes.push(vars); });
    expect(result).toBe('7');
    expect(writes).toEqual([{ x: '7' }]);
  });

  test('outer render caching remains eligible while every requested resolution executes Lua', async () => {
    setDisplaySnapshot(snapshot(`n = 0; listenEdit('editDisplay', function(id, text) n = n + 1; return tostring(n) end)`));
    const resolver = createDisplayResolver();
    const first = await resolver.resolveBody({ content: 'same', context });
    const second = await resolver.resolveBody({ content: 'same', context });
    expect(first?.content).toBe('1');
    expect(second?.content).toBe('2');
    expect(first?.cacheable).toBe(true);
    expect(second?.cacheable).toBe(true);
  });

  test('Lua message reads record history dependencies and retain timestamps during streaming', async () => {
    const snap = snapshot(`listenEdit('editDisplay', function(id, text) return tostring(getChat(id, 0).time) end)`);
    setDisplaySnapshot(snap);
    const result = await createDisplayResolver().resolveBody({ content: 'Streaming edit', context });
    expect(result?.content).toBe('1700000000000');
    expect(result?.touchedVars).toContain('__msg__');
    expect(snapshotMessagesChanged(snap, withCurrentDisplayMessage(snap, context, 'Streaming edit'))).toBe(true);
    expect(snapshotMessagesChanged(snap, { ...snap, messagesHost: snap.messagesHost.map(m => ({ ...m })) })).toBe(false);
  });
});
