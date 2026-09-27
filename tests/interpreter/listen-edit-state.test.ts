import { afterEach, describe, expect, test } from 'bun:test';
import { clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { runListenEditChain, type ListenEditMode } from '../../src/interpreter/listen-edit';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';

afterEach(clearLuaEngines);

function fixture(x = '2') {
  const host = makeLuaDivergenceHost();
  host.metadata.chat_variables = { x };
  host.preloaded.varsCache = { $x: x };
  const writes: unknown[] = [];
  const api = { ...host.api, chat: { ...host.api.chat, setMetadata: async (key: string, value: unknown) => {
    await host.api.chat.setMetadata(key, value);
    writes.push(structuredClone(value));
  } } };
  async function run(mode: ListenEditMode, bodies: string[]) {
    return runListenEditChain(bodies.map(body => ({
      source: { effect: [{ type: 'triggerlua' }] },
      luaCode: `listenEdit('${mode}', function(id, value) ${body} end)`,
    })), mode, mode === 'editRequest' ? [{ role: 'user', content: 'Input' }] : 'Input',
    {}, api, {}, divergenceLuaScriptNS, { preloaded: host.preloaded });
  }
  return { ...host, writes, run };
}

describe('Risu runLuaEditTrigger shared chat state', () => {
  for (const mode of ['editInput', 'editOutput', 'editDisplay', 'editRequest'] as const) {
    test(`${mode} carries writes between scripts without mutating the preload`, async () => {
      const f = fixture();
      expect(await f.run(mode, [
        "setChatVar(id, 'x', '7'); return value",
        "setChatVar(id, 'y', getChatVar(id, 'x') .. '8'); return value",
        "return getChatVar(id, 'x') .. '|' .. getChatVar(id, 'y')",
      ])).toBe('7|78');
      expect(f.metadata.chat_variables).toEqual({ x: '7', y: '78' });
      expect(f.writes).toEqual([{ x: '7' }, { x: '7', y: '78' }]);
      expect(f.preloaded.varsCache).toEqual({ $x: '2' });
    });

    test(`${mode} preserves writes before its last callback fails`, async () => {
      const f = fixture();
      expect(await f.run(mode, ["setChatVar(id, 'x', '7'); error('callback failed')"]))
        .toEqual(mode === 'editRequest' ? [{ role: 'user', content: 'Input' }] : 'Input');
      expect(f.metadata.chat_variables).toEqual({ x: '7' });
    });
  }

  test('later scripts edit and remove an earlier script message', async () => {
    const f = fixture();
    expect(await f.run('editOutput', [
      "addChat(id, 'char', 'Added'); return value",
      "setChat(id, -1, 'Edited'); return getChatData(id, -1)",
      "removeChat(id, -1); return value .. '|' .. getChatData(id, -1)",
    ])).toBe('Edited|Welcome');
    expect(f.messages.map(message => message.content)).toEqual(['Greeting', 'Hello', 'Welcome']);
    expect(f.preloaded.messagesRaw).toHaveLength(3);
  });

  test('concurrent chains keep separate runtime state', async () => {
    const a = fixture('2');
    const b = fixture('100');
    const bodies = ["setChatVar(id, 'x', tostring(tonumber(getChatVar(id, 'x')) + 1)); return value",
      "return getChatVar(id, 'x')"];
    expect(await Promise.all([a.run('editOutput', bodies), b.run('editOutput', bodies)])).toEqual(['3', '101']);
    expect(a.metadata.chat_variables).toEqual({ x: '3' });
    expect(b.metadata.chat_variables).toEqual({ x: '101' });
  });
});
