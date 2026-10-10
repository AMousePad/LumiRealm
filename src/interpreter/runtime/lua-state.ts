import type { HostApi, HostCharacter, HostPersona } from '../host.js';

export interface LuaHostState {
  character: HostCharacter | null;
  persona: HostPersona | null;
  authorsNote: string;
  updateCharacter?: (patch: Partial<HostCharacter>) => Promise<void>;
  synchronize?: (refresh?: boolean) => Promise<void>;
}

class LiveValue<T> {
  value: T;
  revision = 0;
  loading?: Promise<void>;
  private dirty = false;
  private read?: () => Promise<T>;
  constructor(value: T) { this.value = value; }
  invalidate(): void { this.revision++; this.dirty = true; }
  async load(read: () => Promise<T>): Promise<void> {
    this.read = read;
    this.dirty = true;
    return this.synchronize();
  }
  async synchronize(): Promise<void> {
    if (this.loading) return this.loading;
    const loading = (async () => {
      while (this.dirty && this.read) {
        this.dirty = false;
        const revision = this.revision;
        try {
          const value = await this.read();
          if (revision === this.revision) this.value = value;
          else this.dirty = true;
        } catch (error) { this.dirty = true; throw error; }
      }
    })();
    this.loading = loading;
    try { await loading; } finally { if (this.loading === loading) delete this.loading; }
  }
}

class LiveCharacter extends LiveValue<HostCharacter | null> {
  private tail: Promise<void> = Promise.resolve();
  private pending = new Set<Partial<HostCharacter>>();
  current(): HostCharacter | null {
    return this.value ? Object.assign({}, this.value, ...this.pending) : null;
  }
  write(patch: Partial<HostCharacter>, persist: () => Promise<void>): Promise<void> {
    this.pending.add(patch);
    this.revision++;
    const result = this.tail.then(async () => {
      try { await persist(); }
      finally {
        if (this.value) this.value = { ...this.value, ...patch };
        this.pending.delete(patch);
        this.invalidate();
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const scopes = new WeakMap<object, {
  characters: Map<string, LiveCharacter>;
  persona: LiveValue<HostPersona | null>;
  notes: Map<string, LiveValue<string>>;
}>();
const backendScopes = new Map<string | undefined, object>();

export function backendLuaStateScope(userId: string | undefined): object {
  let scope = backendScopes.get(userId);
  if (!scope) { scope = {}; backendScopes.set(userId, scope); }
  return scope;
}

function stateFor(scope: object) {
  let state = scopes.get(scope);
  if (!state) {
    state = { characters: new Map(), persona: new LiveValue<HostPersona | null>(null), notes: new Map() };
    scopes.set(scope, state);
  }
  return state;
}

export function hostCharacterState(ch: Record<string, unknown>): HostCharacter {
  return {
    id: String(ch.id), name: typeof ch.name === 'string' ? ch.name : '',
    description: typeof ch.description === 'string' ? ch.description : '',
    firstMessage: typeof ch.first_mes === 'string' ? ch.first_mes : '',
    worldBookIds: Array.isArray(ch.world_book_ids) ? ch.world_book_ids as string[] : [],
    imageId: typeof ch.image_id === 'string' && ch.image_id.length > 0 ? ch.image_id : null,
  };
}

function noteText(note: unknown): string {
  const content = note && typeof note === 'object' && 'content' in note ? note.content : note;
  return typeof content === 'string' ? content : '';
}

export function observeLuaHostState(scope: object, event: string, raw: unknown): void {
  const state = scopes.get(scope);
  if (!state || !raw || typeof raw !== 'object') return;
  const data = raw as { id?: string; chatId?: string; character?: Record<string, unknown>;
    chat?: { id?: string; metadata?: Record<string, unknown> }; changedFields?: string[] };
  if (event === 'CHARACTER_EDITED') {
    const id = data.id ?? data.character?.id;
    if (typeof id === 'string') state.characters.get(id)?.invalidate();
  } else if (event === 'PERSONA_CHANGED') {
    state.persona.invalidate();
  } else if (event === 'CHAT_CHANGED' && data.chat?.id &&
    data.changedFields?.some(field => field === 'metadata' || field === 'metadata.authors_note' || field.startsWith('metadata.authors_note.'))) {
    state.notes.get(data.chat.id)?.invalidate();
  } else if (event === 'CHARACTER_DELETED' && data.id) {
    state.characters.get(data.id)?.invalidate();
    state.characters.delete(data.id);
  } else if (event === 'CHAT_DELETED') {
    const id = data.id ?? data.chatId;
    if (id) { state.notes.get(id)?.invalidate(); state.notes.delete(id); }
  }
}

export async function prepareLuaHostState(api: HostApi, characterId?: string | null): Promise<LuaHostState> {
  const state = stateFor(api.luaStateScope ?? api.characters);
  let character = characterId ? state.characters.get(characterId) : undefined;
  if (characterId && !character) { character = new LiveCharacter(null); state.characters.set(characterId, character); }
  const chatId = api.chat.getChatId?.() ?? '';
  let note = state.notes.get(chatId);
  if (!note) { note = new LiveValue(''); state.notes.set(chatId, note); }
  await Promise.all([
    character?.load(() => api.characters.get(characterId!)),
    state.persona.load(() => api.personas?.getActive() ?? Promise.resolve(null)),
    note.load(async () => noteText(await api.chat.getMetadata('authors_note'))),
  ]);
  return {
    get character() { return character?.current() ?? null; },
    get persona() { return state.persona.value; },
    get authorsNote() { return note.value; },
    async synchronize(refresh = false) {
      // Host notifications can arrive after their write RPC has completed.
      if (refresh) { character?.invalidate(); state.persona.invalidate(); note.invalidate(); }
      await Promise.all([character?.synchronize(), state.persona.synchronize(), note.synchronize()]);
    },
    updateCharacter(patch) {
      if (!characterId || !character?.current()) throw new Error('Lua character state is unavailable');
      return character.write(patch, () => api.characters.update(characterId, patch));
    },
  };
}
