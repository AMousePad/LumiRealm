// Spindle -> HostApi adapter. Thin remapping; no interpreter logic.

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type {
  WorldBookEntryDTO,
  WorldBookEntryUpdateDTO,
} from 'lumiverse-spindle-types';
import type {
  HostApi,
  HostMessage,
  HostCharacter,
  HostPersona,
  HostWorldInfoEntry,
  InjectOpts,
} from './host.js';
import { expectChatChange } from '../state/own-chat-change.js';
import { expectCharacterEdit } from '../state/own-character-edit.js';
import { makeSafeLogger } from '../util/safe-log.js';
import { filterSamplerParamsForProvider } from '../util/samplers-wire.js';
import { awaitAlertDismissal } from './alert-bridge.js';
import { awaitPickResolution } from './pick-bridge.js';

const log = makeSafeLogger('spindle-host.llm.generate');

export interface SpindleHostCtx {
  readonly chatId: string;
  readonly characterId: string;
  readonly userId: string | undefined;
}

export function makeSpindleHost(ctx: SpindleHostCtx): HostApi {
  const { chatId, characterId, userId } = ctx;
  const uid = userId ?? undefined;

  async function getMessages(): Promise<readonly HostMessage[]> {
    const msgs = await spindle.chat.getMessages(chatId);
    return msgs.map((m) => ({
      id: m.id,
      content: typeof m.content === 'string' ? m.content : '',
      role: m.role,
    }));
  }

  async function sendMessage(content: string, opts?: { role?: string }): Promise<{ id: string }> {
    // Defensive: accept Risu aliases ('char'/'bot' → assistant, 'sys' → system)
    // alongside Lumi shape so internal callers can't silently land on the wrong role.
    const roleRaw = opts?.role ?? 'user';
    const role: 'system' | 'user' | 'assistant' =
      roleRaw === 'system' || roleRaw === 'sys' ? 'system'
      : roleRaw === 'assistant' || roleRaw === 'char' || roleRaw === 'bot' ? 'assistant'
      : 'user';
    const created = await spindle.chat.appendMessage(chatId, { role, content });
    return { id: created.id };
  }

  async function editMessage(id: string, content: string): Promise<void> {
    await spindle.chat.updateMessage(chatId, id, { content });
  }

  async function deleteMessage(id: string): Promise<void> {
    await spindle.chat.deleteMessage(chatId, id);
  }

  async function getMetadata(key: string): Promise<unknown> {
    const chat = await spindle.chats.get(chatId, uid);
    const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
    return meta[key];
  }

  async function setMetadata(key: string, value: unknown): Promise<void> {
    const chat = await spindle.chats.get(chatId, uid);
    const currentMeta = (chat?.metadata ?? {}) as Record<string, unknown>;
    expectChatChange(chatId);
    await spindle.chats.update(chatId, {
      metadata: { ...currentMeta, [key]: value },
    }, uid);
  }

  async function inject(id: string, content: string, opts?: InjectOpts): Promise<void> {
    const anySpindle = spindle as unknown as {
      chats?: { inject?: (chatId: string, id: string, content: string, opts?: unknown, uid?: string) => Promise<void> };
    };
    if (anySpindle.chats?.inject) {
      await anySpindle.chats.inject(chatId, id, content, opts, uid);
      return;
    }
    const chat = await spindle.chats.get(chatId, uid);
    const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(meta['_risu_pending_injections'])
      ? [...(meta['_risu_pending_injections'] as unknown[])]
      : [];
    pending.push({ id, content, opts });
    expectChatChange(chatId);
    await spindle.chats.update(chatId, {
      metadata: { ...meta, _risu_pending_injections: pending },
    }, uid);
  }

  async function charGet(id: string): Promise<HostCharacter> {
    const ch = await spindle.characters.get(id, uid) as Record<string, unknown> | null;
    if (!ch) return { id, description: '' };
    const rawImageId = ch['image_id'];
    return {
      id,
      name: typeof ch['name'] === 'string' ? ch['name'] as string : '',
      description: typeof ch['description'] === 'string' ? ch['description'] as string : '',
      firstMessage: typeof ch['first_mes'] === 'string' ? ch['first_mes'] as string : '',
      worldBookIds: Array.isArray(ch['world_book_ids']) ? ch['world_book_ids'] as string[] : [],
      imageId: typeof rawImageId === 'string' && rawImageId.length > 0 ? rawImageId : null,
    };
  }

  async function charUpdate(id: string, patch: Partial<HostCharacter>): Promise<void> {
    const p: Record<string, unknown> = {};
    if (typeof patch.name === 'string') p['name'] = patch.name;
    if (typeof patch.description === 'string') p['description'] = patch.description;
    if (typeof patch.firstMessage === 'string') p['first_mes'] = patch.firstMessage;
    // Suppress CHARACTER_EDITED echo; dispatch does its own fan-out at end.
    expectCharacterEdit(id);
    await spindle.characters.update(id, p, uid);
  }

  const anySpindle = spindle as unknown as {
    toast?: {
      info: (msg: string, opts?: { title?: string; duration?: number; userId?: string }) => void;
      success: (msg: string, opts?: { title?: string; duration?: number; userId?: string }) => void;
      warning: (msg: string, opts?: { title?: string; duration?: number; userId?: string }) => void;
      error: (msg: string, opts?: { title?: string; duration?: number; userId?: string }) => void;
    };
    prompt?: {
      input: (o: { title: string; message?: string; placeholder?: string; defaultValue?: string; multiline?: boolean; userId?: string }) => Promise<{ value: string | null; cancelled: boolean }>;
    };
    modal?: {
      confirm: (o: { title: string; message: string; variant?: string; confirmLabel?: string; cancelLabel?: string; userId?: string }) => Promise<{ confirmed: boolean }>;
    };
    sendToFrontend?: (msg: unknown, targetUserId?: string) => void;
  };

  const dtoToHostEntry = (r: WorldBookEntryDTO): HostWorldInfoEntry => {
    const e: Record<string, unknown> = { ...r, id: typeof r.id === 'string' ? r.id : '' };
    if (typeof r.world_book_id === 'string') e.worldBookId = r.world_book_id;
    if (Array.isArray(r.key)) e.key = r.key as readonly string[];
    else if (typeof r.key === 'string') e.key = r.key;
    if (typeof r.content === 'string') e.content = r.content;
    if (typeof r.comment === 'string') e.comment = r.comment;
    if (typeof r.order_value === 'number') e.orderValue = r.order_value;
    if (typeof r.disabled === 'boolean') e.disabled = r.disabled;
    if (typeof r.constant === 'boolean') e.constant = r.constant;
    return e as HostWorldInfoEntry;
  };
  const hostPatchToDto = (p: Partial<HostWorldInfoEntry>): WorldBookEntryUpdateDTO => {
    const out: WorldBookEntryUpdateDTO = {};
    if (p.key !== undefined) out.key = Array.isArray(p.key) ? p.key : [p.key];
    if (p.content !== undefined) out.content = p.content;
    if (p.comment !== undefined) out.comment = p.comment;
    if (p.orderValue !== undefined) out.order_value = p.orderValue;
    if (p.disabled !== undefined) out.disabled = p.disabled;
    if (p.constant !== undefined) out.constant = p.constant;
    return out;
  };
  const worldInfo: NonNullable<HostApi['worldInfo']> = {
    entries: {
      list: async (bookId: string, opts?: { limit?: number }): Promise<{ data: readonly HostWorldInfoEntry[] }> => {
        const res = await spindle.world_books.entries.list(bookId, { ...opts, ...(uid ? { userId: uid } : {}) });
        return { data: res.data.map(dtoToHostEntry) };
      },
      create: async (bookId: string, entry: Partial<HostWorldInfoEntry>): Promise<HostWorldInfoEntry> =>
        dtoToHostEntry(await spindle.world_books.entries.create(bookId, hostPatchToDto(entry), uid)),
      update: async (id: string, patch: Partial<HostWorldInfoEntry>): Promise<HostWorldInfoEntry> =>
        dtoToHostEntry(await spindle.world_books.entries.update(id, hostPatchToDto(patch), uid)),
      delete: async (id: string): Promise<void> => { await spindle.world_books.entries.delete(id, uid); },
    },
  };

  const personas: NonNullable<HostApi['personas']> = {
    getActive: async (): Promise<HostPersona | null> => {
      const p = await spindle.personas.getActive(uid);
      if (!p) return null;
      return { ...p, imageId: p.image_id || null };
    },
    update: async (id: string, patch: Partial<HostPersona>): Promise<void> => {
      await spindle.personas.update(id, patch, uid);
    },
  };

  const host: HostApi = {
    chat: {
      getChatId: () => chatId,
      getMessages,
      sendMessage,
      editMessage,
      deleteMessage,
      getMetadata,
      setMetadata,
      inject,
    },
    characters: {
      get: charGet,
      update: charUpdate,
    },
    worldInfo,
    personas,
    ui: {
      toast: (msg: string, kind?: 'info' | 'error' | 'warning' | 'success') => {
        const t = anySpindle.toast;
        if (!t) return;
        if (userId === undefined) {
          log.warn(`toast: no userId in dispatch ctx, skipping (would broadcast)`);
          return;
        }
        const opts = { userId };
        const k = kind ?? 'info';
        if (k === 'error') t.error(msg, opts);
        else if (k === 'warning') t.warning(msg, opts);
        else if (k === 'success') t.success(msg, opts);
        else t.info(msg, opts);
      },
      prompt: async (message: string, defaultValue?: string): Promise<string | null> => {
        const p = anySpindle.prompt;
        if (!p?.input) return null;
        try {
          const res = await p.input({
            title: message.slice(0, 80),
            ...(message.length > 80 ? { message } : {}),
            ...(defaultValue !== undefined ? { defaultValue } : {}),
            ...(userId !== undefined ? { userId } : {}),
          });
          return (res?.cancelled || res?.value == null) ? null : String(res.value);
        } catch { return null; }
      },
      confirm: async (message: string): Promise<boolean> => {
        const m = anySpindle.modal;
        if (!m?.confirm) return false;
        try {
          const res = await m.confirm({
            title: 'Confirm',
            message,
            ...(userId !== undefined ? { userId } : {}),
          });
          return !!res?.confirmed;
        } catch { return false; }
      },
      // Risu alertNormal/alertError port: FE owns the modal, BE awaits
      // `alert_dismissed`.
      alert: async (message: string, kind?: 'info' | 'error' | 'warning' | 'success'): Promise<void> => {
        const sf = anySpindle.sendToFrontend;
        if (typeof sf !== 'function' || userId === undefined) {
          if (userId === undefined) log.warn(`alert: no userId in dispatch ctx, skipping (would broadcast)`);
          else {
            const t = anySpindle.toast;
            t?.info?.(message, { userId });
          }
          return;
        }
        const requestId = (globalThis.crypto?.randomUUID?.() ?? `alert-${Date.now()}-${Math.random()}`);
        const wireKind: 'info' | 'error' = kind === 'error' ? 'error' : 'info';
        try {
          sf({ type: 'request_alert', requestId, message, kind: wireKind }, userId);
          await awaitAlertDismissal(requestId, userId);
        } catch { /* swallow */ }
      },
      pick: async (title: string, options: readonly string[]): Promise<string | null> => {
        const sf = anySpindle.sendToFrontend;
        if (typeof sf !== 'function' || options.length === 0 || userId === undefined) {
          log.warn(`pick: no sendToFrontend or empty options (n=${options.length}) or no userId, returning null`);
          return null;
        }
        const requestId = (globalThis.crypto?.randomUUID?.() ?? `pick-${Date.now()}-${Math.random()}`);
        log.info(`pick: requestId=${requestId} title=${JSON.stringify(title.slice(0, 80))} options=${options.length}`);
        try {
          sf({ type: 'request_pick', requestId, title, options }, userId);
          const v = await awaitPickResolution(requestId, userId);
          log.info(`pick: requestId=${requestId} resolved value=${JSON.stringify(v)}`);
          return v;
        } catch (err) {
          log.error(`pick: requestId=${requestId} threw ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      },
    },
  };
  const generateApi = (anySpindle as {
    generate?: {
      raw?: (input: {
        type: 'raw' | 'quiet' | 'batch';
        messages?: readonly { role: string; content: string }[];
        connection_id?: string;
        provider?: string;
        model?: string;
        parameters?: Record<string, unknown>;
        userId?: string;
      }) => Promise<unknown>;
    };
  }).generate;
  type ConnectionDTO = {
    id: string; name: string; provider: string; model: string;
    is_default: boolean; has_api_key: boolean;
  };
  const connectionsApi = (anySpindle as {
    connections?: {
      list?: (uid?: string) => Promise<readonly ConnectionDTO[]>;
      get?: (id: string, uid?: string) => Promise<ConnectionDTO | null>;
    };
  }).connections;
  if (generateApi?.raw) {
    // spindle.generate.raw requires connection_id and model at top level; resolve before dispatch.
    type Resolution =
      | { ok: true; value: { id: string; model: string | undefined; provider: string } }
      | { ok: false; error: string };

    async function resolveConnection(explicitId: string | undefined): Promise<Resolution> {
      if (!connectionsApi) {
        return { ok: false, error: 'spindle.connections API not available on this Lumi build' };
      }
      try {
        if (explicitId) {
          if (!connectionsApi.get) {
            return { ok: false, error: 'spindle.connections.get not available on this Lumi build' };
          }
          const conn = await connectionsApi.get(explicitId, uid);
          if (!conn) {
            return {
              ok: false,
              error: `Connection profile "${explicitId.slice(0, 8)}…" not found. Pick a different one in Risu Settings → Auxiliary Model.`,
            };
          }
          return {
            ok: true,
            value: { id: conn.id, model: conn.model || undefined, provider: conn.provider || '' },
          };
        }
        if (!connectionsApi.list) {
          return { ok: false, error: 'spindle.connections.list not available on this Lumi build' };
        }
        const list = await connectionsApi.list(uid);
        if (!list || list.length === 0) {
          return {
            ok: false,
            error: 'No connection profiles configured. Set up a connection in Lumiverse Settings → Connections, then pick it (or mark it default).',
          };
        }
        const conn = list.find((c) => c.is_default) ?? list[0]!;
        return {
          ok: true,
          value: { id: conn.id, model: conn.model || undefined, provider: conn.provider || '' },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Connection resolution failed: ${msg}` };
      }
    }
    (host as { llm?: HostApi['llm'] }).llm = {
      async generate(req): Promise<{ content: string }> {
        const resolution = await resolveConnection(req.connectionId);
        if (!resolution.ok) {
          log.warn(resolution.error);
          throw new Error(resolution.error);
        }
        const resolved = resolution.value;
        const effectiveModel = req.model || resolved.model || '';
        const provider = req.provider || resolved.provider;
        const parameters = filterSamplerParamsForProvider(
          { ...(req.parameters ?? {}), ...(effectiveModel ? { model: effectiveModel } : {}) },
          provider,
        );
        // Coerce Risu role aliases ('sys' / 'bot' / 'char') to OpenAI shape.
        const messages = req.messages.map((m) => ({
          role:
            m.role === 'sys' ? 'system'
            : m.role === 'bot' || m.role === 'char' ? 'assistant'
            : (m.role === 'system' || m.role === 'user' || m.role === 'assistant') ? m.role
            : 'user',
          content: m.content,
        }));
        // Prefill-compatibility (opt-in per channel via Settings → Aux/Sub):
        // models that reject an assistant-ending conversation get the trailing
        // assistant prefill folded into a user instruction that preserves the
        // steer ("Begin your response with: …").
        const toUserInstruction = (
          msgs: readonly { role: string; content: string }[],
        ): { role: string; content: string }[] => {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== 'assistant') return [...msgs];
          const instruction = `Begin your response with:\n${last.content}`;
          const head = msgs.slice(0, -1);
          const prev = head[head.length - 1];
          // Avoid two consecutive user messages (Anthropic rejects them):
          // fold the instruction into the preceding user turn when present.
          if (prev && prev.role === 'user') {
            return [
              ...head.slice(0, -1),
              { role: 'user', content: `${prev.content}\n\n${instruction}` },
            ];
          }
          return [...head, { role: 'user', content: instruction }];
        };
        const buildInput = (
          msgs: readonly { role: string; content: string }[],
        ): {
          type: 'raw' | 'quiet' | 'batch';
          messages: readonly { role: string; content: string }[];
          connection_id: string;
          provider?: string;
          model?: string;
          parameters?: Record<string, unknown>;
          userId?: string;
        } => ({
          type: 'raw',
          messages: msgs,
          connection_id: resolved.id,
          ...(provider ? { provider } : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
          ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
          ...(uid !== undefined ? { userId: uid } : {}),
        });
        log.info(
          `dispatching connection_id=${resolved.id.slice(0, 8)}… ` +
            `model="${effectiveModel || '<connection-default>'}" ` +
            `provider="${provider || '<connection-default>'}" ` +
            `msgs=${messages.length} params=[${Object.keys(parameters).join(',')}]`,
        );
        const finalMessages = req.prefillCompat ? toUserInstruction(messages) : messages;
        const result = await generateApi.raw!(buildInput(finalMessages));
        const r = result as { content?: unknown } | undefined;
        return { content: typeof r?.content === 'string' ? r.content : '' };
      },
      ...(connectionsApi?.list
        ? {
            async listConnections(): Promise<readonly {
              id: string; name: string; provider: string; model: string; is_default: boolean;
            }[]> {
              const list = await connectionsApi.list!(uid);
              return list.map((c) => ({
                id: c.id,
                name: c.name,
                provider: c.provider,
                model: c.model,
                is_default: c.is_default,
              }));
            },
          }
        : {}),
    };
  }

  const tokensApi = (anySpindle as {
    tokens?: {
      countText?: (text: string, options?: unknown) => Promise<{ total_tokens?: number }>;
    };
  }).tokens;
  if (tokensApi?.countText) {
    (host as { tokens?: HostApi['tokens'] }).tokens = {
      async count(text: string): Promise<number> {
        try {
          const r = await tokensApi.countText!(text, uid !== undefined ? { userId: uid } : undefined);
          const n = (r as { total_tokens?: number }).total_tokens;
          return typeof n === 'number' && Number.isFinite(n) ? n : Math.ceil(text.length / 4);
        } catch {
          return Math.ceil(text.length / 4);
        }
      },
    };
  }

  void characterId; // surfaced via ctx for future expansion
  return host;
}
