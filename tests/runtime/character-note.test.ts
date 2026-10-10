import { describe, expect, test } from 'bun:test';
import { makeCharacterNoteApi } from '../../src/interpreter/runtime/character-note.js';
import { makeVarsApi } from '../../src/interpreter/runtime/vars.js';
import type { HostApi } from '../../src/interpreter/host.js';

interface FakeApiState {
  api: HostApi;
  charDescByCharId: Record<string, string>;
  charUpdates: Array<{ id: string; patch: { description?: string } }>;
  personaDesc: string | null;
  personaUpdates: Array<{ id: string; patch: { description?: string } }>;
  metadata: Record<string, unknown>;
}

function makeFake(opts: Partial<FakeApiState> = {}): FakeApiState {
  const state: FakeApiState = {
    charDescByCharId: opts.charDescByCharId ?? {},
    charUpdates: [],
    personaDesc: opts.personaDesc ?? null,
    personaUpdates: [],
    metadata: opts.metadata ?? {},
    api: undefined as unknown as HostApi,
  };
  state.api = {
    chat: {
      async getMetadata(key: string) { return state.metadata[key]; },
      async setMetadata(key: string, value: unknown) { state.metadata[key] = value; },
      async getMessages() { return []; },
      async sendMessage() { return { id: 'x' }; },
      async editMessage() {},
      async deleteMessage() {},
      async inject() {},
    },
    characters: {
      async get(id: string) {
        return { id, description: state.charDescByCharId[id] ?? '' } as ReturnType<HostApi['characters']['get']> extends Promise<infer T> ? T : never;
      },
      async update(id: string, patch: { description?: string }) {
        state.charUpdates.push({ id, patch });
      },
    },
    personas: {
      async getActive() {
        return state.personaDesc !== null
          ? ({ id: 'p1', description: state.personaDesc } as Awaited<ReturnType<NonNullable<HostApi['personas']>['getActive']>>)
          : null;
      },
      async update(id: string, patch: { description?: string }) {
        state.personaUpdates.push({ id, patch });
      },
    },
  } as unknown as HostApi;
  return state;
}

function newVars(initial: Record<string, string> = {}) {
  return makeVarsApi({
    varsCache: { ...initial },
    localScopes: new Map(),
    dirty: { value: false },
    characterId: null,
  });
}

describe('character-note.character + persona', () => {
  test('getCharacterDesc reads from api.characters.get', async () => {
    const fake = makeFake({ charDescByCharId: { 'c1': 'Alice the brave' } });
    const api = makeCharacterNoteApi(fake.api, { characterId: 'c1', data: {} }, newVars());
    expect(await api.getCharacterDesc()).toBe('Alice the brave');
  });

  test('falls back to data.characterId when state.characterId is null', async () => {
    const fake = makeFake({ charDescByCharId: { 'c-from-data': 'Bob' } });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: { characterId: 'c-from-data' } }, newVars());
    expect(await api.getCharacterDesc()).toBe('Bob');
  });

  test('no character id at all → empty string', async () => {
    const fake = makeFake();
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, newVars());
    expect(await api.getCharacterDesc()).toBe('');
  });

  test('setCharacterDesc → api.characters.update with description patch', async () => {
    const fake = makeFake();
    const api = makeCharacterNoteApi(fake.api, { characterId: 'c1', data: {} }, newVars());
    await api.setCharacterDesc('new desc');
    expect(fake.charUpdates).toEqual([{ id: 'c1', patch: { description: 'new desc' } }]);
  });

  test('getPersonaDesc reads from api.personas.getActive', async () => {
    const fake = makeFake({ personaDesc: 'persona text' });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, newVars());
    expect(await api.getPersonaDesc()).toBe('persona text');
  });

  test('getPersonaDesc with no active persona → empty string', async () => {
    const fake = makeFake({ personaDesc: null });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, newVars());
    expect(await api.getPersonaDesc()).toBe('');
  });

  test('setPersonaDesc updates active persona', async () => {
    const fake = makeFake({ personaDesc: 'old' });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, newVars());
    await api.setPersonaDesc('new persona');
    expect(fake.personaUpdates).toEqual([{ id: 'p1', patch: { description: 'new persona' } }]);
  });
});

describe('character-note.replaceGlobalNote', () => {
  test('round-trips through chat-var __risu_global_note__', async () => {
    const fake = makeFake();
    const vars = newVars();
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    expect(await api.getReplaceGlobalNote()).toBe('null'); // missing → Risu default
    await api.setReplaceGlobalNote('global stuff');
    expect(await api.getReplaceGlobalNote()).toBe('global stuff');
    expect(vars.getVar('__risu_global_note__')).toBe('global stuff');
  });
});

describe('character-note.authorNote', () => {
  test('getAuthorNote prefers chat.metadata.authors_note over legacy chat var', async () => {
    const fake = makeFake({ metadata: { authors_note: { content: 'modern slot' } } });
    const vars = newVars({ '$__risu_author_note__': 'legacy slot' });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    expect(await api.getAuthorNote()).toBe('modern slot');
  });

  test('falls back to chat var when authors_note is empty', async () => {
    const fake = makeFake({ metadata: { authors_note: { content: '' } } });
    const vars = newVars({ '$__risu_author_note__': 'legacy fallback' });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    expect(await api.getAuthorNote()).toBe('legacy fallback');
  });

  test('falls back to chat var when authors_note is missing entirely', async () => {
    const fake = makeFake();
    const vars = newVars({ '$__risu_author_note__': 'legacy only' });
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    expect(await api.getAuthorNote()).toBe('legacy only');
  });

  test('setAuthorNote writes BOTH legacy chat var AND authors_note metadata', async () => {
    const fake = makeFake();
    const vars = newVars();
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    await api.setAuthorNote('important note');
    expect(vars.getVar('__risu_author_note__')).toBe('important note');
    expect(fake.metadata.authors_note).toEqual({
      content: 'important note',
      depth: 4,         // default
      role: 'system',   // default
      position: 0,      // default
    });
  });

  test('setAuthorNote preserves prior depth/role/position from authors_note', async () => {
    const fake = makeFake({
      metadata: { authors_note: { content: 'old', depth: 7, role: 'assistant', position: 1 } },
    });
    const vars = newVars();
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    await api.setAuthorNote('updated content');
    expect(fake.metadata.authors_note).toEqual({
      content: 'updated content',
      depth: 7,
      role: 'assistant',
      position: 1,
    });
  });

  test('setAuthorNote sanitises invalid prior role to "system"', async () => {
    const fake = makeFake({
      metadata: { authors_note: { content: 'x', role: 'weird-role', depth: 2 } },
    });
    const vars = newVars();
    const api = makeCharacterNoteApi(fake.api, { characterId: null, data: {} }, vars);
    await api.setAuthorNote('updated');
    expect((fake.metadata.authors_note as { role: string }).role).toBe('system');
  });
});
