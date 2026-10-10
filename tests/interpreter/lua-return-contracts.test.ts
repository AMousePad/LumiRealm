import { describe, expect, test } from 'bun:test';
import { makeDispatcherScriptNS } from '../../src/interpreter/dispatcher.js';
import type { HostCharacter } from '../../src/interpreter/host.js';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { execute } from '../../src/interpreter/lua-bridge.js';
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence.js';

async function setup(rejectWrites = false, characterId: string | null = 'character') {
  const character = { id: 'character', firstMessage: 'Original' };
  const updates: { id: string; patch: Partial<HostCharacter> }[] = [];
  const api = { ...makeLuaDivergenceHost().api, characters: {
    get: async () => ({ ...character }),
    update: async (id: string, patch: Partial<HostCharacter>) => {
      updates.push({ id, patch });
      if (rejectWrites) throw new Error('Update failed');
      Object.assign(character, patch);
    },
  } };
  const runtime = await makeRisuTriggerRuntime(api, {}, makeDispatcherScriptNS(execute), {
    binding: 'manual', characterId, lowLevelAccess: false,
    preloaded: { varsCache: {}, globalVars: {}, messagesRaw: [],
      lorebook: { entries: [], primaryBookId: null } },
  });
  const run = (body: string) => runtime.runLua(`probe = async(function(id) ${body} end)`, {
    entry: 'probe', args: ['invocation'],
  });
  return { run, flush: runtime.flush, character, updates };
}

// Risu's runScripted returns these values for safe IDs, independent of lowLevelAccess.
describe('Lua sleep and first-message return contracts', () => {
  test('sleep resolves to true', async () => {
    const fixture = await setup();
    expect(await fixture.run('return sleep(id, 0):await()')).toBe(true);
  });

  test.each(['Updated', ''])('stores a string and returns true: %j', async value => {
    const fixture = await setup();
    expect(await fixture.run(`return setCharacterFirstMessage(id, ${JSON.stringify(value)})`)).toBe(true);
    await fixture.flush();
    expect(fixture.character.firstMessage).toBe(value);
    expect(fixture.updates).toEqual([{ id: 'character', patch: { firstMessage: value } }]);
  });

  test.each(['nil', '42', 'false', '{}'])('rejects non-string %s without writing', async value => {
    const fixture = await setup();
    expect(await fixture.run(`return setCharacterFirstMessage(id, ${value})`)).toBe(false);
    expect(fixture.character.firstMessage).toBe('Original');
    expect(fixture.updates).toEqual([]);
  });

  test('a failed host update rejects persistence after the synchronous Lua return', async () => {
    const fixture = await setup(true);
    expect(await fixture.run(`return setCharacterFirstMessage(id, 'Updated')`)).toBe(true);
    await expect(fixture.flush()).rejects.toThrow('Update failed');
    expect(fixture.character.firstMessage).toBe('Original');
  });

  test('a missing host character target does not report a successful update', async () => {
    const fixture = await setup(false, null);
    expect(await fixture.run(`local result = setCharacterFirstMessage(id, 'Updated'); return type(result)`)).toBeUndefined();
    expect(fixture.updates).toEqual([]);
  });
});
