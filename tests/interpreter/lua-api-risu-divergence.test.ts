import { describe, expect, test } from 'bun:test';
import { captureLuaRuntime } from '../helpers/lua-risu-divergence.js';

const divergence = process.env.RISU_PARITY_STRICT === '1' ? test : test.failing;

// RisuAI e565563a288ebe4c65b6099a1645ba477d1c84b4, src/ts/process/scriptings.ts: runScripted declareAPI callbacks.
// Expected failures assert Risu's contract; promote each divergence to test when its adapter is fixed.
describe('Lua API Risu divergences', () => {
  test('control: reads and persists chat variables', async () => {
    const fixture = await captureLuaRuntime();
    expect(await fixture.call('getChatVar', 'x')).toBe('2');
    await fixture.call('setChatVar', 'x', '7');
    expect(await fixture.call('getChatVar', 'x')).toBe('7');
    await fixture.runtime.flush();
    expect(fixture.metadata.chat_variables).toEqual({ x: '7' });
  });

  for (const name of ['setChatVarChanged', 'getChatData', 'getChatRole', 'getRecentChatsMain']) {
    test(`registers ${name}`, async () => {
      const fixture = await captureLuaRuntime();
      expect(typeof fixture.globals[name]).toBe('function');
    });
  }

  test('getChat includes the original message timestamp', async () => {
    const fixture = await captureLuaRuntime();
    expect(JSON.parse(String(await fixture.call('getChatMain', 0)))).toEqual({
      role: 'user', data: 'Hello', time: 1700000000000,
    });
  });

  test('getFullChat includes timestamps for every message', async () => {
    const fixture = await captureLuaRuntime();
    expect(JSON.parse(String(await fixture.call('getFullChatMain')))).toEqual([
      { role: 'user', data: 'Hello', time: 1700000000000 },
      { role: 'char', data: 'Welcome', time: 1700000005000 },
    ]);
  });

  test('control: negative integer getChat reads the last message', async () => {
    const fixture = await captureLuaRuntime();
    expect(JSON.parse(String(await fixture.call('getChatMain', -1))).data).toBe('Welcome');
  });

  for (const index of [0.5, -0.5, NaN]) {
    test(`getChat applies Array.at coercion to ${index}`, async () => {
      const fixture = await captureLuaRuntime();
      const message = JSON.parse(String(await fixture.call('getChatMain', index)));
      expect(message?.data).toBe('Hello');
    });
  }

  test('setChat truncates a fractional index before editing', async () => {
    const fixture = await captureLuaRuntime();
    await fixture.call('setChat', 0.5, 'Edited');
    await fixture.runtime.flush();
    expect(fixture.messages.find(message => message.id === 'user')?.content).toBe('Edited');
  });

  test('setChatRole accepts a negative index', async () => {
    const fixture = await captureLuaRuntime();
    await fixture.call('setChatRole', -1, 'user');
    await fixture.runtime.flush();
    const messages = JSON.parse(String(await fixture.call('getFullChatMain')));
    expect(messages.at(-1)?.role).toBe('user');
  });

  for (const index of [0.5, -0.5, NaN]) {
    test(`removeChat applies splice coercion to ${index} in persisted messages`, async () => {
      const fixture = await captureLuaRuntime();
      await fixture.call('removeChat', index);
      await fixture.runtime.flush();
      expect(fixture.messages.map(message => message.content)).toEqual(['Greeting', 'Welcome']);
    });
  }

  test('control: removeChat persists an integer deletion', async () => {
    const fixture = await captureLuaRuntime();
    await fixture.call('removeChat', 0);
    await fixture.runtime.flush();
    expect(fixture.messages.map(message => message.content)).toEqual(['Greeting', 'Welcome']);
  });

  divergence('getLoreBooks filters by exact comment and returns parsed entry objects', async () => {
    const fixture = await captureLuaRuntime();
    const books = JSON.parse(String(await fixture.call('getLoreBooksMain', 'Inventory')));
    expect(books).toEqual([expect.objectContaining({ comment: 'Inventory', content: 'Item Character' })]);
  });

  divergence('getLoreBooks returns no entries for a missing comment', async () => {
    const fixture = await captureLuaRuntime();
    expect(JSON.parse(String(await fixture.call('getLoreBooksMain', 'Missing')))).toEqual([]);
  });

  divergence('upsertLocalLoreBook leaves the character world book unchanged', async () => {
    const fixture = await captureLuaRuntime();
    const original = structuredClone(fixture.entries);
    await fixture.call('upsertLocalLoreBook', 'Inventory', 'New inventory', {
      key: 'item', insertOrder: 200, alwaysActive: true, secondKey: 'other', regex: true,
    });
    await fixture.runtime.flush();
    expect(fixture.entries).toEqual(original);
  });

  divergence('loadLoreBooksMain returns role/data records rather than content strings', async () => {
    const fixture = await captureLuaRuntime();
    const books: unknown[] = JSON.parse(String(await fixture.call('loadLoreBooksMain', 0)));
    expect(books.every(book => typeof book === 'object' && book !== null
      && 'data' in book && typeof book.data === 'string' && 'role' in book)).toBe(true);
  });

  divergence('loadLoreBooksMain returns undefined without low-level access', async () => {
    const fixture = await captureLuaRuntime({ lowLevelAccess: false });
    expect(await fixture.call('loadLoreBooksMain', 0)).toBeUndefined();
  });

  divergence('simpleLLM host callback returns a success/result object', async () => {
    const fixture = await captureLuaRuntime();
    expect(await fixture.call('simpleLLM', 'Prompt')).toEqual({ success: true, result: 'Generated' });
  });

  for (const name of ['simpleLLM', 'LLMMain', 'axLLMMain']) {
    divergence(`${name} host callback returns undefined without low-level access`, async () => {
      const fixture = await captureLuaRuntime({ lowLevelAccess: false });
      const prompt = name === 'simpleLLM' ? 'Prompt' : '[{"role":"user","content":"Prompt"}]';
      expect(await fixture.call(name, prompt, false, '{}')).toBeUndefined();
    });
  }

  test('control: denied LLM calls never reach the provider', async () => {
    const fixture = await captureLuaRuntime({ lowLevelAccess: false });
    await fixture.call('simpleLLM', 'Prompt');
    await fixture.call('LLMMain', '[]', false, '{}');
    await fixture.call('axLLMMain', '[]', false, '{}');
    expect(fixture.generated).toEqual([]);
  });

  test('control: LLMMain returns JSON containing success and result', async () => {
    const fixture = await captureLuaRuntime();
    expect(JSON.parse(String(await fixture.call('LLMMain', '[]', false, '{}')))).toEqual({
      success: true, result: 'Generated',
    });
  });

  test('getBackgroundEmbedding reads character background HTML', async () => {
    const fixture = await captureLuaRuntime();
    expect(await fixture.call('getBackgroundEmbedding')).toBe('<div>Background</div>');
  });

  test('setBackgroundEmbedding persists character background HTML', async () => {
    const fixture = await captureLuaRuntime();
    await fixture.call('setBackgroundEmbedding', '<div>Changed</div>');
    await fixture.runtime.flush();
    expect(fixture.character.backgroundHTML).toBe('<div>Changed</div>');
  });

  test('setCharacterFirstMessage returns true after a valid update', async () => {
    const fixture = await captureLuaRuntime();
    expect(await fixture.call('setCharacterFirstMessage', 'Changed')).toBe(true);
  });

  test('setCharacterFirstMessage rejects non-string data without a mutation', async () => {
    const fixture = await captureLuaRuntime();
    const result = await fixture.call('setCharacterFirstMessage', 42);
    expect({ result, firstMessage: fixture.character.firstMessage }).toEqual({ result: false, firstMessage: 'Greeting' });
  });

  test('control: setCharacterFirstMessage persists valid text', async () => {
    const fixture = await captureLuaRuntime();
    await fixture.call('setCharacterFirstMessage', 'Changed');
    await fixture.runtime.flush();
    expect(fixture.character.firstMessage).toBe('Changed');
  });

  test('sleep resolves true', async () => {
    const fixture = await captureLuaRuntime();
    expect(await fixture.call('sleep', 0)).toBe(true);
  });
});
