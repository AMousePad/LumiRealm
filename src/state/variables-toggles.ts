declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { ActiveCard } from '../interpreter/dispatch.js';
import type { AttributionWire, BackendToFrontend, SidebarToggleWire } from '../types/messages.js';
import type { LumirealmCharacterData } from '../payload/types.js';
import type { ModuleEnvelope } from './modules-store.js';
import {
  extractToggleKeys,
  parseToggleSyntax,
  type SidebarToggle,
} from '../core/toggle-syntax.js';
import { expectChatChange } from './own-chat-change.js';
import { invalidateRecentFlush } from './recent-flush-cache.js';
import { invalidateRenderMcpForChat } from './render-mcp-cache.js';
import { invalidateMacroInterceptorForChat } from './macro-interceptor-cache.js';
import type { VariableStateStore } from './variables-state.js';
import type { ToggleStateStore } from './toggle-state.js';

function sanitizeVarMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string') continue;
    if (v === undefined || v === null) {
      out[k] = '';
    } else if (typeof v === 'string') {
      out[k] = v;
    } else {
      try { out[k] = String(v); } catch { out[k] = ''; }
    }
  }
  return out;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function readCharacterToggleDsl(
  data: LumirealmCharacterData,
  risuai: Readonly<Record<string, unknown>>,
): string {
  const card = objectRecord(data.source?.card);
  const cardData = objectRecord(card?.['data']) ?? card;
  const extensions = objectRecord(cardData?.['extensions']);
  const sourceRisuai = objectRecord(extensions?.['risuai']);
  const sourceDsl = sourceRisuai?.['toggles'];
  if (typeof sourceDsl === 'string') return sourceDsl;

  const storedDsl = risuai['toggles'];
  return typeof storedDsl === 'string' ? storedDsl : '';
}

function toggleToWire(
  t: SidebarToggle,
  moduleId: string,
  toggleTranslations: Readonly<Record<string, string>>,
): SidebarToggleWire {
  const tx = (s: string | undefined): string | undefined => {
    if (s === undefined || s.length === 0) return undefined;
    const cached = toggleTranslations[s];
    return cached !== undefined && cached !== s ? cached : undefined;
  };
  const translatedValue = tx(t.value);
  const base = {
    moduleId,
    ...(translatedValue !== undefined ? { translatedValue } : {}),
  };
  switch (t.type) {
    case 'group':
    case 'groupEnd':
    case 'divider':
      return {
        type: t.type,
        ...(t.key !== undefined ? { key: t.key } : {}),
        ...(t.value !== undefined ? { value: t.value } : {}),
        ...base,
      };
    case 'caption':
      return {
        type: 'caption',
        ...(t.key !== undefined ? { key: t.key } : {}),
        value: t.value ?? '',
        ...base,
      };
    case 'select': {
      const optionsMap: Record<string, string> = {};
      for (const opt of t.options) {
        const cached = toggleTranslations[opt];
        if (cached !== undefined && cached !== opt) optionsMap[opt] = cached;
      }
      return {
        type: 'select',
        key: t.key,
        value: t.value,
        options: [...t.options],
        ...(Object.keys(optionsMap).length > 0
          ? { translatedOptionsByOriginal: optionsMap }
          : {}),
        ...base,
      };
    }
    case undefined:
    case 'text':
    case 'textarea':
      return {
        type: t.type ?? 'checkbox',
        key: t.key,
        value: t.value,
        ...(t.options !== undefined ? { options: [...t.options] } : {}),
        ...base,
      };
  }
}

export interface VariablesTogglesDeps {
  readonly translateLang: string;
  readonly variableState: VariableStateStore;
  readonly toggleState: ToggleStateStore;
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<{
    readonly data: LumirealmCharacterData | null;
    readonly risuai?: Readonly<Record<string, unknown>>;
    readonly character?: { readonly name?: string };
  } | null>;
  readonly readAttachedModuleEnvelopes: (
    userId: string,
    attachedIds: readonly string[],
  ) => Promise<readonly ModuleEnvelope[]>;
  readonly ensureActiveCardForChat: (
    chatId: string,
    characterId: string | null,
    userId: string | undefined,
  ) => Promise<ActiveCard | null>;
  readonly refreshBgHtml: (active: ActiveCard, chatId: string, userId: string | undefined) => Promise<void>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly pushDisplaySnapshot?: (
    active: ActiveCard,
    chatId: string,
    userId: string,
    vars: { local: Record<string, string>; global: Record<string, string>; chat: Record<string, string> },
    opts?: { guiReload?: boolean },
  ) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly debug: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface VariablesTogglesService {
  readonly refreshVariables: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean; guiReload?: boolean },
  ) => Promise<void>;
  readonly writeLocalVariable: (
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  readonly refreshToggleDefinitions: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ) => Promise<void>;
  readonly writeToggleValue: (
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
}

