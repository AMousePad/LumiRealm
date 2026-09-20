import { afterEach, expect, spyOn, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, setDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import { clearLuaEngines } from '../../src/interpreter/lua-bridge.js';

function snapshot(hook: string): DisplaySnapshot {
  const messages = [
    { role: 'user' as const, content: 'User0', createdAt: 1000 }, { role: 'assistant' as const, content: 'Assistant1', createdAt: 2000 },
    { role: 'user' as const, content: 'User2', createdAt: 3000 }, { role: 'assistant' as const, content: 'Assistant3', createdAt: 4000 },
  ];
  return {
    chatId: 'display-stages', characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: '{{char}}', personality: '', scenario: '', exampleDialogue: '', mainPrompt: '',
      postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '', globalNote: '', authorsNote: '',
      firstMessage: 'Greeting', alternateGreetings: [], selectedAlternateGreetingIndex: -1,
      additionalAssets: {}, emotionImages: {}, image: '', imageId: null,
    },
    chat: { messageCount: 5, lastMessage: 'Assistant3', lastUserMessage: 'User2', lastCharMessage: 'Assistant3', lastMessageId: 4, messages },
    vars: { local: { x: '2', inner: '{{char}}', outer: '{{getvar::inner}}', key: 'inner', temp: '{{settempvar::scratch::changed}}' }, global: {}, chat: {} },
    scriptstateDefaults: {}, screenWidth: 1280, screenHeight: 720, legacyMediaFindings: false,
    modulesByNamespace: {}, lorebook: [], hasEditDisplayLua: Boolean(hook), hasEditAtActions: false,
    luaTriggers: hook ? [{ source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] }, luaCode: hook }] : [],
    messagesHost: [{ id: 'greeting', role: 'assistant', content: 'Greeting' }, ...messages.map((message, index) => ({ id: `message-${index}`, ...message }))],
    lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}

