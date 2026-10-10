import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import type { SpindleCharactersApi } from '../state/lumirealm-character.js';
import type { ViewerPushDeps } from '../state/viewer-push.js';
import type { ViewerAssembly } from '../state/viewer-assembly.js';
import type { ModuleEnvelope } from '../state/modules-store.js';
import { pushViewerData } from '../state/viewer-push.js';
import {
  extractCardSideBackgroundHtml,
  prepareBackgroundHtmlForRuntime,
} from '../core/mappers/background-html.js';
import type { Handler } from './types.js';

type SetTriggerLuaMsg = Extract<FrontendToBackend, { type: 'set_trigger_lua' }>;
type ViewerSourceRef = Extract<FrontendToBackend, { type: 'request_viewer_data' }>['source'];

export interface ViewerHandlerDeps {
  readonly blockedByRepair: (userId: string, messageType: string) => boolean;
  readonly charactersApi: () => SpindleCharactersApi;
  readonly updateLumirealm: (
    api: SpindleCharactersApi,
    characterId: string,
    userId: string,
    mut: (data: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly mutateTriggerLua: (msg: SetTriggerLuaMsg, userId: string) => Promise<{ ok: boolean; reason?: string }>;
  readonly getWorldBookEntry: (
    entryId: string,
    userId: string,
  ) => Promise<{ readonly world_book_id: string } | null>;
  readonly updateWorldBookEntry: (
    entryId: string,
    input: { readonly disabled: boolean },
    userId: string,
  ) => Promise<unknown>;
  readonly viewerAssembly: ViewerAssembly;
  readonly viewerPushDeps: ViewerPushDeps;
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string) => void;
  readonly readModuleEnvelope: (userId: string, moduleId: string) => Promise<ModuleEnvelope | null>;
  readonly writeModuleEnvelope: (userId: string, env: ModuleEnvelope) => Promise<void>;
  readonly send: (msg: BackendToFrontend, userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export function createViewerHandlers(deps: ViewerHandlerDeps): {
  readonly request_viewer_data: Handler<'request_viewer_data'>;
  readonly set_default_variables_text: Handler<'set_default_variables_text'>;
  readonly set_background_html: Handler<'set_background_html'>;
  readonly set_module_background_embedding: Handler<'set_module_background_embedding'>;
  readonly set_trigger_lua: Handler<'set_trigger_lua'>;
  readonly set_viewer_lorebook_entry_disabled: Handler<'set_viewer_lorebook_entry_disabled'>;
} {
  async function assembleViewerSource(source: ViewerSourceRef, userId: string) {
    return source.kind === 'character'
      ? deps.viewerAssembly.assembleCharacter(source.characterId, userId)
      : deps.viewerAssembly.assembleModule(source.moduleId, userId);
  }

  return {
    request_viewer_data: async (msg, ctx) => {
      try {
        const data = await assembleViewerSource(msg.source, ctx.userId);
        if (data) ctx.send({ type: 'viewer_data_pushed', data }, ctx.userId);
        else ctx.send({
          type: 'error',
          message: msg.source.kind === 'character'
            ? `Viewer: character ${msg.source.characterId} is not a lumirealm card.`
            : `Viewer: module ${msg.source.moduleId} not found in library.`,
        }, ctx.userId);
      } catch (err) {
        ctx.send({ type: 'error', message: `Viewer assembly failed: ${deps.errMsg(err)}` }, ctx.userId);
      }
    },
    set_default_variables_text: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, msg.type)) return;
      const nextText = typeof msg.text === 'string' ? msg.text : null;
      const updated = await deps.updateLumirealm(deps.charactersApi(), msg.characterId, ctx.userId, (cur) => {
        const {
          default_variables_text: _t,
          default_variables_overrides: _o,
          ...rest
        } = cur.user_overrides;
        void _t; void _o;
        const nextUO = {
          ...rest,
          ...(nextText !== null ? { default_variables_text: nextText } : {}),
        };
        return { ...cur, user_overrides: nextUO };
      });
      if (!updated) {
        ctx.send({ type: 'error', message: `${msg.type}: not a lumirealm character` }, ctx.userId);
        return;
      }
      await pushViewerData(
        { source: { kind: 'character', characterId: msg.characterId }, context: msg.type, userId: ctx.userId },
        deps.viewerPushDeps,
      );
      deps.invalidateActiveForCharacter(msg.characterId, ctx.userId);
      deps.log.info(`${msg.type}: char=${msg.characterId} ${nextText === null ? 'cleared' : `len=${nextText.length}`}`);
    },
    set_background_html: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, msg.type)) return;
      const characterId = msg.characterId;
      const raw = typeof msg.html === 'string' && msg.html.length > 0 ? msg.html : null;

      let characterName = characterId;
      let prepared: ReturnType<typeof prepareBackgroundHtmlForRuntime> | null = null;

      const updated = await deps.updateLumirealm(deps.charactersApi(), characterId, ctx.userId, (cur) => {
        if (raw === null) {
          const cardSide = extractCardSideBackgroundHtml(cur);
          if (cardSide !== null) {
            prepared = prepareBackgroundHtmlForRuntime(cardSide, {
              regexReplaceStrings: cur.regex_scripts.map((r) => r.replace_string ?? ''),
            });
          }
          const { background_html_source: _omit, ...restPayload } = {
            ...cur.payload,
            background_html: cardSide === null ? cur.payload.background_html : (prepared!.translated),
          };
          void _omit;
          return { ...cur, payload: restPayload };
        }
        prepared = prepareBackgroundHtmlForRuntime(raw, {
          regexReplaceStrings: cur.regex_scripts.map((r) => r.replace_string ?? ''),
        });
        return {
          ...cur,
          payload: {
            ...cur.payload,
            background_html: prepared.translated,
            background_html_source: raw,
          },
        };
      });
      if (!updated) {
        ctx.send({ type: 'error', message: 'set_background_html: character is not a lumirealm card' }, ctx.userId);
        return;
      }
      const charName = (updated as { character?: { name?: unknown } }).character?.name;
      if (typeof charName === 'string' && charName.length > 0) characterName = charName;
      deps.invalidateActiveForCharacter(characterId, ctx.userId);
      await pushViewerData(
        { source: { kind: 'character', characterId }, context: 'set_background_html', userId: ctx.userId },
        deps.viewerPushDeps,
      );

      if (prepared !== null) {
        const p = prepared as ReturnType<typeof prepareBackgroundHtmlForRuntime>;
        const rasterable = p.pendingSvgs.filter((t) => t.classification !== 'templated');
        if (rasterable.length > 0) {
          deps.log.info(
            `set_background_html: dispatching ${rasterable.length} SVG raster task(s) for char=${characterId} ` +
              `(templated_skipped=${p.svgTemplatedSkipped} dangerous_skipped=${p.svgDangerousSkipped})`,
          );
          deps.send({
            type: 'rasterize_svgs',
            characterId,
            characterName,
            svgs: rasterable.map((t) => ({
              markerN: t.markerN,
              svg: t.svg,
              classification: t.classification as 'simple' | 'theme-reactive' | 'animated',
              width: t.width,
              height: t.height,
            })),
          }, ctx.userId);
        }
        deps.log.info(
          `set_background_html: char=${characterId} raw_len=${raw?.length ?? 0} ` +
            `translated_len=${p.translated?.length ?? 0} svgs_pending=${rasterable.length}`,
        );
      } else {
        deps.log.info(`set_background_html: char=${characterId} cleared`);
      }
    },
    set_module_background_embedding: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, msg.type)) return;
      const moduleId = msg.moduleId;
      const raw = typeof msg.html === 'string' ? msg.html : '';
      const env = await deps.readModuleEnvelope(ctx.userId, moduleId);
      if (!env) {
        ctx.send({ type: 'error', message: 'set_module_background_embedding: module not found' }, ctx.userId);
        return;
      }
      const nextModule = { ...env.module, backgroundEmbedding: raw };
      await deps.writeModuleEnvelope(ctx.userId, { ...env, module: nextModule });
      const attached = await deps.charactersAttachedTo(moduleId, ctx.userId);
      for (const charId of attached) {
        deps.invalidateActiveForCharacter(charId, ctx.userId);
      }
      await pushViewerData(
        { source: { kind: 'module', moduleId }, context: 'set_module_background_embedding', userId: ctx.userId },
        deps.viewerPushDeps,
      );
      deps.log.info(
        `set_module_background_embedding: module=${moduleId} raw_len=${raw.length} attached=${attached.length}`,
      );
    },
    set_trigger_lua: async (msg, ctx) => {
      if (deps.blockedByRepair(ctx.userId, 'set_trigger_lua')) return;
      const result = await deps.mutateTriggerLua(msg, ctx.userId);
      if (!result.ok) {
        ctx.send({ type: 'error', message: `set_trigger_lua: ${result.reason ?? 'failed'}` }, ctx.userId);
        return;
      }
      await pushViewerData({ source: msg.source, context: 'set_trigger_lua', userId: ctx.userId }, deps.viewerPushDeps);
      if (msg.source.kind === 'module') {
        const attached = await deps.charactersAttachedTo(msg.source.moduleId, ctx.userId);
        for (const charId of attached) deps.invalidateActiveForCharacter(charId, ctx.userId);
      } else {
        deps.invalidateActiveForCharacter(msg.source.characterId, ctx.userId);
      }
    },
    set_viewer_lorebook_entry_disabled: async (msg, ctx) => {
      const sendResult = (ok: boolean, error?: string): void => {
        ctx.send({
          type: 'viewer_lorebook_entry_disabled_result',
          source: msg.source,
          worldBookId: msg.worldBookId,
          entryId: msg.entryId,
          disabled: msg.disabled,
          ok,
          ...(error ? { error } : {}),
        }, ctx.userId);
      };
      if (deps.blockedByRepair(ctx.userId, msg.type)) {
        sendResult(false, 'A repair is in progress. Try again once it finishes.');
        return;
      }
      try {
        // Fail closed against stale or forged viewer rows: the book and entry
        // must still belong to the source currently represented by the request.
        const data = await assembleViewerSource(msg.source, ctx.userId);
        const group = data?.lorebook.find((candidate) => candidate.groupId === msg.worldBookId);
        if (!group?.entries.some((entry) => entry.id === msg.entryId)) {
          sendResult(false, 'This lorebook entry is no longer part of the selected source. Refresh and try again.');
          return;
        }
        const live = await deps.getWorldBookEntry(msg.entryId, ctx.userId);
        if (!live || live.world_book_id !== msg.worldBookId) {
          sendResult(false, 'This lorebook entry no longer exists in that Lumiverse lorebook.');
          return;
        }
        await deps.updateWorldBookEntry(msg.entryId, { disabled: msg.disabled }, ctx.userId);
        sendResult(true);
        deps.log.info(
          `${msg.type}: book=${msg.worldBookId} entry=${msg.entryId} disabled=${msg.disabled}`,
        );
      } catch (err) {
        const error = deps.errMsg(err);
        deps.log.warn(`${msg.type}: entry=${msg.entryId} failed: ${error}`);
        sendResult(false, error);
      }
    },
  };
}
