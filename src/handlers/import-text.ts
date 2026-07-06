import type { Handler } from './types.js';
import type { LorebookImporter } from '../state/lorebook-import.js';
import type { RegexImporter } from '../state/regex-import.js';

export interface ImportTextHandlerDeps {
  readonly lorebookImporter: LorebookImporter;
  readonly regexImporter: RegexImporter;
  readonly getUpload: (
    uploadId: string,
    userId: string,
  ) => Promise<{ fileName: string; size: number; data: Uint8Array } | null>;
  readonly deleteUpload: (uploadId: string, userId: string) => Promise<boolean>;
}

export function createImportTextHandlers(deps: ImportTextHandlerDeps): {
  readonly import_text_from_upload: Handler<'import_text_from_upload'>;
} {
  return {
    import_text_from_upload: async (msg, ctx) => {
      const fail = (reason: string): void => {
        ctx.log.warn(`import_text_from_upload: ${reason} uploadId=${msg.uploadId}`);
        if (msg.kind === 'lorebook') {
          ctx.send({ type: 'lorebook_import_result', characterId: msg.characterId, ok: false, written: 0, dropped: 0, reason }, ctx.userId);
        } else {
          const folder = (msg.filename ?? 'regex').replace(/\.[^.]+$/, '').trim() || 'regex';
          ctx.send({ type: 'standalone_regex_install', ok: false, scripts: [], parsed: 0, dropped: 0, folder, characterId: msg.characterId, reason }, ctx.userId);
        }
      };
      let upload: { fileName: string; size: number; data: Uint8Array } | null;
      try {
        upload = await deps.getUpload(msg.uploadId, ctx.userId);
      } catch (err) {
        fail(`upload retrieval failed: ${ctx.errMsg(err)}`);
        return;
      }
      if (!upload) {
        fail('upload not found or expired, re-import the file');
        return;
      }
      try {
        const json = new TextDecoder().decode(upload.data);
        ctx.log.info(`import_text_from_upload: uploadId=${msg.uploadId} kind=${msg.kind} chars=${json.length}`);
        if (msg.kind === 'lorebook') {
          await deps.lorebookImporter.handle(
            { type: 'import_lorebook', characterId: msg.characterId, json, ...(msg.filename ? { filename: msg.filename } : {}) },
            ctx.userId,
          );
        } else {
          await deps.regexImporter.handle(
            { type: 'import_regex', json, characterId: msg.characterId, ...(msg.filename ? { filename: msg.filename } : {}) },
            ctx.userId,
          );
        }
      } finally {
        void deps.deleteUpload(msg.uploadId, ctx.userId).catch(() => {});
      }
    },
  };
}
