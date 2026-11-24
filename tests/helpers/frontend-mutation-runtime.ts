import { FrontendRuntimeState } from '../../src/frontend-lua/state.js';
import { createFrontendHost } from '../../src/frontend-lua/host.js';
import { runFrontendLuaOperation } from '../../src/frontend-lua/executor.js';
import { runtimeDisplaySnapshot } from '../../src/frontend-lua/snapshot.js';
import { DEFAULT_SETTINGS } from '../../src/state/settings-store.js';
import { snapshot } from './display-lua-fixture.js';
import { prepareTriggerSources } from '../../src/interpreter/dispatcher.js';
import type { RuntimeStateDto, RuntimeStateCommand, RuntimeStatePatch } from '../../src/frontend-lua/state-contract.js';
import type { TriggerScript } from '../../src/core/schemas/triggerscript.js';
import type { FrontendLuaOperation } from '../../src/frontend-lua/protocol.js';
import './lua-bridge.js';

export function frontendRuntime(initial?: RuntimeStateDto) {
  const dto: RuntimeStateDto = structuredClone(initial ?? { revision: { epoch: 'host', sequence: 1 }, chat: { id: 'chat', metadata: { chat_variables: { x: '2' } } },
    character: { id: 'character', name: 'Character', first_mes: 'Greeting', scenario: 'Old scenario', world_book_ids: [] }, persona: null,
    messages: [{ id: 'greeting', role: 'assistant', content: 'Greeting', index_in_chat: 0, send_date: 0 },
      { id: 'user', role: 'user', content: 'Hello', index_in_chat: 1, send_date: 1700000000 },
      { id: 'reply', role: 'assistant', content: 'Welcome', index_in_chat: 2, send_date: 1700000005 }], lore: [], globalVariables: {} });
  const writes: RuntimeStateCommand[] = [];
  let serviceCalls = 0, personaReads = 0, notifications = 0;
  const event = (patch: RuntimeStatePatch, mutationId?: string) => {
    dto.revision = { ...dto.revision, sequence: dto.revision.sequence + 1 };
    state.apply(dto.revision, structuredClone(patch), mutationId);
  };
  const state = new FrontendRuntimeState(dto, async (command, mutationId) => {
    writes.push(structuredClone(command)); let patch: RuntimeStatePatch;
    if (command.kind === 'message.edit') {
      const message = dto.messages.find(row => row.id === command.id)!;
      if (command.content !== undefined) message.content = command.content;
      if (command.role !== undefined) message.role = command.role;
      if (command.ownMetadata !== undefined) message.extra = { ...message.extra, spindle_metadata: { lumirealm: command.ownMetadata } };
      patch = { message };
    } else if (command.kind === 'message.create') {
      const before = command.beforeId ? dto.messages.find(row => row.id === command.beforeId) : undefined;
      if (command.beforeId && !before) throw new Error('Insertion target unavailable');
      const index = before?.index_in_chat ?? Math.max(-1, ...dto.messages.map(row => row.index_in_chat)) + 1;
      if (before) for (const row of dto.messages.filter(row => row.index_in_chat >= index)) row.index_in_chat++;
      const message = { id: command.id, role: command.role, content: command.content, index_in_chat: index, send_date: 1900000000,
        extra: { spindle_metadata: { lumirealm: command.ownMetadata } } };
      dto.messages.push(message); dto.messages.sort((a, b) => a.index_in_chat - b.index_in_chat); patch = { message };
    } else if (command.kind === 'message.delete') {
      dto.messages = dto.messages.filter(row => row.id !== command.id); patch = { deletedMessageId: command.id };
    } else if (command.kind === 'chat.variables') {
      dto.chat.metadata.chat_variables = { ...dto.chat.metadata.chat_variables as object, ...command.values }; patch = { chat: dto.chat };
    } else throw new Error(`Unexpected command: ${command.kind}`);
    event(patch, mutationId);
    return structuredClone({ revision: dto.revision, patch, value: patch.message });
  }, () => { notifications++; });
  const config = { ...snapshot(''), chatId: 'chat' };
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<string>();
  const host = createFrontendHost(state, () => runtimeDisplaySnapshot(config, state), DEFAULT_SETTINGS, {
    call: async () => { serviceCalls++; throw new Error('Unexpected service'); },
    ui: { prompt: async () => { entered.resolve(); return resume.promise; } }, expression: async () => {}, invalidate() {}, synchronize: async () => {},
  }, []);
  host.api.personas!.getActive = async () => { personaReads++; throw new Error('Unrelated persona unavailable'); };
  return { state, dto, writes, host, entered, resume, event, counts: () => ({ serviceCalls, personaReads }), notifications: () => notifications,
    async run(code: string, operation: FrontendLuaOperation = { kind: 'edit', mode: 'editInput', value: 'input' }) {
      const source: TriggerScript = { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua', code }] };
      const result = await runFrontendLuaOperation(operation, { ...host, data: { characterId: 'character' }, compiled: prepareTriggerSources([source], 'character'),
        triggers: [{ source, luaCode: code }], atActions: [] }, new AbortController().signal);
      await state.flush(); return result;
    } };
}
