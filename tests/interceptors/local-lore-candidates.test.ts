import { afterEach, expect, test } from 'bun:test';
import { createLumiInterceptors, type CreateLumiInterceptorsDeps } from '../../src/interceptors/lumi-hooks.js';
import { LOCAL_LORE_KEY } from '../../src/interpreter/runtime/local-lore.js';
import { evaluatePreActivationGates } from '../../src/payload/lorebook-decorator-runtime.js';
import { setDecoratorBuffers, getDecoratorBuffers, clearDecoratorBuffers } from '../../src/interpreter/decorator-buffers.js';

const original = (globalThis as { spindle?: unknown }).spindle;
afterEach(() => { (globalThis as { spindle?: unknown }).spindle = original; });

test('chat-local source projects native candidates before the existing decorator interceptor', async () => {
  const handlers: { priority: number; run: (ctx: any) => Promise<any> }[] = [];
  (globalThis as { spindle?: unknown }).spindle = {
    registerMacroInterceptor() {}, registerMessageContentProcessor() {}, registerInterceptor() {}, registerContextHandler() {},
    registerWorldInfoInterceptor: (run: (ctx: any) => Promise<any>, priority: number) => { handlers.push({ priority, run }); },
  };
  let active: unknown = { ownerUserId: 'owner', lumirealm: { user_overrides: {} },
    card: { character_id: 'character', risuPayload: { extra: {} } } };
  createLumiInterceptors({ activeCardByChat: new Map(), ensureActiveCardForChat: async () => active,
    createReadonlyManySession: () => ({ resolve: async (templates: readonly string[]) => templates }),
    resolveReadonlyMany: async (templates: readonly string[]) => templates,
    log: { info() {}, warn() {}, debug() {}, trace() {}, error() {} },
  } as unknown as CreateLumiInterceptorsDeps).registerAll();
  expect(handlers.map(handler => handler.priority)).toEqual([100]);
  const source = [{ comment: 'Inventory', content: '@@role assistant\nItem {{char}}', key: 'item', secondkey: 'other',
    insertorder: 321, alwaysActive: true, selective: true, useRegex: true, mode: 'normal' }];
  const before = structuredClone(source);
  const ctx = { chatId: 'chat', characterId: 'character', userId: 'owner', entries: [], messages: [], chatTurn: 0,
    chatMetadata: { [LOCAL_LORE_KEY]: source }, activationSettings: { globalScanDepth: null, maxRecursionPasses: 3 } };
  const result = await handlers[0]!.run(ctx);
  expect(result.additionalEntries).toHaveLength(1);
  expect(result.additionalEntries[0]).toMatchObject({ comment: 'Inventory', constant: true, selective: true, use_regex: true,
    key: ['item'], keysecondary: ['other'], order_value: 321, role: 'assistant', content: 'Item {{char}}',
    extensions: { _risu_chat_local: true, _risu_array_index: 0 } });
  expect(source).toEqual(before);
  setDecoratorBuffers('chat', { positionPt: { existing: 'generation content' }, injectAt: [] });
  await handlers[0]!.run({ ...ctx, purpose: 'query' });
  expect(getDecoratorBuffers('chat')?.positionPt).toEqual({ existing: 'generation content' });
  clearDecoratorBuffers('chat');
  const placed = await handlers[0]!.run({ ...ctx, chatMetadata: { [LOCAL_LORE_KEY]: [
    { ...source[0]!, content: '@@reverse_depth 2\n@@role assistant\nPlaced' },
  ] } });
  expect(placed.mutated[0].placement).toEqual({ type: 'chat_depth', role: 'assistant', depth: 2, direction: 'from_end' });
  const sticky = [{ ...source[0]!, comment: 'sticky', content: '@@keep_activate_after_match\nSticky' }, source[0]!];
  const first = await handlers[0]!.run({ ...ctx, chatMetadata: { [LOCAL_LORE_KEY]: sticky } });
  const stateId = first.additionalEntries[0].extensions._risu_state_id;
  const reordered = await handlers[0]!.run({ ...ctx, chatId: 'branch', chatMetadata: { [LOCAL_LORE_KEY]: [sticky[1], sticky[0]] } });
  expect(reordered.additionalEntries[1].extensions._risu_state_id).toBe(stateId);
  const gateContext = { entries: [], messages: [], chatTurn: 0, defaultScanDepth: null,
    chatMetadata: { chat_variables: { [`__internal_ka_${stateId}`]: '1' } } };
  expect(evaluatePreActivationGates(reordered.additionalEntries[0], gateContext).force).not.toBe(true);
  expect(evaluatePreActivationGates(reordered.additionalEntries[1], gateContext).force).toBe(true);
  active = null;
  expect(await handlers[0]!.run(ctx)).toBeUndefined();
  active = { ownerUserId: 'another', card: { character_id: 'character' } };
  expect(await handlers[0]!.run(ctx)).toBeUndefined();
});
