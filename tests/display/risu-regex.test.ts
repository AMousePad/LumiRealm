import { afterEach, expect, spyOn, test } from 'bun:test';
import { mapRegex } from '../../src/core/mappers/regex.js';
import { projectModuleRegexEntries } from '../../src/state/module-artifact-project.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, setDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';
import type { CustomScript } from '../../src/core/schemas/customscript.js';

const rule = (find: string, out: string, flag = 'g'): CustomScript => ({
  in: find, out, flag, ableFlag: true, type: 'editdisplay', comment: 'Synthetic rule',
});
function snapshot(vars: Record<string, string> = {}): DisplaySnapshot {
  return {
    chatId: 'chat', characterId: 'character', charName: 'Character', userName: 'User',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: '', personality: '', scenario: '', exampleDialogue: '', mainPrompt: '',
      postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '', globalNote: '',
      authorsNote: '', firstMessage: '', alternateGreetings: [], selectedAlternateGreetingIndex: -1,
      additionalAssets: {}, emotionImages: {}, image: '', imageId: null,
    },
    chat: { messageCount: 1, lastMessage: '', lastUserMessage: '', lastCharMessage: '', lastMessageId: -1, messages: [] },
    vars: { local: vars, chat: {}, global: {} }, scriptstateDefaults: {}, screenWidth: 1920, screenHeight: 1080,
    legacyMediaFindings: false, modulesByNamespace: {}, lorebook: [], hasEditDisplayLua: false,
    hasEditAtActions: false, luaTriggers: [], messagesHost: [], lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}
function project(origin: string, rules: CustomScript[]): FeRegexScript[] {
  let id = 0;
  return JSON.parse(JSON.stringify(origin === 'character'
    ? mapRegex(rules, { characterId: 'character' }).rows
    : projectModuleRegexEntries('module', 'Synthetic', 'character', rules, () => String(++id))
      .map(row => ({ ...row, id: row.script_id }))));
}
async function apply(scripts: FeRegexScript[], content: string, vars: Record<string, string> = {}) {
  setDisplaySnapshot(snapshot(vars));
  return createDisplayResolver().applyScripts({
    content, scripts, context: { chatId: 'chat', characterId: 'character', isUser: false, depth: 0, messageIndex: -1 },
  });
}
afterEach(() => clearDisplaySnapshot('chat'));

for (const origin of ['character', 'module']) {
  test(`${origin}: only explicit CBS flags evaluate find macros`, async () => {
    const source = rule('{{getvar::needle}}', '{{char}}');
    expect((await apply(project(origin, [source]), 'cat', { needle: 'cat' }))?.content).toBe('cat');
    expect((await apply(project(origin, [{ ...source, flag: 'g<cbs>' }]), 'cat', { needle: 'cat' }))?.content).toBe('Character');
  });
  test(`${origin}: unmatched metadata rules leave moved macros for a later ordinary rule`, async () => {
    const moved = rule('TOKEN', '{{getvar::value}}', 'g<move_bottom>');
    for (const flag of ['g<no_end_nl>', 'g<cbs>']) {
      const rows = project(origin, [moved, rule('ABSENT', 'unused', flag)]);
      expect((await apply(rows, 'TOKEN', { value: 'VALUE' }))?.content).toBe('\n{{getvar::value}}');
      expect((await apply([...rows, ...project(origin, [rule('ABSENT', 'unused')])], 'TOKEN', { value: 'VALUE' }))?.content).toBe('\nVALUE');
    }
  });
  test(`${origin}: replacements parse each random occurrence after substitution`, async () => {
    let calls = 0;
    const random = spyOn(Math, 'random').mockImplementation(() => ++calls % 2 ? 0.01 : 0.99);
    try {
      const rows = project(origin, [rule('x', '{{random::red::blue}}')]);
      expect((await apply(rows, 'unchanged'))?.content).toBe('unchanged');
      expect(calls).toBe(0);
      expect((await apply(rows, 'x x x'))?.content).toBe('red blue red');
      expect(calls).toBe(3);
    } finally { random.mockRestore(); }
  });
  test(`${origin}: authored dollars expand before CBS, while CBS-produced dollars stay literal`, async () => {
    expect((await apply(project(origin, [rule('x', '{{char}} $$')]), 'x'))?.content).toBe('Character $');
    expect((await apply(project(origin, [rule('x', '{{getvar::value}}')]), 'x', { value: '$& $$ $1' }))?.content).toBe('$& $$ $1');
  });
  test(`${origin}: nested CBS patterns preserve Unicode matching`, async () => {
    const rows = project(origin, [rule('{{#if {{getvar::enabled}}}}.{{/if}}', 'X', 'gu<cbs>')]);
    expect((await apply(rows, '🚀', { enabled: '1' }))?.content).toBe('X');
    expect((await apply(rows.map(row => ({ ...row, flags: 'gi' })), '🚀', { enabled: '1' }))?.content).toBe('XX');
  });
  test.each([
    ['(b)', 'abc', '$0', 'b\nac'],
    ['(?<letter>b)', 'abc', '$<letter>', '$<letter>\nac'],
    ['(a)?b', 'b', '$1', 'undefined\n'],
    ['b', 'abc', "$`:$'", "$`:$'\nac"],
    ['(b)', 'abc', '$$1/$$&/$$', '$$1/$b/$$\nac'],
  ])(`${origin}: move substitution %s on %s with %s`, async (find, input, out, expected) => {
    expect((await apply(project(origin, [rule(find, `@@move_top ${out}`, 'g<no_end_nl>')]), input))?.content).toBe(expected);
  });
  test(`${origin}: sticky metadata actions retain Risu lastIndex across probes`, async () => {
    const move = project(origin, [rule('x', '@@move_top Q', 'y')]);
    expect((await apply(move, 'xZ'))?.content).toBe('Z');
    expect((await apply(move, 'xxZ'))?.content).toBe('Q\nxxZ');
    expect((await apply(project(origin, [rule('x', 'Q', 'y<no_end_nl>')]), 'xxZ'))?.content).toBe('xQZ');
    expect((await apply(project(origin, [rule('x', 'Q', 'y')]), 'xxZ'))?.content).toBe('QxZ');
  });
}
test('native escaped rules keep their find and replacement semantics', async () => {
  const [row] = project('character', [rule('{{char}}', '{{char}} $$')]);
  expect((await apply([{ ...row!, metadata: {} }], 'cat'))?.content).toBe('cat');
  expect((await apply([{ ...row!, find_regex: 'cat', metadata: {} }], 'cat'))?.content).toBe('Character $$');
});
