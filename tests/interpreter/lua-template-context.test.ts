import { expect, test } from 'bun:test';
import { createLuaTemplateParser } from '../../src/interpreter/runtime/template.js';

const parse = createLuaTemplateParser(() => ({
  chatId: 'context', userName: 'User', charName: 'Character', commit: true,
  character: { firstMessage: 'Greeting', additionalAssets: { portrait: { imageIds: ['portrait'], ext: 'png' } } },
  chat: { messageCount: 1 }, variables: {}, currentMessageIndexOverride: 3,
  currentMessageRoleOverride: 'assistant', rmVar: true, runVar: true, visualize: true,
}), () => 'null');

test('Lua cbs starts without caller role, first-message, or write flags', () => {
  expect(parse('{{role}}|{{isfirstmsg}}|{{chatindex}}|{{SET_VAR:x:9}}'))
    .toBe('null|0|-1|{{SET_VAR:x:9}}');
});

test.each([
  ['{{file::name::SGVsbG8=}}', 'Hello'], ['{{comment::note}}', ''],
  ['{{position::slot}}', '{{position::slot}}'],
])('Lua cbs uses the plain parser for %s', (template, expected) => {
  expect(parse(template)).toBe(expected);
});

for (const name of ['path', 'raw', 'img', 'image', 'emotion', 'asset', 'bg', 'video',
  'video-img', 'audio', 'bgm', 'inlay', 'inlayed', 'inlayeddata', 'source']) {
  test(`${name} stays literal within Lua cbs`, () => {
    for (const template of [`{{${name}}}`, `{{${name}::portrait}}`, `{{${name.toUpperCase()}:portrait}}`]) {
      expect(parse(template)).toBe(template);
    }
  });
}