export function createVariablesTogglesService(deps: VariablesTogglesDeps): VariablesTogglesService {
  const {
    translateLang,
    variableState,
    toggleState,
    readLumirealm,
    readAttachedModuleEnvelopes,
    ensureActiveCardForChat,
    refreshBgHtml,
    send,
    log,
    errMsg,
  } = deps;

  async function refreshVariables(
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean; guiReload?: boolean },
  ): Promise<void> {
    if (userId === undefined) {
      log.debug(`variables.refresh: skip chat=${chatId},userId not yet captured`);
      return;
    }
    let chat: { metadata?: unknown } | null = null;
    try {
      chat = (await spindle.chats.get(chatId, userId)) as { metadata?: unknown } | null;
    } catch (err) {
      log.warn(`variables.refresh: chats.get failed chat=${chatId}: ${errMsg(err)}`);
      return;
    }
    const meta = (chat?.metadata ?? {}) as {
      macro_variables?: { global?: unknown };
      chat_variables?: unknown;
    };
    const scopes = {
      local: sanitizeVarMap(meta.chat_variables),
      global: sanitizeVarMap(meta.macro_variables?.global),
      chat: sanitizeVarMap(undefined),
    };
    // FE Default subtab needs both effective and card-side defaults to flag overridden entries and offer "Reset to card default".
    const cardSide = active.card.risuPayload.scriptstate_defaults ?? {};
    const overrides = active.lumirealm.user_overrides.default_variables_overrides ?? {};
    const defaults: Record<string, string> = { ...cardSide, ...overrides };
    const result = variableState.applySnapshot(chatId, scopes, defaults);
    if (result.changed || opts?.force) {
      send({
        type: 'set_variables',
        chatId,
        seq: result.entry.seq,
        scopes: result.entry.scopes,
        defaults: result.entry.defaults,
        defaultsCardSide: cardSide,
        characterId: active.card.character_id,
        ts: result.entry.ts,
      }, userId);
      const counts =
        `local=${Object.keys(scopes.local).length} ` +
        `global=${Object.keys(scopes.global).length} ` +
        `chat=${Object.keys(scopes.chat).length} ` +
        `defaults=${Object.keys(defaults).length} ` +
        `overrides=${Object.keys(overrides).length}`;
      log.info(
        `variables.refresh: pushed chat=${chatId} seq=${result.entry.seq} ` +
          `${counts} forced=${!!opts?.force}`,
      );
    } else {
      log.debug(`variables.refresh: unchanged chat=${chatId} seq=${result.entry.seq}`);
    }
    deps.pushDisplaySnapshot?.(active, chatId, userId, scopes, opts?.guiReload ? { guiReload: true } : undefined);
  }

  async function writeLocalVariable(
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) {
      return { ok: false, reason: 'variable name cannot be empty' };
    }
    const active = await ensureActiveCardForChat(chatId, null, userId);
    if (!active) {
      return { ok: false, reason: 'not a Risu-imported chat' };
    }

    let chat: { metadata?: unknown } | null;
    try {
      chat = (await spindle.chats.get(chatId, userId)) as { metadata?: unknown } | null;
    } catch (err) {
      return { ok: false, reason: `chats.get failed: ${errMsg(err)}` };
    }
    const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
    const cv = (meta['chat_variables'] && typeof meta['chat_variables'] === 'object'
      ? { ...(meta['chat_variables'] as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    if (value === null) {
      if (!Object.prototype.hasOwnProperty.call(cv, trimmedKey)) {
        return { ok: true };
      }
      delete cv[trimmedKey];
    } else {
      // Coerce to string. Empty string is allowed (matches `setvar X ""`).
      cv[trimmedKey] = String(value);
    }

    try {
      expectChatChange(chatId);
      await spindle.chats.update(
        chatId,
        { metadata: { ...meta, chat_variables: cv } as never },
        userId,
      );
    } catch (err) {
      return { ok: false, reason: `chats.update failed: ${errMsg(err)}` };
    }

    invalidateRenderMcpForChat(chatId);
    invalidateMacroInterceptorForChat(chatId);
    invalidateRecentFlush(chatId);
    await refreshBgHtml(active, chatId, userId);
    await refreshVariables(active, chatId, userId, { force: true });

    log.info(
      `variables.write: chat=${chatId} key=${trimmedKey} ` +
        (value === null ? 'deleted' : `len=${String(value).length}`),
    );
    return { ok: true };
  }

  async function loadToggleDsl(
    characterId: string,
    userId: string,
  ): Promise<{
    wireRows: readonly SidebarToggleWire[];
    attribution: Record<string, AttributionWire>;
    keyCount: number;
  }> {
    const fetched = await readLumirealm(characterId, userId);
    if (!fetched || !fetched.data) return { wireRows: [], attribution: {}, keyCount: 0 };
    const attachedIds = fetched.data.user_overrides.attached_module_ids ?? [];
    const envelopes = attachedIds.length > 0
      ? await readAttachedModuleEnvelopes(userId, attachedIds)
      : [];

    const attribution: Record<string, AttributionWire> = {};
    const wireRows: SidebarToggleWire[] = [];
    let keyCount = 0;

    const appendDsl = (
      dsl: string,
      ownerId: string,
      ownerName: string,
      toggleTranslations: Readonly<Record<string, string>> = {},
      translatedName?: string,
    ): void => {
      if (!dsl) return;
      const localFlat: readonly SidebarToggle[] = parseToggleSyntax(dsl);
      if (localFlat.length === 0) return;

      const entry: AttributionWire = {
        name: ownerName,
        moduleId: ownerId,
        ...(translatedName && translatedName.length > 0 ? { translatedName } : {}),
      };
      const keys = extractToggleKeys(localFlat);
      for (const k of keys) {
        if (!Object.prototype.hasOwnProperty.call(attribution, k)) {
          attribution[k] = entry;
        }
      }
      keyCount += keys.length;

      for (const t of localFlat) {
        wireRows.push(toggleToWire(t, ownerId, toggleTranslations));
      }
    };

    for (const env of envelopes) {
      const m = env.module as { customModuleToggle?: unknown; name?: unknown };
      const dsl = typeof m.customModuleToggle === 'string' ? m.customModuleToggle : '';
      const ownerName = typeof m.name === 'string' && m.name.length > 0 ? m.name : env.id;
      appendDsl(
        dsl,
        env.id,
        ownerName,
        env.translations?.[translateLang]?.toggles ?? {},
        env.translations?.[translateLang]?.name,
      );
    }

    appendDsl(
      readCharacterToggleDsl(fetched.data, fetched.risuai ?? {}),
      `character:${characterId}`,
      fetched.character?.name || 'Character',
    );

    return { wireRows, attribution, keyCount };
  }

  async function refreshToggleDefinitions(
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    opts?: { force?: boolean },
  ): Promise<void> {
    if (userId === undefined) {
      log.debug(`toggles.refresh: skip chat=${chatId},userId not yet captured`);
      return;
    }
    const { wireRows, attribution, keyCount } = await loadToggleDsl(
      active.card.character_id,
      userId,
    );
    const result = toggleState.applySnapshot(chatId, wireRows, attribution);
    if (result.changed || opts?.force) {
      send({
        type: 'set_toggle_definitions',
        chatId,
        seq: result.entry.seq,
        toggles: result.entry.toggles,
        attribution: result.entry.attribution,
        ts: result.entry.ts,
      }, userId);
      log.info(
        `toggles.refresh: pushed chat=${chatId} seq=${result.entry.seq} ` +
          `count=${wireRows.length} keys=${keyCount} forced=${!!opts?.force}`,
      );
    } else {
      log.debug(`toggles.refresh: unchanged chat=${chatId} seq=${result.entry.seq}`);
    }
  }

  async function writeToggleValue(
    chatId: string,
    key: string,
    value: string | null,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) {
      return { ok: false, reason: 'toggle key cannot be empty' };
    }
    const active = await ensureActiveCardForChat(chatId, null, userId);
    if (!active) {
      return { ok: false, reason: 'not a Risu-imported chat' };
    }

    let chat: { metadata?: unknown } | null;
    try {
      chat = (await spindle.chats.get(chatId, userId)) as { metadata?: unknown } | null;
    } catch (err) {
      return { ok: false, reason: `chats.get failed: ${errMsg(err)}` };
    }
    const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
    const mv = (meta['macro_variables'] && typeof meta['macro_variables'] === 'object'
      ? { ...(meta['macro_variables'] as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    const global = (mv['global'] && typeof mv['global'] === 'object'
      ? { ...(mv['global'] as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    const storeKey = `toggle_${trimmedKey}`;
    if (value === null) {
      if (!Object.prototype.hasOwnProperty.call(global, storeKey)) {
        return { ok: true };
      }
      delete global[storeKey];
    } else {
      global[storeKey] = String(value);
    }
    mv['global'] = global;

    try {
      expectChatChange(chatId);
      await spindle.chats.update(
        chatId,
        { metadata: { ...meta, macro_variables: mv } as never },
        userId,
      );
    } catch (err) {
      return { ok: false, reason: `chats.update failed: ${errMsg(err)}` };
    }

    invalidateRenderMcpForChat(chatId);
    invalidateMacroInterceptorForChat(chatId);
    await refreshBgHtml(active, chatId, userId);
    await refreshVariables(active, chatId, userId, { force: true });

    log.info(
      `toggles.write: chat=${chatId} key=${storeKey} ` +
        (value === null ? 'deleted' : `len=${String(value).length}`),
    );
    return { ok: true };
  }

  return { refreshVariables, writeLocalVariable, refreshToggleDefinitions, writeToggleValue };
}
