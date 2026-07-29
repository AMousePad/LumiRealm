import type { SpindleDisplayContext } from 'lumiverse-spindle-types';
import type { HostApi, HostMessage, HostCharacter, HostPersona, HostDomHandle } from '../interpreter/host.js';
import type { TriggerRuntimePreloaded } from '../interpreter/host.js';
import type { LorebookCache } from '../interpreter/runtime/lorebook.js';
import type { DisplaySnapshot } from './snapshot.js';
import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('display-shim');

/**
 * Risu renders against its live in-memory chat object. The host can render an
 * edited or streaming message before the next backend snapshot arrives, so
 * make the current bubble authoritative for its exact getFullChat() row.
 */
export function withCurrentDisplayMessage(
  snap: DisplaySnapshot,
  context: SpindleDisplayContext,
  content: string,
): DisplaySnapshot {
  const idIndex = context.messageId
    ? snap.messagesHost.findIndex((message) => message.id === context.messageId)
    : -1;
  const contextIndex = context.messageIndex;
  const index = idIndex >= 0
    ? idIndex
    : (typeof contextIndex === 'number' && Number.isInteger(contextIndex)
      ? contextIndex
      : -1);
  if (index < 0 || index > snap.messagesHost.length) return snap;

  const messagesHost = [...snap.messagesHost];
  const current = messagesHost[index];
  const next: HostMessage = {
    id: context.messageId ?? current?.id ?? '',
    role: context.role ?? current?.role ?? (context.isUser ? 'user' : 'assistant'),
    content,
  };
  if (
    current?.id === next.id &&
    current.role === next.role &&
    current.content === next.content
  ) return snap;

  if (current) messagesHost[index] = next;
  else messagesHost.push(next);
  return { ...snap, messagesHost };
}

export function buildPreloaded(snap: DisplaySnapshot): TriggerRuntimePreloaded {
  const varsCache: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.vars.local)) varsCache['$' + k] = v;
  const lorebook: LorebookCache = {
    entries: [...snap.lorebookHost],
    primaryBookId: (snap.lorebookHost[0]?.worldBookId as string | undefined) ?? null,
  };
  return {
    varsCache,
    globalVars: { ...snap.vars.global },
    scriptstateDefaults: snap.scriptstateDefaults,
    messagesRaw: snap.messagesHost,
    lorebook,
  };
}

export type DisplayVarWriteback = (vars: Record<string, string>) => void;

export type DisplayRuntimeEffect =
  | {
      readonly kind: 'set-expression';
      readonly chatId: string;
      readonly characterId: string;
      readonly label: string;
      readonly imageId: string;
    }
  | {
      readonly kind: 'edit-message';
      readonly chatId: string;
      readonly messageId: string;
      readonly content: string;
    };

export type DisplayRuntimeEffectSink = (
  effect: DisplayRuntimeEffect,
) => void | Promise<void>;

export function makeSnapshotHostApi(
  snap: DisplaySnapshot,
  onVarWrite?: DisplayVarWriteback,
  onEffect?: DisplayRuntimeEffectSink,
): HostApi {
  const noWrite = async (): Promise<void> => { /* read-only display surfaces */ };
  const emitEffect = async (effect: DisplayRuntimeEffect): Promise<void> => {
    await onEffect?.(effect);
  };
  const setExpression = async (label: string): Promise<void> => {
    const imageId = snap.character.emotionImages[label]?.imageIds[0];
    if (!imageId) return;
    await emitEffect({
      kind: 'set-expression',
      chatId: snap.chatId,
      characterId: snap.characterId,
      label,
      imageId,
    });
  };
  const editMessage = async (
    messageId: string,
    content: string,
  ): Promise<void> => {
    const current = snap.messagesHost.find(
      (message) => message.id === messageId,
    );
    if (current?.content === content) return;
    await emitEffect({
      kind: 'edit-message',
      chatId: snap.chatId,
      messageId,
      content,
    });
  };
  const setMetadata = async (key: string, value: unknown): Promise<void> => {
    if (key !== 'chat_variables' || !onVarWrite) return;
    if (!value || typeof value !== 'object') return;
    const orig = snap.vars.local;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = typeof v === 'string' ? v : String(v);
      if (orig[k] !== s) out[k] = s;
    }
    if (Object.keys(out).length === 0) return;
    onVarWrite(out);
  };
  const getMetadata = (key: string): Promise<unknown> => {
    if (key === 'chat_variables') return Promise.resolve({ ...snap.vars.local });
    if (key === 'macro_variables') return Promise.resolve({ global: { ...snap.vars.global } });
    if (key === 'authors_note') return Promise.resolve(snap.chatAuthorsNote ?? undefined);
    return Promise.resolve(undefined);
  };
  const loud = (surface: string): void =>
    log.error(`[FE-DISPLAY] editDisplay reached api.${surface} — unavailable in browser display resolution; degrading (this diverges from the backend, surface it).`);
  return {
    chat: {
      getChatId: () => snap.chatId,
      getMessages: (): Promise<readonly HostMessage[]> => Promise.resolve(snap.messagesHost),
      sendMessage: async () => ({ id: '' }),
      editMessage,
      deleteMessage: noWrite,
      getMetadata,
      setMetadata,
      inject: noWrite,
      setExpression,
    },
    characters: {
      get: (id: string): Promise<HostCharacter> =>
        Promise.resolve({ id, description: snap.character.description, worldBookIds: [], imageId: snap.character.imageId }),
      update: noWrite,
      setExpression,
    },
    personas: {
      getActive: (): Promise<HostPersona | null> =>
        Promise.resolve({ id: '', description: snap.personaText, imageId: snap.personaImageId }),
      update: noWrite,
    },
    ui: {
      toast: () => { loud('ui.toast'); },
      alert: async () => { loud('ui.alert'); },
      prompt: async () => { loud('ui.prompt'); return null; },
      confirm: async () => { loud('ui.confirm'); return false; },
      pick: async () => { loud('ui.pick'); return null; },
      dom: {
        inject: (): HostDomHandle => {
          loud('ui.dom.inject');
          return { on: () => () => undefined, remove: () => undefined };
        },
      },
    },
    utils: {
      template: {
        render: async (text: string): Promise<string> => { loud('utils.template.render'); return text; },
      },
    },
    broadcast: {
      emit: () => { loud('broadcast.emit'); },
      on: () => { loud('broadcast.on'); return () => undefined; },
    },
  };
}