const returns = (text: string) => `listenEdit("editDisplay", function(id, data, meta) return [=[${text}]=] end)`;
const identity = 'listenEdit("editDisplay", function(id, data, meta) return data end)';
type Fixture = {
  name: string; input?: string; hook?: string; expected: string; index?: number;
  description?: string; native?: boolean;
  rules?: readonly (readonly [string, string, string?])[];
};
const fixtures: Fixture[] = [
  { name: 'initial and post-hook passes each expand one ordinary result', input: '{{getvar::outer}}', expected: '{{char}}' },
  { name: 'a second caller pass still resolves the first pass output', input: '{{getvar::inner}}', expected: 'Character' },
  { name: 'an identity listener retains the same parse stages', input: '{{getvar::outer}}', hook: identity, expected: '{{char}}' },
  { name: 'hook output expands ordinary results once', hook: returns('{{getvar::inner}}'), expected: '{{char}}' },
  { name: 'nested arguments still resolve before their handler', hook: returns('{{getvar::{{getvar::key}}}}'), expected: '{{char}}' },
  { name: 'explicit Lua cbs adds its own pass', hook: 'listenEdit("editDisplay", function(id, data) return cbs("{{getvar::outer}}") end)', expected: '{{char}}' },
  { name: 'character field handlers retain their explicit recursive parse', hook: returns('{{description}}'), expected: 'Character' },
  { name: 'the initial display caller still removes inactive writes', input: '{{setvar::x::9}}|{{getvar::x}}', hook: identity, expected: '|2' },
  { name: 'post-hook inactive writes remain literal', hook: returns('{{SET_VAR:x:9}}|{{addvar::x::1}}|{{setdefaultvar::fresh::9}}|{{getvar::x}}'), expected: '{{SET_VAR:x:9}}|{{addvar::x::1}}|{{setdefaultvar::fresh::9}}|2' },
  { name: 'ordinary results cannot execute returned temporary setters', hook: returns('{{getvar::temp}}|{{tempvar::scratch}}'), expected: '{{settempvar::scratch::changed}}|' },
  { name: 'direct temporary setters still execute', hook: returns('{{settempvar::scratch::ok}}{{tempvar::scratch}}'), expected: 'ok' },
  ...([-1, 0, 3] as const).map(index => ({ name: `post-hook context retains message index ${index}`, index, hook: returns('{{chatindex}}|{{role}}|{{isfirstmsg}}'), expected: index === -1 ? '-1|char|1' : index === 0 ? '0|user|0' : '3|char|0' })),
  { name: 'a later regex can match a macro retained by the post-hook pass', hook: returns('{{getvar::inner}}'), rules: [['\\{\\{char\\}\\}', 'matched']], expected: 'matched' },
  { name: 'ordinary unmatched regex still contributes one parser pass', input: '{{getvar::outer}}', rules: [['absent', 'unused']], expected: 'Character' },
  { name: 'a regex-created ordinary result expands once', rules: [['text', '{{getvar::inner}}']], expected: '{{char}}' },
  { name: 'CBS find patterns expand ordinary results once', hook: returns('{{getvar::inner}}'), rules: [['{{getvar::inner}}', 'matched', 'g<cbs>']], expected: 'matched' },
  { name: 'CBS find patterns preserve inactive writes', hook: returns('{{SET_VAR:x:9}}'), rules: [['{{SET_VAR:x:9}}', 'matched', 'g<cbs>']], expected: 'matched' },
  { name: 'move actions use the same CBS find context', hook: returns('{{getvar::inner}}'), rules: [['{{getvar::inner}}', '@@move_top keep', 'gi<cbs>']], expected: 'keep\n' },
  { name: 'invalid Unicode move patterns preserve the prior text', hook: returns('{{getvar::inner}}'), rules: [['{{getvar::inner}}', '@@move_top keep', 'g<cbs>']], expected: '{{char}}' },
  { name: 'each ordinary regex rule contributes one parser pass', rules: [['text', '{{getvar::outer}}'], ['absent', 'unused']], expected: '{{char}}' },
  { name: 'regex-created inactive writes remain literal', rules: [['text', '{{setvar::x::9}}']], expected: '{{setvar::x::9}}' },
  { name: 'unmatched metadata rules do not add a parser pass', input: '{{getvar::outer}}', rules: [['absent', 'unused', 'g<no_end_nl>']], expected: '{{char}}' },
  { name: 'initial comments remain visible', input: '{{comment::note}}', expected: '<div class="risu-comment x-risu-risu-comment">note</div>' },
  { name: 'initial files show their names', input: '{{file::note.txt::SGVsbG8=}}', expected: '<br><div class="x-risu-risu-file">note.txt</div><br>' },
  { name: 'hook comments are hidden', hook: returns('{{comment::note}}'), expected: '' },
  { name: 'hook files decode their contents', hook: returns('{{file::note.txt::SGVsbG8=}}'), expected: 'Hello' },
  { name: 'regex comments are hidden', rules: [['text', '{{comment::note}}']], expected: '' },
  { name: 'regex files decode their contents', rules: [['text', '{{file::note.txt::SGVsbG8=}}']], expected: 'Hello' },
  { name: 'Lua cbs uses nonvisual comment and file behavior', hook: 'listenEdit("editDisplay", function(id, data) return tostring(cbs("{{comment::note}}") == "") .. "|" .. cbs("{{file::note.txt::SGVsbG8=}}") end)', expected: 'true|Hello' },
  { name: 'character field reparsing hides comments during the initial pass', input: '{{description}}', description: '{{comment::note}}', expected: '' },
  { name: 'character field reparsing decodes files during the initial pass', input: '{{description}}', description: '{{file::note.txt::SGVsbG8=}}', expected: 'Hello' },
  { name: 'function calls retain initial visualization', input: '{{#func visual}}{{comment::note}}{{/func}}{{call::visual}}', expected: '<div class="risu-comment x-risu-risu-comment">note</div>' },
  { name: 'function calls retain post-hook visualization', hook: returns('{{#func visual}}{{comment::note}}{{/func}}{{call::visual}}'), expected: '' },
  { name: 'nonvisual post-hook parsing still resolves missing assets', hook: returns('{{source::missing}}'), expected: '' },
  { name: 'nonvisual regex parsing still resolves missing assets', rules: [['text', '{{source::missing}}']], expected: '' },
  { name: 'native comment replacements retain their display behavior', native: true, rules: [['text', '{{comment::note}}']], expected: '<div class="risu-comment x-risu-risu-comment">note</div>' },
  { name: 'native file replacements retain their display behavior', native: true, rules: [['text', '{{file::note.txt::SGVsbG8=}}']], expected: '<br><div class="x-risu-risu-file">note.txt</div><br>' },
];

afterEach(async () => { clearDisplaySnapshot('display-stages'); await clearLuaEngines(); });

for (const fixture of fixtures) {
  test(fixture.name, async () => {
    const base = snapshot(fixture.hook ?? '');
    const snap = fixture.description === undefined ? base
      : { ...base, character: { ...base.character, description: fixture.description } };
    setDisplaySnapshot(snap);
    const index = fixture.index ?? 3;
    const context = {
      chatId: snap.chatId, characterId: snap.characterId, isUser: index === 0, depth: 3 - index,
      messageId: index === -1 ? 'greeting' : `message-${index}`, messageIndex: index + 1,
      role: index === 0 ? 'user' : 'assistant',
    };
    const writes: unknown[] = [];
    const network = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    try {
      const resolver = createDisplayResolver((_chatId, values) => { writes.push(values); });
      const body = await resolver.resolveBody({ content: fixture.input ?? 'text', context });
      expect(body).not.toBeNull();
      const scripts = mapRegex((fixture.rules ?? []).map(([find, out, flag]) => ({
        in: find, out, flag: flag ?? 'g', ableFlag: true, type: 'editdisplay', comment: '',
      })), { characterId: snap.characterId }).rows;
      const final = await resolver.applyScripts({
        content: body!.content, context,
        scripts: fixture.native ? scripts.map(script => ({ ...script, metadata: {} })) : [...scripts],
      });
      expect(final?.content).toBe(fixture.expected);
      expect(snap.vars.local.x).toBe('2');
      expect(writes).toEqual([]);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
}
