import type { HostApi, HostMessage, HostCharacter, HostPersona, HostDomHandle } from '../../src/interpreter/host.js';
import { getDisplaySnapshot, type DisplaySnapshot } from '../../src/display/snapshot.js';
import type { DisplayVarWriteback } from '../../src/display/host-shim.js';
import { makeSafeLogger } from '../../src/util/safe-log.js';
const log = makeSafeLogger('display-shim');

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
      if (orig[k] === v) continue;
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
        Promise.resolve({ id, ...snap.character, name: snap.charName, worldBookIds: [] }),
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
