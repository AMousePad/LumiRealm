import type { HostApi, HostMessage } from '../host.js';
import { luaMessageEdit } from '../../util/lua-message-data.js';
import { saveVars } from './chat-state.js';
import { createLocalLoreFrame, characterLocalLore, publishLocalLoreFrame, type LocalLoreAccess, type LocalLoreFrame } from './local-lore.js';

type Variables = Record<string, string | null>;

export interface TriggerInvocationState {
  localLoreAccess?: LocalLoreAccess;
  localLore?: LocalLoreFrame;
  varsCache?: Variables;
  messagesCache?: HostMessage[];
  firstMessage?: string;
  stopSending: boolean;
  live?: {
    varsCache: Variables;
    messagesCache?: HostMessage[];
    dirty: { value: boolean };
    varsFlushed: boolean;
    nextMessage: number;
    additionalSysPrompt: Record<'start' | 'historyend' | 'promptend', string>;
    api: HostApi;
  };
}

export function initializeInvocation(
  state: TriggerInvocationState,
  api: HostApi,
  beforeEdit?: (id: string, content: string) => void,
): void {
  if (state.live) return;
  state.live = {
    varsCache: state.varsCache!, dirty: { value: false }, varsFlushed: false, nextMessage: 0,
    additionalSysPrompt: { start: '', historyend: '', promptend: '' },
    api: { ...api, chat: {
      ...api.chat,
      editMessage: async (id, content, options) => {
        if (content !== undefined) beforeEdit?.(id, content);
        await api.chat.editMessage(id, content, options);
        const messagesCache = state.live!.messagesCache;
        if (!messagesCache) return;
        const index = messagesCache.findIndex(message => message.id === id);
        if (index >= 0) messagesCache[index] = { ...messagesCache[index]!, ...(content !== undefined ? { content, luaData: undefined } : {}), ...options };
      },
      deleteMessage: async id => {
        await api.chat.deleteMessage(id);
        const messagesCache = state.live!.messagesCache;
        if (!messagesCache) return;
        const index = messagesCache.findIndex(message => message.id === id);
        if (index >= 0) messagesCache.splice(index, 1);
      },
      sendMessage: async (content, options) => {
        const result = await api.chat.sendMessage(content, options);
        const rows = state.live!.messagesCache;
        if (rows) {
          const index = options?.beforeId ? rows.findIndex(message => message.id === options.beforeId) : -1;
          rows.splice(index < 0 ? rows.length : index, 0, { id: result.id, content, role: options?.role ?? 'assistant',
            ...(options?.luaData ? { luaData: options.luaData } : {}),
            ...(options?.createdAt !== undefined ? { createdAt: options.createdAt } : {}) });
        }
        return result;
      },
    } },
  };
}

function messageBaseline(state: TriggerInvocationState): HostMessage[] {
  return state.live!.messagesCache ??= state.messagesCache!.map(message => ({ ...message }));
}

export function invocationHostApi(state: TriggerInvocationState): HostApi {
  const live = state.live!;
  const baseline = messageBaseline(state);
  // Runtime mutations already update the frame's message array; only a successful caller commits it.
  return { ...live.api, chat: {
    ...live.api.chat,
    editMessage: async () => {},
    deleteMessage: async () => {},
    sendMessage: async () => {
      let id: string;
      do { id = 'pending:' + ++live.nextMessage; }
      while (baseline.some(message => message.id === id));
      return { id };
    },
  } };
}

export function cloneInvocation(state: TriggerInvocationState): TriggerInvocationState {
  messageBaseline(state);
  return {
    ...(state.localLore ? { localLore: { character: characterLocalLore(state.localLore), chat: state.localLore.chat, access: state.localLore.access, selection: state.localLore.selection } }
      : state.localLoreAccess ? { localLore: createLocalLoreFrame(state.localLoreAccess) } : {}),
    ...(state.localLoreAccess ? { localLoreAccess: state.localLoreAccess } : {}),
    varsCache: { ...state.varsCache },
    messagesCache: state.messagesCache!.map(message => ({ ...message })),
    ...(state.firstMessage !== undefined ? { firstMessage: state.firstMessage } : {}),
    stopSending: state.stopSending,
    live: state.live!,
  };
}

export function adoptInvocation(parent: TriggerInvocationState, child: TriggerInvocationState): void {
  if (child.localLore) {
    parent.localLore ??= createLocalLoreFrame(child.localLore.access);
    parent.localLore.chat = child.localLore.chat;
  }
  for (const key of Object.keys(parent.varsCache!)) delete parent.varsCache![key];
  Object.assign(parent.varsCache!, child.varsCache);
  parent.messagesCache!.splice(0, parent.messagesCache!.length, ...child.messagesCache!);
  parent.stopSending = child.stopSending;
  if (parent.live!.varsCache === child.varsCache) parent.live!.varsCache = parent.varsCache!;
}

export async function commitInvocation(state: TriggerInvocationState, chatId?: string, injectPrompts = false, adoptLocalChat = true): Promise<void> {
  const live = state.live;
  if (!live) return;
  if (adoptLocalChat && state.localLore) await publishLocalLoreFrame(state.localLore, 'chat');
  const variables = state.varsCache!;
  if (live.varsCache !== variables) {
    const keys = Object.keys(variables);
    if (keys.length !== Object.keys(live.varsCache).length || keys.some(key => variables[key] !== live.varsCache[key])) {
      live.dirty.value = true;
    }
    live.varsCache = variables;
  }
  if (live.dirty.value) {
    await saveVars(live.api, live.varsCache, chatId);
    live.varsFlushed = true;
    live.dirty.value = false;
  }
  const desired = state.messagesCache!;
  const baseline = messageBaseline(state);
  const previousById = new Map(baseline.map(message => [message.id, message]));
  const retainedIds = new Set(desired.map(message => message.id));
  for (const previous of [...baseline]) {
    if (!retainedIds.has(previous.id)) await live.api.chat.deleteMessage(previous.id);
  }
  const anchors = new Array<string | undefined>(desired.length);
  let anchor: string | undefined;
  for (let i = desired.length - 1; i >= 0; i--) { anchors[i] = anchor; if (previousById.has(desired[i]!.id)) anchor = desired[i]!.id; }
  for (const [index, message] of desired.entries()) {
    const previous = previousById.get(message.id);
    if (!previous) {
      const result = await live.api.chat.sendMessage(message.content, { role: message.role, createdAt: message.createdAt ?? 0,
        ...(message.luaData ? { luaData: message.luaData } : {}),
        ...(anchors[index] ? { beforeId: anchors[index] } : {}) });
      (message as { id: string }).id = result.id;
    } else {
      const edit = luaMessageEdit(previous, message);
      if (edit) await live.api.chat.editMessage(message.id, edit.content, edit.options);
    }
  }
  if (injectPrompts && !state.stopSending) {
    for (const location of ['start', 'historyend', 'promptend'] as const) {
      const content = live.additionalSysPrompt[location];
      if (content) await live.api.chat.inject('risu-sys-' + location, content, { mode: 'context', position: location, role: 'system' });
    }
  }
}
