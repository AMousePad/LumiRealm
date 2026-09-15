// Character desc, persona desc, author note, global note.
// setAuthorNote writes both Lumi's authors_note metadata and the legacy __risu_author_note__ var.
// getAuthorNote prefers the Lumi surface; falls back to the legacy var.

import { invalidateAuthorsNoteCache } from '../../state/authors-note-cache.js';
import { toStr } from '../../util/coerce.js';
import type { HostApi } from '../host.js';
import type { VarsApi } from './vars.js';

export interface CharacterNoteState {
  readonly characterId: string | null;
  readonly data: { characterId?: string } & Record<string, unknown>;
}

export interface CharacterNoteApi {
  getCharacterDesc(): Promise<string>;
  setCharacterDesc(value: unknown): Promise<void>;
  getPersonaDesc(): Promise<string>;
  setPersonaDesc(value: unknown): Promise<void>;
  getReplaceGlobalNote(): Promise<string>;
  setReplaceGlobalNote(value: unknown): Promise<void>;
  getAuthorNote(): Promise<string>;
  setAuthorNote(value: unknown): Promise<void>;
}

export function makeCharacterNoteApi(
  api: HostApi,
  state: CharacterNoteState,
  vars: VarsApi,
): CharacterNoteApi {
  return {
    async getCharacterDesc(): Promise<string> {
      try {
        const cid = state.characterId || state.data.characterId;
        if (!cid) return '';
        const ch = await api.characters.get(cid);
        return toStr(ch && ch.description);
      } catch { return ''; }
    },
    async setCharacterDesc(value: unknown): Promise<void> {
      try {
        const cid = state.characterId || state.data.characterId;
        if (!cid) return;
        await api.characters.update(cid, { description: toStr(value) });
      } catch { /* */ }
    },
    async getPersonaDesc(): Promise<string> {
      try {
        if (api.personas?.getActive) {
          const p = await api.personas.getActive();
          return toStr(p?.description);
        }
      } catch { /* */ }
      return '';
    },
    async setPersonaDesc(value: unknown): Promise<void> {
      try {
        if (api.personas?.getActive && api.personas.update) {
          const p = await api.personas.getActive();
          if (p?.id) await api.personas.update(p.id, { description: toStr(value) });
        }
      } catch { /* */ }
    },
    async getReplaceGlobalNote(): Promise<string> { return toStr(vars.getVar('__risu_global_note__')); },
    async setReplaceGlobalNote(value: unknown): Promise<void> { vars.setVar('__risu_global_note__', toStr(value)); },
    async getAuthorNote(): Promise<string> {
      try {
        const an = (await api.chat.getMetadata('authors_note')) as
          | { content?: unknown }
          | undefined
          | null;
        if (an && typeof an === 'object' && typeof an.content === 'string' && an.content.length > 0) {
          return an.content;
        }
      } catch { /* */ }
      return toStr(vars.getVar('__risu_author_note__'));
    },
    async setAuthorNote(value: unknown): Promise<void> {
      const v = toStr(value);
      // The prompt engine memoizes the note per chat; this write must not be
      // served from that memo.
      invalidateAuthorsNoteCache();
      vars.setVar('__risu_author_note__', v);
      // Lumi prompt-assembly.service.ts reads from authors_note; preserve existing depth/role/position.
      try {
        const prev = (await api.chat.getMetadata('authors_note')) as
          | { depth?: unknown; role?: unknown; position?: unknown }
          | undefined
          | null;
        const depth = typeof prev?.depth === 'number' && Number.isFinite(prev.depth)
          ? Math.max(0, Math.floor(prev.depth as number))
          : 4;
        const rawRole = typeof prev?.role === 'string' ? (prev.role as string) : 'system';
        const role: 'system' | 'user' | 'assistant' =
          rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system';
        const position = typeof prev?.position === 'number' && Number.isFinite(prev.position)
          ? prev.position as number
          : 0;
        await api.chat.setMetadata('authors_note', { content: v, depth, role, position });
      } catch { /* chat-var fallback still has the value */ }
    },
  };
}
