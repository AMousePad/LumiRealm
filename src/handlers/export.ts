import { buildModuleArchivePlan } from '../core/export/module-archive.js';
import {
  buildCharacterArchivePlan,
  type CharacterEnvelopeLike,
  type LiveCharacterFields,
} from '../core/export/character-archive.js';
import type { LiveLoreEntry } from '../core/export/lore-back-projection.js';
import type { LiveRegexRow } from '../core/export/regex-back-projection.js';
import type { AssetIndexEntry, LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from '../state/modules-store.js';
import type { Handler } from './types.js';

export interface ExportCharacterFetch {
  readonly character: LiveCharacterFields & { readonly image_id?: string | null };
  readonly data: LumirealmCharacterData;
  readonly worldBookIds: readonly string[];
}

export interface ExportHandlerDeps {
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly readCharacterForExport: (
    characterId: string,
    userId: string,
  ) => Promise<ExportCharacterFetch | null>;
  /** Character-scoped rows including disabled ones: a disable is a user edit.
   *  Module-owned rows are excluded, they travel with the module's own export. */
  readonly listCharacterRegexRows: (
    characterId: string,
    userId: string,
  ) => Promise<readonly LiveRegexRow[]>;
  readonly listWorldBookEntries: (
    wbId: string,
    userId: string,
  ) => Promise<readonly LiveLoreEntry[]>;
  readonly extensionVersion: string;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

function firstImageId(entry: AssetIndexEntry | undefined): { imageId: string; ext?: string } | null {
  const id = entry?.imageIds?.[0];
  if (typeof id !== 'string' || id.length === 0) return null;
  return entry?.ext !== undefined ? { imageId: id, ext: entry.ext } : { imageId: id };
}

export function createExportHandlers(deps: ExportHandlerDeps): {
  readonly export_module: Handler<'export_module'>;
  readonly export_character: Handler<'export_character'>;
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

    export_character: async (msg, ctx) => {
      try {
        const fetched = await deps.readCharacterForExport(msg.characterId, ctx.userId);
        if (!fetched) {
          ctx.send({
            type: 'error',
            message: `Export: character ${msg.characterId} is not a lumirealm card.`,
          }, ctx.userId);
          return;
        }
        const { character, data, worldBookIds } = fetched;

        // Module-attached books travel with their module, not with the card.
        const moduleWbIds = new Set(
          Object.values(data.user_overrides.attached_module_world_books ?? {})
            .filter((v): v is string => typeof v === 'string'),
        );
        const ownBookIds = worldBookIds.filter((id) => !moduleWbIds.has(id));

        const worldBookEntries: LiveLoreEntry[] = [];
        for (const wbId of ownBookIds) {
          try {
            worldBookEntries.push(...await deps.listWorldBookEntries(wbId, ctx.userId));
          } catch (err) {
            deps.log.warn(`export_character: world_book ${wbId} read failed: ${deps.errMsg(err)}`);
          }
        }
        const liveRegex = await deps.listCharacterRegexRows(msg.characterId, ctx.userId);

        const plan = buildCharacterArchivePlan({
          characterId: msg.characterId,
          data: data as unknown as CharacterEnvelopeLike,
          character,
          worldBookEntries,
          liveRegex,
          resolveAsset: (name) => firstImageId(data.asset_index[name]),
          resolveEmotion: (name) => firstImageId(data.emotion_index[name]),
          avatarImageId: character.image_id ?? null,
          extensionVersion: deps.extensionVersion,
        });

        if (plan.missingAssets.length > 0) {
          deps.log.warn(
            `export_character: ${plan.missingAssets.length} unresolved asset(s) on ` +
              `character=${msg.characterId}: ${plan.missingAssets.slice(0, 5).join(', ')}`,
          );
        }
        deps.log.info(
          `export_character: character=${msg.characterId} entries=${plan.entries.length} ` +
            `lore=${worldBookEntries.length} regex=${liveRegex.length} ` +
            `missing=${plan.missingAssets.length} file=${plan.fileName}`,
        );
        ctx.send({ type: 'export_archive', plan }, ctx.userId);
      } catch (err) {
        ctx.send({ type: 'error', message: `Export failed: ${deps.errMsg(err)}` }, ctx.userId);
      }
    },
  };
}
