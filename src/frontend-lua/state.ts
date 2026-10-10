import { v4 } from 'uuid';
import type { HostMessage, HostCharacter, HostPersona, HostWorldInfoEntry, TriggerRuntimeOpts } from '../interpreter/host.js';
import { OrderedRuntimeState, type StatePatch, type StateRevision } from './ordered-state.js';
import { runtimeMessage, runtimeCharacter, runtimePersona, runtimeLore, type RuntimeStateDto, type RuntimeStatePatch, type RuntimeStateCommand, type RuntimeStateWrite } from './state-contract.js';
import { buildRisuChatView } from '../interpreter/risu-chat-view.js';
import { parseGlobalVars } from '../interpreter/runtime/chat-state.js';

type Fields = Record<string, unknown>;
const key = (group: string, id: string, field: string) => JSON.stringify([group, id, field]);

export class FrontendRuntimeState {
  readonly chatId: string;
  readonly characterId: string;
  readonly messages: HostMessage[] = [];
  private readonly state: OrderedRuntimeState;
  private readonly messageIds = new Set<string>();
  private readonly loreIds = new Set<string>();
  private readonly fieldNames = new Map<string, Set<string>>();
  private observedMessages: HostMessage[] = [];
  private tail: Promise<void> = Promise.resolve();
  private writes = new Set<Promise<unknown>>();
  private failures: unknown[] = [];
  private stagedVariables = new Map<symbol, readonly string[]>();
  private readonly mutations = new Map<string, { ids: readonly symbol[]; partial?: symbol }>();
  private activeChatMutation: symbol | undefined;
  private greeting: string | undefined;
  private readonly messageObservers = new Set<(ids: ReadonlySet<string>) => void>();

  constructor(initial: RuntimeStateDto,
    private readonly persist: (command: RuntimeStateCommand, mutationId: string) => Promise<RuntimeStateWrite>,
    private readonly changed: (keys: readonly string[]) => void,
  ) {
    this.chatId = initial.chat.id;
    this.characterId = initial.character.id;
    const patch = this.snapshotPatch(initial);
    this.state = new OrderedRuntimeState(initial.revision, patch, keys => this.publish(keys));
    this.publish([...patch.keys()]);
  }

  private record(patch: Map<string, unknown>, group: string, id: string, values: Fields, replace = false): void {
    const groupKey = JSON.stringify([group, id]);
    const names = this.fieldNames.get(groupKey) ?? new Set<string>();
    if (replace) for (const name of names) if (!Object.hasOwn(values, name)) patch.set(key(group, id, name), undefined);
    for (const [name, value] of Object.entries(values)) { names.add(name); patch.set(key(group, id, name), value); }
    this.fieldNames.set(groupKey, names);
  }

  private object(group: string, id = ''): Fields {
    const names = this.fieldNames.get(JSON.stringify([group, id])) ?? [];
    return Object.fromEntries([...names].map(name => [name, this.state.get(key(group, id, name))]).filter(([, value]) => value !== undefined));
  }

  private patch(value: RuntimeStatePatch): Map<string, unknown> {
    const patch = new Map<string, unknown>();
    if (value.chat) {
      const { chat_variables, ...metadata } = value.chat.metadata;
      this.record(patch, 'metadata', '', metadata, true);
      this.record(patch, 'vars', '', (chat_variables ?? {}) as Fields, true);
      this.record(patch, 'global', '', parseGlobalVars(metadata.macro_variables), true);
    }
    if (value.character?.id === this.characterId) this.record(patch, 'character', '', value.character, true);
    if (Object.hasOwn(value, 'persona')) this.record(patch, 'persona', '', value.persona ?? {}, true);
    if (value.message) {
      this.messageIds.add(value.message.id);
      this.record(patch, 'message', value.message.id, { ...runtimeMessage(value.message), index: value.message.index_in_chat, present: true }, true);
    }
    if (value.deletedMessageId) this.record(patch, 'message', value.deletedMessageId, { present: false });
    if (value.loreEntry) {
      this.loreIds.add(value.loreEntry.id);
      this.record(patch, 'lore', value.loreEntry.id, { ...runtimeLore(value.loreEntry), present: true }, true);
    }
    if (value.deletedLoreId) this.record(patch, 'lore', value.deletedLoreId, { present: false });
    return patch;
  }

