import { translateFromStoredSource } from '../core/pipeline/translate.js';
import type { SvgRasterTask } from '../core/svg-rasterize.js';
import { CURRENT_CHARACTER_SCHEMA_VERSION } from '../migrations/character.js';
import {
  buildLumirealmData,
  preValidateRequires,
  RisuCompatVersionError,
} from '../payload/codec.js';
import { buildAssetIndexes } from '../payload/import.js';
import { projectCharacterRegexScripts } from '../payload/character-regex-projection.js';
import type { LumirealmCharacterData, StoredRegexScript } from '../payload/types.js';

export type CharacterRetranslateResult =
  | { readonly kind: 'retranslated'; readonly data: LumirealmCharacterData }
  | { readonly kind: 'needs_reimport' }
  | { readonly kind: 'failed'; readonly error: string };

export interface CharacterRetranslateDeps {
  readonly extensionVersion: string;
  readonly getAvatarImageId: (characterId: string, userId: string) => Promise<string | null>;
  readonly installCharacterRegexScripts: (
    characterId: string,
    characterName: string,
    scripts: readonly StoredRegexScript[],
    userId: string,
  ) => Promise<void>;
  readonly writeEnvelope: (
    characterId: string,
    data: LumirealmCharacterData,
    userId: string,
  ) => Promise<void>;
  readonly dispatchSvgRasterize: (
    characterId: string,
    characterName: string,
    tasks: readonly SvgRasterTask[],
    userId: string,
  ) => void;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string) => void;
  readonly log: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
  };
}

/**
 * Runs an existing character's captured source through today's translator and
 * applies today's projection directly. Historical migrations are deliberately
 * not involved.
 */
export async function retranslateCharacterFromCurrentSource(
  args: {
    readonly characterId: string;
    readonly characterName: string;
    readonly userId: string;
    readonly envelope: LumirealmCharacterData;
  },
  deps: CharacterRetranslateDeps,
): Promise<CharacterRetranslateResult> {
  const source = args.envelope.source;
  if (!source) return { kind: 'needs_reimport' };

  const t0 = Date.now();
  try {
    const backgroundHtmlOverride =
      typeof args.envelope.payload.background_html_source === 'string'
        ? args.envelope.payload.background_html_source
        : undefined;
    // Translation normalizes some source shapes in place (notably inline data
    // URI assets), so never hand it the persisted envelope's object graph.
    const translationSource = structuredClone({
      card: source.card,
      module: source.module,
    });
    const bundle = translateFromStoredSource(
      translationSource,
      {
        sourceId: `repair:${args.characterId}`,
        mode: 'full',
        emitPackScripts: false,
        ...(backgroundHtmlOverride !== undefined ? { backgroundHtmlOverride } : {}),
      },
    );
    if (!bundle.risuPayload) throw new Error('translator returned no risuPayload');

    const compatibility = preValidateRequires(bundle.risuPayload.requires);
    if (!compatibility.ok) {
      throw new RisuCompatVersionError(compatibility.missing, deps.extensionVersion);
    }
    if (compatibility.degraded.length > 0) {
      deps.log.warn(
        `retranslate(${args.characterId}): degraded=[${compatibility.degraded.join(', ')}]`,
      );
    }

    let avatarImageId: string | null = null;
    try {
      avatarImageId = await deps.getAvatarImageId(args.characterId, args.userId);
    } catch (error) {
      deps.log.warn(
        `retranslate(${args.characterId}): avatar lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const indexes = buildAssetIndexes(
      {
        additional_assets: bundle.risuPayload.additional_assets,
        emotion_images: bundle.risuPayload.emotion_images,
      },
      source.path_to_image_id,
      avatarImageId,
    );
    const regexScripts = projectCharacterRegexScripts(
      bundle.regexScripts,
      args.characterId,
      bundle.character.name,
    );
    const payload = backgroundHtmlOverride !== undefined
      ? { ...bundle.risuPayload, background_html_source: backgroundHtmlOverride }
      : bundle.risuPayload;
    const rebuilt = buildLumirealmData(
      payload,
      deps.extensionVersion,
      regexScripts,
      indexes.assetIndex,
      indexes.emotionIndex,
      args.envelope.imported_at,
      args.envelope.user_overrides,
      source,
      CURRENT_CHARACTER_SCHEMA_VERSION,
    );
    const next: LumirealmCharacterData = {
      ...args.envelope,
      ...rebuilt,
    };

    // The envelope is stamped current only after the complete owned regex
    // replacement has been acknowledged and its stale cleanup verified.
    await deps.installCharacterRegexScripts(
      args.characterId,
      args.characterName,
      regexScripts,
      args.userId,
    );
    await deps.writeEnvelope(args.characterId, next, args.userId);

    const rasterTasks = bundle.pendingSvgRasters.filter(
      (task) => task.classification !== 'templated',
    );
    if (rasterTasks.length > 0) {
      deps.dispatchSvgRasterize(
        args.characterId,
        args.characterName,
        rasterTasks,
        args.userId,
      );
    }
    deps.invalidateActiveForCharacter(args.characterId, args.userId);
    deps.log.info(
      `retranslate(${args.characterId}): current pipeline -> v${CURRENT_CHARACTER_SCHEMA_VERSION} ` +
        `regex=${regexScripts.length} elapsed=${Date.now() - t0}ms`,
    );
    return { kind: 'retranslated', data: next };
  } catch (error) {
    return {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
