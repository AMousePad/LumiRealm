declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { LumirealmCharacterData } from '../payload/types.js';
import type { ActiveCard } from '../interpreter/dispatch.js';
import type { BackendToFrontend } from '../types/messages.js';
import { ensureRegexOwnership } from '../state/regex-ownership.js';

export interface ApplySvgRasterIndexDeps {
  readonly updateLumirealm: (
    characterId: string,
    userId: string,
    fn: (cur: LumirealmCharacterData) => LumirealmCharacterData,
  ) => Promise<LumirealmCharacterData | null>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly appendImageIdsToJournal: (
    userId: string,
    characterId: string,
    ids: readonly string[],
  ) => Promise<void>;
  readonly activeCardByChat: Map<string, ActiveCard>;
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly invalidateRenderMcpForChat: (chatId: string) => void;
  readonly invalidateMacroInterceptorForChat: (chatId: string) => void;
  readonly onActiveChatEvicted?: (chatId: string) => void;
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string | undefined) => Promise<void>;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export function createApplySvgRasterIndex(
  deps: ApplySvgRasterIndexDeps,
): (args: {
  characterId: string;
  imageIdByMarker: Readonly<Record<string, string | null>>;
  userId: string;
}) => Promise<void> {
  const {
    updateLumirealm,
    send,
    appendImageIdsToJournal,
    activeCardByChat,
    ensureActiveCardForChat,
    invalidateRenderMcpForChat,
    invalidateMacroInterceptorForChat,
    onActiveChatEvicted,
    refreshBgHtml,
    log,
    errMsg,
  } = deps;

  return async function applySvgRasterIndex(args): Promise<void> {
    const { characterId, imageIdByMarker, userId } = args;

    // Wire format keys are strings, marker-substitution helper expects numeric.
    const markerToImageId: Record<number, string | null> = {};
    for (const [k, v] of Object.entries(imageIdByMarker)) {
      const n = Number.parseInt(k, 10);
      if (Number.isFinite(n)) markerToImageId[n] = v;
    }

    const { substituteSvgMarkers } = await import('../core/svg-rasterize.js');
    let regexScriptsAfterSubstitution: readonly unknown[] = [];
    const updated = await updateLumirealm(characterId, userId, (cur) => {
      const newRegex = cur.regex_scripts.map((r) => {
        const before = (r as { replace_string?: string }).replace_string ?? '';
        if (!before) return r;
        const after = substituteSvgMarkers(before, markerToImageId);
        if (after === before) return r;
        return { ...r, replace_string: after };
      });
      const beforeBg = cur.payload.background_html ?? '';
      const afterBg = beforeBg ? substituteSvgMarkers(beforeBg, markerToImageId) : beforeBg;
      regexScriptsAfterSubstitution = newRegex;
      return {
        ...cur,
        regex_scripts: newRegex,
        ...(afterBg !== beforeBg
          ? { payload: { ...cur.payload, background_html: afterBg } }
          : {}),
      };
    });
    if (!updated) {
      log.warn(
        `applySvgRasterIndex: updateLumirealm failed char=${characterId},character may not be a lumirealm card`,
      );
      return;
    }

    // Runtime DOM lifter handles fixed-position content post-render, so re-install all rules with no extension-managed partition.
    const lumiManaged = regexScriptsAfterSubstitution;
    if (lumiManaged.length > 0) {
      let characterName = characterId;
      try {
        const ch = await spindle.characters.get(characterId, userId);
        if (ch && typeof (ch as { name?: unknown }).name === 'string') {
          characterName = (ch as { name: string }).name;
        }
      } catch { /* falls back to id */ }
      log.info(
        `applySvgRasterIndex: re-dispatching install_regex_scripts char=${characterId} ` +
          `count=${lumiManaged.length} (post-SVG-substitution)`,
      );
      const pending = lumiManaged.map((r) => ({
        name: (r as { name?: string }).name ?? '',
        script_id: (r as { script_id?: string }).script_id ?? '',
        find_regex: (r as { find_regex?: string }).find_regex ?? '',
        replace_string: (r as { replace_string?: string }).replace_string ?? '',
        flags: (r as { flags?: string }).flags ?? '',
        placement: (r as { placement?: readonly string[] }).placement ?? [],
        scope: (r as { scope?: string }).scope ?? 'character',
        scope_id: (r as { scope_id?: string }).scope_id ?? characterId,
        target: (r as { target?: string }).target ?? 'display',
        min_depth: (r as { min_depth?: number | null }).min_depth ?? null,
        max_depth: (r as { max_depth?: number | null }).max_depth ?? null,
        trim_strings: (r as { trim_strings?: readonly string[] }).trim_strings ?? [],
        run_on_edit: (r as { run_on_edit?: boolean }).run_on_edit ?? false,
        substitute_macros: (r as { substitute_macros?: string }).substitute_macros ?? 'none',
        disabled: (r as { disabled?: boolean }).disabled ?? false,
        sort_order: (r as { sort_order?: number }).sort_order ?? 0,
        description: (r as { description?: string }).description ?? '',
        folder: (r as { folder?: string }).folder ?? '',
        metadata: { ...((r as { metadata?: Record<string, unknown> }).metadata ?? {}) },
      })) as Extract<BackendToFrontend, { type: 'install_regex_scripts' }>['scripts'];
      const ownership = await ensureRegexOwnership(spindle.regex_scripts, pending, userId);
      send({
        type: 'install_regex_scripts',
        characterId,
        characterName,
        scripts: ownership.scripts,
        cleanupStale: ownership.allOwned,
      }, userId);
    }

    const newSvgImageIds = Object.values(markerToImageId).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (newSvgImageIds.length > 0) {
      try {
        await appendImageIdsToJournal(userId, characterId, newSvgImageIds);
        log.info(
          `applySvgRasterIndex: journaled char=${characterId} added=${newSvgImageIds.length}`,
        );
      } catch (err) {
        log.warn(`applySvgRasterIndex: journal append failed char=${characterId}: ${errMsg(err)}`);
      }
    }

    const evictedChatIds: string[] = [];
    for (const [chatId, active] of activeCardByChat) {
      if (active.card.character_id === characterId) {
        activeCardByChat.delete(chatId);
        onActiveChatEvicted?.(chatId);
        evictedChatIds.push(chatId);
      }
    }
    if (evictedChatIds.length > 0) {
      log.info(
        `applySvgRasterIndex: invalidated ${evictedChatIds.length} active-card entries for char=${characterId}`,
      );
      for (const chatId of evictedChatIds) {
        try {
          const reloaded = await ensureActiveCardForChat(chatId, null, userId);
          if (reloaded) {
            invalidateRenderMcpForChat(chatId);
            invalidateMacroInterceptorForChat(chatId);
            await refreshBgHtml(reloaded, chatId, userId);
          }
        } catch (err) {
          log.warn(`applySvgRasterIndex: refresh chat=${chatId} threw: ${errMsg(err)}`);
        }
      }
    }
  };
}