  private snapshotPatch(value: RuntimeStateDto): Map<string, unknown> {
    const patch = this.patch(value);
    const messageIds = new Set(value.messages.map(message => message.id));
    const loreIds = new Set(value.lore.map(entry => entry.id));
    for (const id of this.messageIds) if (!messageIds.has(id)) this.record(patch, 'message', id, { present: false });
    for (const id of this.loreIds) if (!loreIds.has(id)) this.record(patch, 'lore', id, { present: false });
    for (const message of value.messages) for (const [key, item] of this.patch({ message })) patch.set(key, item);
    for (const loreEntry of value.lore) for (const [key, item] of this.patch({ loreEntry })) patch.set(key, item);
    return patch;
  }

  private publish(keys: readonly string[]): void {
    if (keys.some(key => key.startsWith('["message",'))) {
      const view = buildRisuChatView({ messages: this.hostMessages() });
      this.messages.splice(0, this.messages.length, ...view.messages);
      this.observedMessages = this.messages.map(message => ({ ...message }));
      this.greeting = view.greeting;
      const ids = new Set(keys.filter(key => key.startsWith('["message",')).map(key => JSON.parse(key)[1] as string));
      for (const observer of this.messageObservers) observer(ids);
    }
    this.changed(keys);
  }

  apply(revision: StateRevision, patch: RuntimeStatePatch, mutationId?: string): void {
    const pending = mutationId ? this.mutations.get(mutationId) : undefined;
    if (pending) {
      this.state.settleMany(pending.ids, revision, this.patch(patch), pending.partial);
      this.mutations.delete(mutationId!);
    } else this.state.apply(revision, this.patch(patch));
  }
  replace(value: RuntimeStateDto): void { this.state.apply(value.revision, this.snapshotPatch(value)); }

  hostMessages(): HostMessage[] {
    return [...this.messageIds].map(id => this.object('message', id)).filter(value => value.present)
      .sort((a, b) => Number(a.index) - Number(b.index)).map(({ index: _index, present: _present, ...value }) => value as unknown as HostMessage);
  }
  character(): HostCharacter { return runtimeCharacter(this.object('character') as RuntimeStateDto['character']); }
  persona(): HostPersona | null { const value = this.object('persona'); return runtimePersona(value.id ? value as RuntimeStateDto['persona'] : null); }
  metadata(name: string): unknown { return name === 'chat_variables' ? this.variables() : this.state.get(key('metadata', '', name)); }
  variables(): Record<string, string | null> { return this.object('vars') as Record<string, string | null>; }
  globalVariables(): Record<string, string | null> { return this.object('global') as Record<string, string | null>; }
  variable(name: string, global = false): string | null | undefined { return this.state.get(key(global ? 'global' : 'vars', '', name)) as string | null | undefined; }
  stageVariables(values: Record<string, string | null>): void {
    if (!Object.keys(values).length) return;
    const patch = new Map<string, unknown>();
    this.record(patch, 'vars', '', values);
    this.stagedVariables.set(this.state.begin(patch), Object.keys(values));
  }
  lore(): HostWorldInfoEntry[] { return [...this.loreIds].map(id => this.object('lore', id)).filter(value => value.present) as unknown as HostWorldInfoEntry[]; }

  private optimistic(command: RuntimeStateCommand): StatePatch {
    const patch = new Map<string, unknown>();
    switch (command.kind) {
      case 'chat.metadata':
        this.record(patch, 'metadata', '', { [command.key]: command.value });
        if (command.key === 'macro_variables') this.record(patch, 'global', '', parseGlobalVars(command.value), true);
        break;
      case 'chat.variables': this.record(patch, 'vars', '', command.values); break;
      case 'character.update': this.record(patch, 'character', '', command.patch); break;
      case 'persona.update': this.record(patch, 'persona', '', command.patch); break;
      case 'message.edit': this.record(patch, 'message', command.id, { content: command.content }); break;
      case 'message.delete': this.record(patch, 'message', command.id, { present: false }); break;
      case 'message.create': {
        this.messageIds.add(command.id);
        const index = Math.max(-1, ...[...this.messageIds].map(id => Number(this.object('message', id).index ?? -1))) + 1;
        this.record(patch, 'message', command.id, { id: command.id, content: command.content, role: command.role, index, present: true });
        break;
      }
      case 'lore.update': this.record(patch, 'lore', command.id, { ...command.patch, ...(command.patch.order_value !== undefined ? { orderValue: command.patch.order_value } : {}) }); break;
      case 'lore.delete': this.record(patch, 'lore', command.id, { present: false }); break;
      case 'lore.create': break;
    }
    return patch;
  }

