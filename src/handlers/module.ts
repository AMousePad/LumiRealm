import type { ModuleEnvelope } from '../state/modules-store.js';
import type { LumirealmCharacterData, LumirealmUserOverrides } from '../payload/types.js';
import type { SpindleCharactersApi } from '../state/lumirealm-character.js';
import type { OrphanDetectDeps } from '../state/orphan-detect.js';
import { buildLiveImageIdSet } from '../state/orphan-detect.js';
import type { Handler } from './types.js';

export type OperationPhase = 'started' | 'progress' | 'done' | 'error';

export interface ModuleHandlerDeps {
  readonly worldBookIdsByCharacter: Map<string, readonly string[]>;
  readonly processModuleUpload: (
    bytes: Uint8Array,
    fileName: string,
    userId: string,
  ) => Promise<{ envelope: ModuleEnvelope }>;
  readonly getUpload: (
    uploadId: string,
    userId: string,
  ) => Promise<{ fileName: string; size: number; data: Uint8Array } | null>;
  readonly deleteUpload: (uploadId: string, userId: string) => Promise<boolean>;
  readonly nudgeGc: (reason: string) => void;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly readModuleImageJournalImageIds: (userId: string, moduleId: string) => Promise<readonly string[]>;
  readonly clearModuleImageJournal: (userId: string, moduleId: string) => Promise<void>;
  readonly deleteModuleFromStore: (userId: string, moduleId: string) => Promise<void>;
  readonly deleteSharedWorldBook: (wbId: string, userId: string) => Promise<void>;
  readonly buildOrphanDetectDeps: (userId: string) => OrphanDetectDeps;
  readonly deleteImageIds: (
    ids: readonly string[],
    userId: string,
    context: string,
    onProgress?: (processed: number, total: number) => void,
  ) => Promise<{ deleted: number; absent: number; failed: number }>;
  readonly detachModuleFromAllCharacters: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly attachModuleToCharacter: (
    characterId: string,
    moduleId: string,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly detachModuleFromCharacter: (
    characterId: string,
    moduleId: string,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly refreshAttachedModule: (characterId: string, env: ModuleEnvelope, userId: string) => Promise<void>;
  readonly pushModules: (userId: string) => Promise<void>;
  readonly setGlobalModules: (moduleIds: readonly string[], userId: string) => Promise<void>;
  readonly recordGlobalModuleArtifacts: (
    moduleId: string,
    artifacts: { regexScriptIds?: readonly string[]; worldBookId?: string | null },
    userId: string,
  ) => Promise<void>;
  readonly pushAttachedForCharacter: (characterId: string, userId: string) => Promise<void>;
  readonly charactersApi: () => SpindleCharactersApi;
  readonly updateLumirealm: (
    api: SpindleCharactersApi,
    characterId: string,
    userId: string,
    mut: (data: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly mergeUserOverrides: (base: LumirealmUserOverrides, patch: Record<string, unknown>) => LumirealmUserOverrides;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string) => void;
  readonly emitOperationProgress: (
    userId: string,
    operationId: string,
    phase: OperationPhase,
    title: string,
    message: string,
    fraction: number | null,
    error?: string,
  ) => void;
  readonly blockedByRepair: (userId: string, messageType: string) => boolean;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export function createModuleHandlers(deps: ModuleHandlerDeps): {
  readonly process_module_from_upload: Handler<'process_module_from_upload'>;
  readonly request_modules: Handler<'request_modules'>;
  readonly set_global_modules: Handler<'set_global_modules'>;
  readonly delete_module: Handler<'delete_module'>;
  readonly attach_module: Handler<'attach_module'>;
  readonly detach_module: Handler<'detach_module'>;
  readonly module_artifacts_installed: Handler<'module_artifacts_installed'>;
  readonly module_artifacts_uninstalled: Handler<'module_artifacts_uninstalled'>;
} {
  async function finalizeModuleUpload(
    bytes: Uint8Array,
    fileName: string,
    ctx: { userId: string; send: (msg: import('../types/messages.js').BackendToFrontend, userId: string) => void },
  ): Promise<void> {
    try {
      const { envelope: env } = await deps.processModuleUpload(bytes, fileName, ctx.userId);
      deps.nudgeGc('module-upload');
      const moduleName = typeof env.module.name === 'string' && env.module.name.length > 0
        ? env.module.name
        : env.id;
      ctx.send({ type: 'import_progress', phase: 'saving_payload', message: `Saved ${moduleName}`, fraction: 0.95 }, ctx.userId);
      const attachedBefore = await deps.charactersAttachedTo(env.id, ctx.userId);
      await deps.pushModules(ctx.userId);
      if (attachedBefore.length > 0) {
        deps.log.info(`finalizeModuleUpload: auto-refreshing ${attachedBefore.length} character(s) attached to module ${env.id}`);
        for (const charId of attachedBefore) {
          await deps.refreshAttachedModule(charId, env, ctx.userId);
        }
      }
      ctx.send({ type: 'import_progress', phase: 'done', message: `Imported ${moduleName}`, fraction: 1 }, ctx.userId);
    } catch (err) {
      ctx.send({ type: 'import_progress', phase: 'error', message: 'Module upload failed', fraction: null, error: deps.errMsg(err) }, ctx.userId);
      ctx.send({ type: 'error', message: `Module decode/save failed: ${deps.errMsg(err)}` }, ctx.userId);
    }
  }

  return {
    process_module_from_upload: async (msg, ctx) => {
      deps.log.info(`process_module_from_upload: uploadId=${msg.uploadId} file=${msg.fileName} userId=${ctx.userId}`);
      let upload: { fileName: string; size: number; data: Uint8Array } | null;
      try {
        upload = await deps.getUpload(msg.uploadId, ctx.userId);
      } catch (err) {
        deps.log.warn(`process_module_from_upload: getUpload threw: ${deps.errMsg(err)}`);
        ctx.send({ type: 'import_progress', phase: 'error', message: 'Upload retrieval failed', fraction: null, error: deps.errMsg(err) }, ctx.userId);
        ctx.send({ type: 'error', message: `Module upload retrieval failed: ${deps.errMsg(err)}` }, ctx.userId);
        return;
      }
      if (!upload) {
        deps.log.warn(`process_module_from_upload: uploadId=${msg.uploadId} not found or expired`);
        ctx.send({ type: 'import_progress', phase: 'error', message: 'Upload not found or expired. Re-import the module.', fraction: null, error: 'upload_missing' }, ctx.userId);
        ctx.send({ type: 'error', message: 'Module upload not found or expired. Re-import the module.' }, ctx.userId);
        return;
      }
      deps.log.info(`process_module_from_upload: got ${upload.data.byteLength} bytes, processing`);
      ctx.send({ type: 'import_progress', phase: 'translating', message: `Translating ${msg.fileName || upload.fileName}…`, fraction: 0.3 }, ctx.userId);
      try {
        await finalizeModuleUpload(upload.data, msg.fileName || upload.fileName, ctx);
      } finally {
        void deps.deleteUpload(msg.uploadId, ctx.userId).catch(() => {});
      }
    },
    request_modules: async (_msg, ctx) => {
      await deps.pushModules(ctx.userId);
    },
    set_global_modules: async (msg, ctx) => {
      await deps.setGlobalModules(msg.moduleIds, ctx.userId);
      await deps.pushModules(ctx.userId);
    },
    delete_module: async (msg, ctx) => {
      const envelopeForDelete = await deps.readModuleEnvelope(ctx.userId, msg.moduleId);
      const moduleName = envelopeForDelete?.module?.name || msg.moduleId.slice(0, 8);
      const opId = `delete-module-${msg.moduleId}-${Date.now()}`;
      const opTitle = `Deleting module "${moduleName}"`;
      deps.emitOperationProgress(ctx.userId, opId, 'started', opTitle, 'Detaching from characters…', null);
      try {
        const sharedWbId = envelopeForDelete?.installed_world_book_id ?? null;
        // Capture the journal's image-id list now, before the envelope is
        // gone. Re-uploads append to the journal, the journal is the
        // superset of every ID we ever uploaded for this module.
        const journalImageIds = await deps.readModuleImageJournalImageIds(ctx.userId, msg.moduleId);

        const touched = await deps.detachModuleFromAllCharacters(msg.moduleId, ctx.userId);
        if (sharedWbId) {
          deps.emitOperationProgress(
            ctx.userId, opId, 'progress', opTitle,
            `Removing shared world book…`,
            0.3,
          );
          try {
            await deps.deleteSharedWorldBook(sharedWbId, ctx.userId);
            deps.log.info(`delete_module: deleted shared world_book wb=${sharedWbId} module=${msg.moduleId}`);
          } catch (err) {
            deps.log.warn(`delete_module: shared world_book delete failed wb=${sharedWbId}: ${deps.errMsg(err)}`);
          }
        }

        deps.emitOperationProgress(ctx.userId, opId, 'progress', opTitle, 'Removing module envelope…', 0.45);
        await deps.deleteModuleFromStore(ctx.userId, msg.moduleId);

        let imageDeleteStats = { deleted: 0, absent: 0, failed: 0, skipped: 0 };
        if (journalImageIds.length > 0) {
          deps.emitOperationProgress(
            ctx.userId, opId, 'progress', opTitle,
            `Checking ${journalImageIds.length} asset${journalImageIds.length === 1 ? '' : 's'} against live references…`,
            0.55,
          );
          const live = await buildLiveImageIdSet(deps.buildOrphanDetectDeps(ctx.userId));
          const safeIds: string[] = [];
          let skipped = 0;
          for (const id of journalImageIds) {
            if (typeof id !== 'string' || id.length === 0) continue;
            if (live.liveIds.has(id)) {
              skipped++;
              continue;
            }
            safeIds.push(id);
          }
          if (skipped > 0) {
            deps.log.info(
              `delete_module: ${skipped}/${journalImageIds.length} asset(s) shielded by other live refs, ` +
                `deleting only ${safeIds.length} module-owned asset(s)`,
            );
          }
          if (safeIds.length > 0) {
            deps.emitOperationProgress(
              ctx.userId, opId, 'progress', opTitle,
              `Deleting 0 of ${safeIds.length} asset${safeIds.length === 1 ? '' : 's'}…`,
              0.6,
            );
            const stats = await deps.deleteImageIds(
              safeIds, ctx.userId, `delete_module(${msg.moduleId})`,
              (processed, total) => {
                const frac = total > 0 ? 0.6 + (processed / total) * 0.35 : 0.6;
                deps.emitOperationProgress(
                  ctx.userId, opId, 'progress', opTitle,
                  `Deleting ${processed} of ${total} asset${total === 1 ? '' : 's'}…`,
                  frac,
                );
              },
            );
            imageDeleteStats = { ...stats, skipped };
          } else {
            imageDeleteStats = { deleted: 0, absent: 0, failed: 0, skipped };
          }
        }

        await deps.clearModuleImageJournal(ctx.userId, msg.moduleId).catch((err) => {
          deps.log.warn(`delete_module: clearModuleImageJournal threw module=${msg.moduleId}: ${deps.errMsg(err)}`);
        });

        deps.log.info(
          `delete_module: id=${msg.moduleId} detachedFromChars=${touched.length} ` +
            `imageDelete=deleted:${imageDeleteStats.deleted} ` +
            `absent:${imageDeleteStats.absent} failed:${imageDeleteStats.failed} ` +
            `skipped:${imageDeleteStats.skipped}`,
        );
        await deps.pushModules(ctx.userId);
        for (const charId of touched) {
          await deps.pushAttachedForCharacter(charId, ctx.userId);
        }
        const detachLine = `Detached from ${touched.length} character${touched.length === 1 ? '' : 's'}`;
        const assetLine = journalImageIds.length === 0
          ? ''
          : imageDeleteStats.skipped > 0
            ? `, ${imageDeleteStats.deleted} asset${imageDeleteStats.deleted === 1 ? '' : 's'} deleted (${imageDeleteStats.skipped} kept, still referenced)`
            : `, ${imageDeleteStats.deleted} asset${imageDeleteStats.deleted === 1 ? '' : 's'} deleted`;
        deps.emitOperationProgress(ctx.userId, opId, 'done', opTitle, `${detachLine}${assetLine}`, 1);
      } catch (err) {
        deps.log.warn(`delete_module: threw module=${msg.moduleId}: ${deps.errMsg(err)}`);
        deps.emitOperationProgress(ctx.userId, opId, 'error', opTitle, '', null, deps.errMsg(err));
        ctx.send({ type: 'error', message: `Module delete failed: ${deps.errMsg(err)}` }, ctx.userId);
      }
    },
    attach_module: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, 'attach_module')) return;
      const result = await deps.attachModuleToCharacter(msg.characterId, msg.moduleId, ctx.userId);
      if (!result.ok) {
        ctx.send({ type: 'error', message: `attach_module: ${result.reason ?? 'failed'}` }, ctx.userId);
        return;
      }
      await deps.pushAttachedForCharacter(msg.characterId, ctx.userId);
      await deps.pushModules(ctx.userId);
    },
    detach_module: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, 'detach_module')) return;
      const result = await deps.detachModuleFromCharacter(msg.characterId, msg.moduleId, ctx.userId);
      if (!result.ok) {
        ctx.send({ type: 'error', message: `detach_module: ${result.reason ?? 'failed'}` }, ctx.userId);
        return;
      }
      await deps.pushAttachedForCharacter(msg.characterId, ctx.userId);
      await deps.pushModules(ctx.userId);
    },
    module_artifacts_installed: async (msg, ctx) => {
      // Global installs have no character to stash against; their ids go in the
      // module index so teardown can delete exactly what was created.
      if (msg.characterId === null) {
        await deps.recordGlobalModuleArtifacts(
          msg.moduleId,
          { regexScriptIds: msg.regexScriptIds },
          ctx.userId,
        );
        deps.log.info(
          `module_artifacts_installed: global module=${msg.moduleId} regex=${msg.regexScriptIds.length}`,
        );
        return;
      }
      // FE finished its cookie-auth POSTs. Stash resulting resource ids on
      // the character's user_overrides for clean detach later.
      await deps.updateLumirealm(deps.charactersApi(), msg.characterId, ctx.userId, (cur) => {
        const wb = { ...(cur.user_overrides.attached_module_world_books ?? {}) };
        if (msg.worldBookId) wb[msg.moduleId] = msg.worldBookId;
        const rx = { ...(cur.user_overrides.attached_module_regex_script_ids ?? {}) };
        if (msg.regexScriptIds.length > 0) rx[msg.moduleId] = msg.regexScriptIds;
        else delete rx[msg.moduleId];
        return {
          ...cur,
          user_overrides: deps.mergeUserOverrides(cur.user_overrides, {
            attached_module_world_books: Object.keys(wb).length > 0 ? wb : null,
            attached_module_regex_script_ids: Object.keys(rx).length > 0 ? rx : null,
          }),
        };
      });
      if (msg.worldBookId) {
        const existing = deps.worldBookIdsByCharacter.get(msg.characterId) ?? [];
        if (!existing.includes(msg.worldBookId)) {
          deps.worldBookIdsByCharacter.set(msg.characterId, [...existing, msg.worldBookId]);
        }
      }
      deps.invalidateActiveForCharacter(msg.characterId, ctx.userId);
      deps.log.info(
        `module_artifacts_installed: char=${msg.characterId} module=${msg.moduleId} ` +
          `worldBookId=${msg.worldBookId ?? 'null'} regex=${msg.regexScriptIds.length}`,
      );
    },
    module_artifacts_uninstalled: async (msg, _ctx) => {
      deps.log.info(
        `module_artifacts_uninstalled: char=${msg.characterId} module=${msg.moduleId} ok=${msg.ok}`,
      );
    },
  };
}
