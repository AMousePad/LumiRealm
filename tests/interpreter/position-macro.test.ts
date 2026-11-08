import { afterEach, beforeEach, expect, test } from 'bun:test';
import { registerSpindleMacros } from '../../src/interpreter/spindle-macros';
import { clearDecoratorBuffers, setDecoratorBuffers } from '../../src/interpreter/decorator-buffers';
import { transformPresetTemplate } from '../../src/core/preset/risup-translator';

type Handler = (context: unknown) => unknown;

const previous = (globalThis as { spindle?: unknown }).spindle;
let handlers: Map<string, Handler>;

beforeEach(() => {
  handlers = new Map();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (macro: { name: string; handler: Handler }) => handlers.set(macro.name, macro.handler),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  registerSpindleMacros();
});
afterEach(() => { (globalThis as { spindle?: unknown }).spindle = previous; });

test('position reads the active pt_ entries of this chat and is empty otherwise', async () => {
  const position = (chatId: string, ...args: string[]) =>
    handlers.get('position')!({ args, env: { chat: { id: chatId } } });
  setDecoratorBuffers('chat-a', { injectAt: [], positionPt: { ep1: 'first\nsecond', 'a::b': 'joined' } });
  try {
    expect(await position('chat-a', 'ep1')).toBe('first\nsecond');
    // Risu's positionRegex keeps any :: in the name.
    expect(await position('chat-a', 'a', 'b')).toBe('joined');
    expect(await position('chat-a', 'ep2')).toBe('');
    expect(await position('chat-a', 'constructor')).toBe('');
    expect(await position('chat-b', 'ep1')).toBe('');
  } finally { clearDecoratorBuffers('chat-a'); }
});

test('position translates lore text, because the host expands the result with host macros', async () => {
  setDecoratorBuffers('chat-a', { injectAt: [], positionPt: { ep1: 'x{{equal::1::1}}{{? 1+1}}' } });
  try {
    const result = await handlers.get('position')!({ args: ['ep1'], env: { chat: { id: 'chat-a' } } });
    expect(result).toBe('x{{risuEqual::1::1}}{{risuCalc::1+1}}');
  } finally { clearDecoratorBuffers('chat-a'); }
});

test('position is registered under its Risu name, so translated text keeps it', () => {
  expect(transformPresetTemplate('{{position::ep1}}')).toBe('{{position::ep1}}');
});

test('position is marked volatile, because its slots change per generation', () => {
  const volatile = new Map<string, unknown>();
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacro: (macro: { name: string; volatile?: unknown }) => volatile.set(macro.name, macro.volatile),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  registerSpindleMacros();
  expect(volatile.get('position')).toBe(true);
});