  write(command: RuntimeStateCommand, optimistic = true, staged: readonly symbol[] = []): Promise<unknown> {
    const id = this.state.begin(optimistic ? this.optimistic(command) : new Map());
    const mutationId = v4();
    this.mutations.set(mutationId, { ids: [id, ...staged],
      ...(!optimistic && this.activeChatMutation && command.kind.startsWith('message.') ? { partial: this.activeChatMutation } : {}) });
    const operation = this.persist(command, mutationId).then(result => {
      this.apply(result.revision, result.patch, mutationId);
      return result.value;
    }).catch(error => {
      for (const token of this.mutations.get(mutationId)?.ids ?? []) this.state.discard(token);
      this.mutations.delete(mutationId); this.failures.push(error); throw error;
    });
    this.writes.add(operation);
    void operation.finally(() => this.writes.delete(operation)).catch(() => {});
    return operation;
  }

  displayChat(initial: readonly HostMessage[], persistence: NonNullable<TriggerRuntimeOpts['luaChat']>['persistence']) {
    const rows = initial.map(message => ({ ...message }));
    const view = buildRisuChatView({ messages: rows });
    let greeting = view.greeting;
    const chat = this.chatAdapter(view.messages, () => greeting, persistence);
    const observe = (ids: ReadonlySet<string>) => {
      const current = new Map(this.hostMessages().map(message => [message.id, message]));
      for (let i = rows.length - 1; i >= 0; i--) {
        const id = rows[i]!.id;
        if (!ids.has(id)) continue;
        const next = current.get(id);
        if (next) rows[i] = { ...next };
        else rows.splice(i, 1);
      }
      for (const id of ids) if (current.has(id) && !rows.some(message => message.id === id)) rows.push({ ...current.get(id)! });
      const next = buildRisuChatView({ messages: rows });
      greeting = next.greeting;
      view.messages.splice(0, view.messages.length, ...next.messages);
      chat.observed();
    };
    this.messageObservers.add(observe);
    return { chat: chat.value, release: () => this.messageObservers.delete(observe) };
  }

  luaChat(persistence?: NonNullable<TriggerRuntimeOpts['luaChat']>['persistence']): NonNullable<TriggerRuntimeOpts['luaChat']> {
    return this.chatAdapter(this.messages, () => this.greeting, persistence).value;
  }

  private chatAdapter(messages: HostMessage[], greeting: () => string | undefined,
    persistence?: NonNullable<TriggerRuntimeOpts['luaChat']>['persistence']) {
    const owner = this;
    let observed = messages.map(message => ({ ...message }));
    const value: NonNullable<TriggerRuntimeOpts['luaChat']> = {
      messages,
      ...(persistence ? { persistence } : {}),
      get firstMessage() { return greeting(); },
      enqueue: operation => {
        // Capture at the synchronous Lua mutation, before an earlier persistence write can resume.
        const patch = new Map<string, unknown>();
        const previous = new Map((messages === owner.messages ? this.observedMessages : observed).map(message => [message.id, message]));
        const present = new Set<string>();
        for (const [index, message] of messages.entries()) {
          if (!message.id) (message as { id: string }).id = v4();
          present.add(message.id);
          const before = previous.get(message.id);
          if (!before) {
            this.messageIds.add(message.id);
            this.record(patch, 'message', message.id, { ...message, index: index + (greeting() === undefined ? 0 : 1), present: true });
          } else {
            this.record(patch, 'message', message.id, Object.fromEntries(Object.entries(message).filter(([name, value]) => value !== (before as unknown as Fields)[name])));
          }
        }
        for (const id of previous.keys()) if (!present.has(id)) this.record(patch, 'message', id, { present: false });
        const id = this.state.begin(patch);
        const pending = this.tail.then(async () => {
          this.activeChatMutation = id;
          try { await operation(); } finally { this.activeChatMutation = undefined; }
        }).finally(() => this.state.discard(id));
        this.tail = pending.catch(error => { this.failures.push(error); });
        return pending;
      },
    };
    return { value, observed: () => { observed = messages.map(message => ({ ...message })); } };
  }

  async flush(): Promise<void> {
    if (this.stagedVariables.size) {
      const staged = this.stagedVariables;
      this.stagedVariables = new Map();
      const values = Object.fromEntries([...new Set([...staged.values()].flat())].map(name => [name, this.variable(name) ?? null]));
      try { await this.write({ kind: 'chat.variables', values }, false, [...staged.keys()]); }
      catch { /* write records the failure for the aggregate below. */ }
      finally { for (const id of staged.keys()) this.state.discard(id); }
    }
    await this.tail;
    while (this.writes.size) await Promise.allSettled(this.writes);
    const failures = this.failures.splice(0);
    if (failures.length) throw new AggregateError(failures, 'Frontend Lua persistence failed');
  }
}
