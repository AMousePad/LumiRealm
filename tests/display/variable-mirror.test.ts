import { afterEach, expect, test } from 'bun:test';
import { createDisplayVariableMirror } from '../../src/display/variable-mirror.js';
import { applyVarDelta, clearDisplaySnapshot, getDisplaySnapshot, setDisplayResolutionMode, setDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { ACTIVATION_INPUT_DEP_KEY, createActivationPatternCache } from '../../src/display/activation-patterns.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';

function events() {
  const listeners = new Set<(payload: unknown) => void>();
  return {
    on(event: string, listener: (payload: unknown) => void) {
      expect(event).toBe('CHAT_CHANGED');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(payload: unknown) { for (const listener of listeners) listener(payload); },
  };
}

function snapshot(chatId = 'chat'): DisplaySnapshot {
  return {
    chatId, characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: '', personality: '', scenario: '', exampleDialogue: '', mainPrompt: '',
      postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '', globalNote: '',
      authorsNote: '', firstMessage: '', alternateGreetings: [], selectedAlternateGreetingIndex: -1,
      additionalAssets: {}, emotionImages: {}, image: '', imageId: null,
    },
    chat: { messageCount: 0, lastMessage: '', lastUserMessage: '', lastCharMessage: '', lastMessageId: -1, messages: [] },
    vars: { local: { panel: 'closed', keep: 'local' }, global: { theme: 'dark' }, chat: { keep: 'chat' } },
    scriptstateDefaults: { removed: 'default' }, screenWidth: 1200, screenHeight: 800,
    legacyMediaFindings: false, modulesByNamespace: {}, lorebook: [], hasEditDisplayLua: false,
    hasEditAtActions: false, luaTriggers: [], messagesHost: [], lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}

function change(local: Record<string, unknown>, fields = ['metadata.chat_variables.panel'], chatId = 'chat') {
  return { chat: { id: chatId, character_id: 'character', metadata: { chat_variables: local } }, changedFields: fields };
}

afterEach(() => {
  clearDisplaySnapshot('chat'); clearDisplaySnapshot('other'); setDisplayResolutionMode('on');
});

test.each([true, false])('host-scheduled body sees fresh variables regardless of subscription order (host first=%s)', async hostFirst => {
  setDisplaySnapshot(snapshot());
  const bus = events();
  const resolver = createDisplayResolver();
  let render: ReturnType<typeof resolver.resolveBody> | undefined;
  const host = () => bus.on('CHAT_CHANGED', () => {
    render = Promise.resolve().then(() => resolver.resolveBody({
      content: '{{getvar::panel}}', context: { chatId: 'chat', messageId: 'message', isUser: false, depth: 0 },
    }));
  });
  if (hostFirst) host();
  const mirror = createDisplayVariableMirror(bus, () => {});
  if (!hostFirst) host();
  bus.emit(change({ panel: 'open' }));
  expect((await render)?.content).toBe('open');
  expect(getDisplaySnapshot('chat')?.vars.local.keep).toBe('local');
  mirror.dispose();
});

test('notifies compatibility dependencies after mirroring even without a host render notification', async () => {
  setDisplaySnapshot(snapshot());
  const bus = events();
  const resolver = createDisplayResolver();
  const request = { content: '{{getvar::panel}}', context: { chatId: 'chat', messageId: 'message', isUser: false, depth: 0 } };
  const before = await resolver.resolveBody(request);
  expect(before?.touchedVars).toContain('local:panel');
  const notifications: Array<{ chatId: string; keys: string[]; panel: string | null | undefined }> = [];
  const mirror = createDisplayVariableMirror(bus, (chatId, keys) => {
    notifications.push({ chatId, keys, panel: getDisplaySnapshot(chatId)?.vars.local.panel });
  });
  bus.emit(change({ panel: 'open' }));
  expect(notifications).toEqual([{ chatId: 'chat', keys: ['local:panel'], panel: 'open' }]);
  expect((await resolver.resolveBody(request))?.content).toBe('open');
  bus.emit(change({ panel: 'open' }));
  mirror.recordWrite('chat', { panel: 'newer' });
  applyVarDelta('chat', 'local', { panel: 'newer' });
  bus.emit(change({ panel: 'old' }));
  expect(notifications).toHaveLength(1);
  mirror.dispose();
});

test('mirrors only declared leaves, including dotted names, deletions, null and host coercion', async () => {
  const snap = snapshot();
  snap.vars.local.removed = 'old'; snap.vars.local['a.b'] = 'old';
  setDisplaySnapshot(snap);
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  bus.emit(change({ panel: 'ignored', 'a.b': 3, nil: null, empty: '', bool: false, list: [1, 2] },
    ['removed', 'a.b', 'nil', 'empty', 'bool', 'list'].map(k => `metadata.chat_variables.${k}`)));
  expect(getDisplaySnapshot('chat')?.vars).toEqual({
    local: { panel: 'closed', keep: 'local', 'a.b': '3', nil: null, empty: '', bool: 'false', list: '1,2' },
    global: { theme: 'dark' }, chat: { keep: 'chat' },
  });
  expect(snap.vars.local.removed).toBe('old');
  const resolved = await createDisplayResolver().resolveBody({
    content: '{{getvar::removed}}', context: { chatId: 'chat', messageId: 'message', isUser: false, depth: 0 },
  });
  expect(resolved?.content).toBe('default');
  mirror.dispose();
});

test('early variable changes also invalidate dependent native activation preparation', async () => {
  setDisplaySnapshot(snapshot());
  const bus = events();
  let loads = 0;
  const cache = createActivationPatternCache(async (_preset, patterns) => {
    loads++;
    return patterns.map(source => ({ source, resolved: `^${getDisplaySnapshot('chat')?.vars.local.panel}$` }));
  });
  const row: FeRegexScript = {
    id: 'row', preset_id: 'preset', find_regex: '^{{getchatvar::panel}}$', replace_string: '', flags: 'g',
    placement: ['ai_output'], substitute_macros: 'none', min_depth: null, max_depth: null, trim_strings: [],
    metadata: { prompt_activation: { source: 'ai_output', lifetime: 'latest', mappings: [
      { capture: '0', value: 'yes', enabled: true, block_ids: ['block'] },
    ] } },
  };
  const read = () => cache.resolve([row], { chatId: 'chat', characterId: 'character', isUser: false, depth: 0 }, new Set());
  expect((await read()).get('row')).toBe('^closed$');
  const notifications: string[][] = [];
  const mirror = createDisplayVariableMirror(bus, (chatId, keys) => {
    if (cache.invalidate(chatId, keys)) keys.push(ACTIVATION_INPUT_DEP_KEY);
    notifications.push(keys);
  });
  bus.emit(change({ panel: 'open' }));
  expect(notifications).toEqual([['local:panel', ACTIVATION_INPUT_DEP_KEY]]);
  expect((await read()).get('row')).toBe('^open$');
  expect(loads).toBe(2);
  mirror.dispose();
});

test('global compatibility scope comes from macro_variables.global only', () => {
  setDisplaySnapshot(snapshot());
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  bus.emit({ chat: { id: 'chat', metadata: { macro_variables: { global: { theme: 'light' }, local: { panel: 'wrong' }, chat: { keep: 'wrong' } } } },
    changedFields: ['metadata.macro_variables.global.theme', 'metadata.macro_variables.local.panel', 'metadata.macro_variables.chat.keep'] });
  expect(getDisplaySnapshot('chat')?.vars).toEqual({ local: { panel: 'closed', keep: 'local' }, global: { theme: 'light' }, chat: { keep: 'chat' } });
  mirror.dispose();
});

test('delayed display-write echoes cannot undo newer local writes, even after a GUI snapshot', () => {
  setDisplaySnapshot(snapshot());
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  mirror.recordWrite('chat', { progress: '1', initialized: 'true' });
  applyVarDelta('chat', 'local', { progress: '2', initialized: 'true' });
  setDisplaySnapshot({ ...getDisplaySnapshot('chat')! });
  bus.emit(change({ progress: '1', panel: 'open' }, ['metadata.chat_variables.progress', 'metadata.chat_variables.initialized', 'metadata.chat_variables.panel']));
  expect(getDisplaySnapshot('chat')?.vars.local).toEqual({ panel: 'open', keep: 'local', progress: '2', initialized: 'true' });
  mirror.dispose();
});

test('external writes to a display-written key retain the authoritative update path', () => {
  setDisplaySnapshot(snapshot());
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  mirror.recordWrite('chat', { panel: 'open' }); applyVarDelta('chat', 'local', { panel: 'open' });
  bus.emit(change({ panel: 'external' }));
  expect(getDisplaySnapshot('chat')?.vars.local.panel).toBe('open');
  setDisplaySnapshot({ ...snapshot(), vars: { local: { panel: 'external' }, global: {}, chat: {} } });
  expect(getDisplaySnapshot('chat')?.vars.local.panel).toBe('external');
  mirror.dispose();
});

test('no inference from bag-wide, missing, unrelated, foreign-character or cold-chat events', () => {
  const snap = snapshot(); setDisplaySnapshot(snap);
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  for (const payload of [
    change({ panel: 'open' }, ['metadata.chat_variables']),
    { chat: { id: 'chat', metadata: { chat_variables: { panel: 'open' } } } },
    { chat: { id: 'chat' }, changedFields: ['metadata.chat_variables.panel'] },
    change({ panel: 'open' }, ['name']),
    { ...change({ panel: 'open' }), chat: { ...change({ panel: 'open' }).chat, character_id: 'native' } },
    change({ panel: 'open' }, undefined, 'other'),
  ]) bus.emit(payload);
  expect(getDisplaySnapshot('chat')).toBe(snap);
  expect(getDisplaySnapshot('other')).toBeUndefined();
  mirror.dispose();
});

test('same-value events preserve identity and off mode and teardown do not mirror', () => {
  const snap = snapshot(); setDisplaySnapshot(snap);
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  bus.emit(change({ panel: 'closed' })); expect(getDisplaySnapshot('chat')).toBe(snap);
  setDisplayResolutionMode('off'); bus.emit(change({ panel: 'open' })); expect(getDisplaySnapshot('chat')).toBe(snap);
  setDisplayResolutionMode('on'); mirror.dispose(); bus.emit(change({ panel: 'open' })); expect(getDisplaySnapshot('chat')).toBe(snap);
});

test('rapid updates and background chats remain isolated', () => {
  setDisplaySnapshot(snapshot()); setDisplaySnapshot(snapshot('other'));
  const bus = events(); const mirror = createDisplayVariableMirror(bus, () => {});
  mirror.recordWrite('other', { panel: 'protected' });
  for (const panel of ['open', 'closed', 'open']) bus.emit(change({ panel }));
  bus.emit(change({ panel: 'wrong' }, undefined, 'other'));
  expect(getDisplaySnapshot('chat')?.vars.local.panel).toBe('open');
  expect(getDisplaySnapshot('other')?.vars.local.panel).toBe('closed');
  mirror.dispose();
});
