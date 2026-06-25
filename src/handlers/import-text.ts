import type { Handler } from './types.js';
import type { LorebookImporter } from '../state/lorebook-import.js';
import type { RegexImporter } from '../state/regex-import.js';

interface TextImportSession {
  readonly kind: 'lorebook' | 'regex';
  readonly filename: string | undefined;
  readonly characterId: string | null;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly parts: (string | null)[];
  received: number;
  ownerUserId: string;
  startedAt: number;
}

const SESSION_TTL_MS = 120_000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS = 4096;

export interface ImportTextHandlerDeps {
  readonly lorebookImporter: LorebookImporter;
  readonly regexImporter: RegexImporter;
}

export function createImportTextHandlers(deps: ImportTextHandlerDeps): {
  readonly import_text_init: Handler<'import_text_init'>;
  readonly import_text_chunk: Handler<'import_text_chunk'>;
  readonly import_text_commit: Handler<'import_text_commit'>;
} {
  const sessions = new Map<string, TextImportSession>();

  function pruneStale(now: number): void {
    for (const [id, s] of sessions) {
      if (now - s.startedAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }

  return {
    import_text_init: async (msg, ctx) => {
      pruneStale(Date.now());
      if (msg.totalChunks <= 0 || msg.totalChunks > MAX_CHUNKS || msg.totalBytes > MAX_TOTAL_BYTES) {
        ctx.log.warn(`import_text_init: rejected uploadId=${msg.uploadId} chunks=${msg.totalChunks} bytes=${msg.totalBytes}`);
        ctx.send({ type: 'error', message: `import_text_init: upload too large or malformed` }, ctx.userId);
        return;
      }
      sessions.set(msg.uploadId, {
        kind: msg.kind,
        filename: msg.filename,
        characterId: msg.characterId,
        totalChunks: msg.totalChunks,
        totalBytes: msg.totalBytes,
        parts: new Array(msg.totalChunks).fill(null),
        received: 0,
        ownerUserId: ctx.userId,
        startedAt: Date.now(),
      });
      ctx.log.info(`import_text_init: uploadId=${msg.uploadId} kind=${msg.kind} chunks=${msg.totalChunks} bytes=${msg.totalBytes}`);
    },

    import_text_chunk: async (msg, ctx) => {
      const s = sessions.get(msg.uploadId);
      if (!s || s.ownerUserId !== ctx.userId) {
        ctx.log.warn(`import_text_chunk: unknown/foreign uploadId=${msg.uploadId} seq=${msg.seq}`);
        return;
      }
      if (msg.seq < 0 || msg.seq >= s.totalChunks) {
        ctx.log.warn(`import_text_chunk: seq=${msg.seq} out of range (total=${s.totalChunks})`);
        return;
      }
      if (s.parts[msg.seq] === null) s.received += 1;
      s.parts[msg.seq] = msg.data;
    },

    import_text_commit: async (msg, ctx) => {
      const s = sessions.get(msg.uploadId);
      if (!s || s.ownerUserId !== ctx.userId) {
        ctx.log.warn(`import_text_commit: unknown/foreign uploadId=${msg.uploadId}`);
        return;
      }
      sessions.delete(msg.uploadId);
      if (s.received !== s.totalChunks) {
        const reason = `upload incomplete: ${s.received}/${s.totalChunks} chunks received`;
        ctx.log.error(`import_text_commit: ${reason} uploadId=${msg.uploadId}`);
        if (s.kind === 'lorebook') {
          ctx.send({ type: 'lorebook_import_result', characterId: s.characterId, ok: false, written: 0, dropped: 0, reason }, ctx.userId);
        } else {
          const folder = (s.filename ?? 'regex').replace(/\.[^.]+$/, '').trim() || 'regex';
          ctx.send({ type: 'standalone_regex_install', ok: false, scripts: [], parsed: 0, dropped: 0, folder, characterId: s.characterId, reason }, ctx.userId);
        }
        return;
      }
      const json = s.parts.join('');
      ctx.log.info(`import_text_commit: uploadId=${msg.uploadId} kind=${s.kind} assembled=${json.length} chars`);
      if (s.kind === 'lorebook') {
        await deps.lorebookImporter.handle(
          { type: 'import_lorebook', characterId: s.characterId, json, ...(s.filename ? { filename: s.filename } : {}) },
          ctx.userId,
        );
      } else {
        await deps.regexImporter.handle(
          { type: 'import_regex', json, characterId: s.characterId, ...(s.filename ? { filename: s.filename } : {}) },
          ctx.userId,
        );
      }
    },
  };
}
