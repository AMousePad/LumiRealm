import { buildModuleArchivePlan } from '../core/export/module-archive.js';
import type { ModuleEnvelope } from '../state/modules-store.js';
import type { Handler } from './types.js';

export interface ExportHandlerDeps {
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly extensionVersion: string;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export function createExportHandlers(deps: ExportHandlerDeps): {
  readonly export_module: Handler<'export_module'>;
} {
  return {
    export_module: async (msg, ctx) => {
      try {
        const env = await deps.readModuleEnvelope(ctx.userId, msg.moduleId);
        if (!env) {
          ctx.send({
            type: 'error',
            message: `Export: module ${msg.moduleId} not found in library.`,
          }, ctx.userId);
          return;
        }

        const icon = typeof env.module.icon === 'string' && env.module.icon.length > 0
          ? env.module.icon
          : null;
        const plan = buildModuleArchivePlan({
          module: env.module,
          moduleId: env.id,
          filename: env.filename,
          extensionVersion: deps.extensionVersion,
          resolveAsset: (name) => {
            const ref = env.asset_index[name];
            if (!ref || typeof ref.imageId !== 'string' || ref.imageId.length === 0) return null;
            return ref.ext !== undefined
              ? { imageId: ref.imageId, ext: ref.ext }
              : { imageId: ref.imageId };
          },
          iconImageId: icon,
          ...(env.translator_schema_version !== undefined
            ? { translatorSchemaVersion: env.translator_schema_version }
            : {}),
          ...(env.translations !== undefined ? { translations: env.translations } : {}),
        });

        if (plan.missingAssets.length > 0) {
          deps.log.warn(
            `export_module: ${plan.missingAssets.length} unresolved asset(s) on module=${env.id}: ` +
              plan.missingAssets.slice(0, 5).join(', '),
          );
        }
        deps.log.info(
          `export_module: module=${env.id} entries=${plan.entries.length} ` +
            `missing=${plan.missingAssets.length} file=${plan.fileName}`,
        );
        ctx.send({ type: 'export_archive', plan }, ctx.userId);
      } catch (err) {
        ctx.send({ type: 'error', message: `Export failed: ${deps.errMsg(err)}` }, ctx.userId);
      }
    },
  };
}
