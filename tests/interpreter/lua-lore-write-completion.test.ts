import { expect, test } from 'bun:test';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime.js';
import { makeLuaDivergenceHost, divergenceLuaScriptNS } from '../helpers/lua-risu-divergence.js';

test.each([false, true])('Lua flush owns delayed lore creation and its failure: reject=%s', async reject => {
  const fixture = makeLuaDivergenceHost();
  const gate = Promise.withResolvers<void>();
  let complete = false;
  fixture.api.worldInfo!.createCharacterEntry = async entry => {
    await gate.promise;
    if (reject) throw new Error('Lore write failed');
    complete = true;
    return { ...entry, id: 'created', worldBookId: 'new-book' };
  };
  const runtime = await makeRisuTriggerRuntime(fixture.api, {}, divergenceLuaScriptNS, {
    characterId: fixture.character.id, binding: 'start',
    preloaded: { ...fixture.preloaded, lorebook: { entries: [], primaryBookId: null } },
  });
  await runtime.runLua("function onStart(id) upsertLocalLoreBook(id,'Name','Content',{}) end");
  let flushed = false;
  const flush = runtime.flush().then(() => { flushed = true; return undefined; }, error => error);
  await Bun.sleep(0);
  expect(flushed).toBe(false);
  gate.resolve();
  const error = await flush;
  if (reject) expect(String(error)).toContain('Lore write failed');
  else expect(error).toBeUndefined();
  expect(complete).toBe(!reject);
});
