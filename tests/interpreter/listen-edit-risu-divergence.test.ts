import { describe, expect, test } from 'bun:test';
import { runListenEditChain, type ListenEditMode } from '../../src/interpreter/listen-edit.js';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

const divergence = test;

// RisuAI e565563a288ebe4c65b6099a1645ba477d1c84b4, scriptings.ts: runLuaEditTrigger and runScripted.
// Runtime callback errors are caught inside runScripted; chunk compilation errors reach the outer chain catch.
async function runChain(
  codes: string[], mode: ListenEditMode = 'editOutput',
  input: string | { role: string; content: string }[] = 'Input',
) {
  const fixture = makeLuaDivergenceHost();
  const result = await runListenEditChain(
    codes.map(luaCode => ({ source: { effect: [{ type: 'triggerlua' }] }, luaCode })),
    mode, input, {}, fixture.api, { characterId: 'test-character' }, divergenceLuaScriptNS,
    { chatId: 'test-chat', characterId: 'test-character', preloaded: fixture.preloaded },
  );
  return { ...fixture, result };
}

describe('listenEdit Risu divergences', () => {
  test('control: threads successful hook output', async () => {
    const fixture = await runChain([
      `listenEdit('editOutput', function(id, value) return value .. ' A' end)`,
      `listenEdit('editOutput', function(id, value) return value .. ' B' end)`,
    ]);
    expect(fixture.result).toBe('Input A B');
  });

  test('control: listeners in one script read each other\'s variable writes', async () => {
    const fixture = await runChain([`
      listenEdit('editOutput', function(id, value) setChatVar(id, 'x', '7'); return value end)
      listenEdit('editOutput', function(id, value) return getChatVar(id, 'x') end)
    `]);
    expect(fixture.result).toBe('7');
  });

  test('control: nil reaches the next listener within one script', async () => {
    const fixture = await runChain([`
      listenEdit('editOutput', function(id, value) return nil end)
      listenEdit('editOutput', function(id, value) return type(value) end)
    `]);
    expect(fixture.result).toBe('nil');
  });

  divergence('later trigger scripts read variables written by earlier scripts', async () => {
    const fixture = await runChain([
      `listenEdit('editOutput', function(id, value) setChatVar(id, 'x', '7'); return value end)`,
      `listenEdit('editOutput', function(id, value) return getChatVar(id, 'x') end)`,
    ]);
    expect(fixture.result).toBe('7');
  });

  divergence('later variable writes preserve earlier persisted writes', async () => {
    const fixture = await runChain([
      `listenEdit('editOutput', function(id, value) setChatVar(id, 'x', '7'); return value end)`,
      `listenEdit('editOutput', function(id, value) setChatVar(id, 'y', '8'); return value end)`,
    ]);
    expect(fixture.metadata.chat_variables).toEqual({ x: '7', y: '8' });
  });

  for (const mode of ['editInput', 'editOutput', 'editDisplay', 'editRequest'] as const) {
    divergence(`${mode} preserves its input when a trigger returns nil`, async () => {
      const input = mode === 'editRequest' ? [{ role: 'user', content: 'Input' }] : 'Input';
      const fixture = await runChain([`listenEdit('${mode}', function(id, value) return nil end)`], mode, input);
      expect(fixture.result).toEqual(input);
    });
  }

  divergence('a chunk compilation error aborts the chain and restores its original input', async () => {
    const fixture = await runChain([
      `listenEdit('editOutput', function(id, value) return value .. ' A' end)`,
      `function incomplete(`,
      `listenEdit('editOutput', function(id, value) setChatVar(id, 'late', '1'); return 'Later' end)`,
    ]);
    expect({ result: fixture.result, variables: fixture.metadata.chat_variables }).toEqual({
      result: 'Input', variables: { x: '2' },
    });
  });

  test('control: a callback error preserves prior output and allows the next trigger', async () => {
    const fixture = await runChain([
      `listenEdit('editOutput', function(id, value) return value .. ' A' end)`,
      `listenEdit('editOutput', function(id, value) error('callback failure') end)`,
      `listenEdit('editOutput', function(id, value) return value .. ' B' end)`,
    ]);
    expect(fixture.result).toBe('Input A B');
  });
});
