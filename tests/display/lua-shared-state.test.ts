import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { runEditDisplayChain } from '../../src/display/lua-runner.js';
import { applyVarDelta, clearDisplaySnapshot, getDisplaySnapshot, setDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import { setWasmoonEnabled } from '../../src/interpreter/runtime.js';

function snapshot(code: string, chatId = 'shared-display'): DisplaySnapshot {
  return {
    chatId, characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: '', personality: '', scenario: '', exampleDialogue: '', mainPrompt: '',
      postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '', globalNote: '', authorsNote: '',
      firstMessage: '', alternateGreetings: [], selectedAlternateGreetingIndex: -1,
      additionalAssets: {}, emotionImages: {}, image: '', imageId: null,
    },
    chat: { messageCount: 0, lastMessage: '', lastUserMessage: '', lastCharMessage: '', lastMessageId: -1, messages: [] },
    vars: { local: { state: 'A', untouched: 'keep' }, global: { theme: 'dark' }, chat: {} },
    scriptstateDefaults: { defaulted: 'fallback' }, screenWidth: 1200, screenHeight: 800,
    legacyMediaFindings: false, modulesByNamespace: {}, lorebook: [], hasEditDisplayLua: true, hasEditAtActions: false,
    luaTriggers: [{ source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }, luaCode: code }],
    messagesHost: [], lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}
const context = (chatId = 'shared-display') => ({ chatId, characterId: 'character', isUser: true, depth: 0 });
const local = (chatId = 'shared-display') => getDisplaySnapshot(chatId)!.vars.local;
function writeback(writes: Record<string, string>[]) {
  return (chatId: string, vars: Record<string, string>) => { writes.push(vars); applyVarDelta(chatId, 'local', vars); };
}
beforeEach(() => setWasmoonEnabled(false));
afterEach(() => { clearDisplaySnapshot('shared-display'); clearDisplaySnapshot('other-display'); setWasmoonEnabled(true); });

test.each(['A', 'B'])('concurrent display rounds preserve the last authored write from initial %s', async initial => {
  const snap = snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', text)
    return text
  end)`);
  snap.vars.local.state = initial;
  setDisplaySnapshot(snap);
  const writes: Record<string, string>[] = [];
  const resolver = createDisplayResolver(writeback(writes));
  for (let round = 0; round < 4; round++) {
    await Promise.all(['A', 'B', 'A'].map(content => resolver.resolveBody({ content, context: context() })));
    expect(local().state).toBe('A');
  }
  expect(writes.every(delta => Object.keys(delta).every(key => key === 'state'))).toBe(true);
  expect(local().untouched).toBe('keep');
});

test('later display triggers see earlier writes and preserve dependency recording', async () => {
  const snap = snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'changed')
    return text
  end)`);
  const second = { ...snap.luaTriggers[0]!, luaCode: `listenEdit('editDisplay', function(id, text)
    return getChatVar(id, 'state') .. '|' .. getGlobalVar(id, 'theme') .. '|' .. getChatVar(id, 'defaulted')
  end)` };
  setDisplaySnapshot({ ...snap, luaTriggers: [...snap.luaTriggers, second] });
  const result = await createDisplayResolver(writeback([])).resolveBody({ content: 'input', context: context() });
  expect(result?.content).toBe('changed|dark|fallback');
  expect(result?.touchedVars).toEqual(expect.arrayContaining(['local:state', 'chat:state', 'global:theme', 'local:defaulted']));
});

