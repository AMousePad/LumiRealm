import type { HostApi, HostMessage, HostCharacter, HostPersona, HostDomHandle } from '../interpreter/host.js';
import type { TriggerRuntimePreloaded } from '../interpreter/host.js';
import type { LorebookCache } from '../interpreter/runtime/lorebook.js';
import type { DisplaySnapshot } from './snapshot.js';
import { makeSafeLogger } from '../util/safe-log.js';

const log = makeSafeLogger('display-shim');

export function buildPreloaded(snap: DisplaySnapshot): TriggerRuntimePreloaded {
  const varsCache: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.vars.local)) varsCache['$' + k] = v;
  const lorebook: LorebookCache = {
    entries: [...snap.lorebookHost],
    primaryBookId: (snap.lorebookHost[0]?.worldBookId as string | undefined) ?? null,
  };
  return { varsCache, messagesRaw: snap.messagesHost, lorebook };
}

export type DisplayVarWriteback = (vars: Record<string, string>) => void;

export function makeSnapshotHostApi(snap: DisplaySnapshot, onVarWrite?: DisplayVarWriteback): HostApi {
  const noWrite = async (): Promise<void> => { /* read-only display surfaces */ };
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
      editMessage: noWrite,
      deleteMessage: noWrite,
      getMetadata,
      setMetadata,
      inject: noWrite,
    },
    characters: {
      get: (id: string): Promise<HostCharacter> =>
        Promise.resolve({ id, description: snap.character.description, worldBookIds: [], imageId: snap.character.imageId }),
      update: noWrite,
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