test('Lua CBS and the post-hook parser see the live variable value', async () => {
  setDisplaySnapshot(snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'changed')
    return cbs('{{getvar::state}}') .. '|{{getvar::state}}'
  end)`));
  const result = await createDisplayResolver(writeback([])).resolveBody({ content: 'input', context: context() });
  expect(result?.content).toBe('changed|changed');
});

test('a yielded hook observes newer values and never writes unrelated snapshot fields back', async () => {
  const snap = snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'first')
    cbs('pause')
    local value = getChatVar(id, 'state') .. '|' .. getGlobalVar(id, 'theme')
    setChatVar(id, 'state', 'A')
    return value
  end)`);
  setDisplaySnapshot(snap);
  const writes: Record<string, string>[] = [];
  const result = await runEditDisplayChain(snap, 'input', context(), async () => {
    expect(local().state).toBe('first');
    applyVarDelta(snap.chatId, 'local', { state: 'external', untouched: 'newer' });
    applyVarDelta(snap.chatId, 'global', { theme: 'light' });
    return '';
  }, vars => writeback(writes)(snap.chatId, vars));
  expect(result).toBe('external|light');
  expect(writes).toEqual([{ state: 'A' }]);
  expect(local().untouched).toBe('newer');
});

test('same-value writes are quiet while writes before a hook error remain visible', async () => {
  const snap = snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'A')
    return text
  end)`);
  setDisplaySnapshot(snap);
  const writes: Record<string, string>[] = [];
  const resolver = createDisplayResolver(writeback(writes));
  await resolver.resolveBody({ content: 'input', context: context() });
  expect(writes).toHaveLength(0);
  setDisplaySnapshot({ ...snap, luaTriggers: [{ ...snap.luaTriggers[0]!, luaCode: `listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'changed')
    error('expected hook failure')
  end)` }] });
  expect((await resolver.resolveBody({ content: 'input', context: context() }))?.content).toBe('input');
  expect(local().state).toBe('changed');
  expect(writes).toEqual([{ state: 'changed' }]);
});

test('concurrent chats keep separate live variables', async () => {
  const code = `listenEdit('editDisplay', function(id, text) setChatVar(id, 'state', text) return getChatVar(id, 'state') end)`;
  setDisplaySnapshot(snapshot(code)); setDisplaySnapshot(snapshot(code, 'other-display'));
  const resolver = createDisplayResolver(writeback([]));
  await Promise.all(['shared-display', 'other-display'].map(chatId => resolver.resolveBody({ content: chatId, context: context(chatId) })));
  expect(local().state).toBe('shared-display');
  expect(local('other-display').state).toBe('other-display');
});

test('concurrent initialization runs once and later renders retain committed progress', async () => {
  setDisplaySnapshot(snapshot(`listenEdit('editDisplay', function(id, text)
    if not getState(id, 'initialized') then
      setState(id, 'initialized', true)
      setChatVar(id, 'progress', '0')
    end
    return text
  end)`));
  const writes: Record<string, string>[] = [];
  const resolver = createDisplayResolver(writeback(writes));
  const render = () => Promise.all(Array.from({ length: 8 }, () => resolver.resolveBody({ content: 'input', context: context() })));
  await render();
  expect(writes.filter(delta => '__initialized' in delta)).toHaveLength(1);
  applyVarDelta('shared-display', 'local', { progress: '42' });
  await render();
  expect(local().progress).toBe('42');
  expect(writes).toHaveLength(1);
});

test('a newer deletion supersedes an unflushed write without resurrecting the key', async () => {
  const snap = snapshot(`listenEdit('editDisplay', function(id, text)
    setChatVar(id, 'state', 'pending')
    cbs('pause')
    return getChatVar(id, 'state')
  end)`);
  setDisplaySnapshot(snap);
  const writes: Record<string, string>[] = [];
  const result = await runEditDisplayChain(snap, 'input', context(), async () => {
    const current = getDisplaySnapshot(snap.chatId)!;
    const { state: _state, ...rest } = current.vars.local;
    setDisplaySnapshot({ ...current, vars: { ...current.vars, local: rest } });
    return '';
  }, vars => writeback(writes)(snap.chatId, vars));
  expect(result).toBe('null');
  expect(local()).not.toHaveProperty('state');
  expect(writes).toHaveLength(0);
});
