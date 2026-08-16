// HostApi - surface the interpreter needs from its host.
// Tests inject MockHostApi; production uses spindle-host.ts.
// Throws RisuCompatUnsupportedError when a needed surface is absent.

export interface HostMessage {
  readonly id: string;
  readonly content: string;
  readonly role: 'user' | 'assistant' | 'system' | string;
  readonly createdAt?: number;
  readonly speaker?: string;
  readonly greetingIndex?: number;
}

export interface HostCharacter {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly firstMessage?: string;
  readonly worldBookIds?: readonly string[];
  // Lumi image_id column; null when no avatar uploaded.
  readonly imageId?: string | null;
  readonly [k: string]: unknown;
}

export interface HostPersona {
  readonly id: string;
  readonly description?: string;
  readonly imageId?: string | null;
  readonly [k: string]: unknown;
}

export interface HostWorldInfoEntry {
  readonly id: string;
  readonly worldBookId?: string;
  readonly key?: string | readonly string[];
  readonly content?: string;
  readonly comment?: string;
  readonly orderValue?: number;
  readonly disabled?: boolean;
  readonly constant?: boolean;
  readonly [k: string]: unknown;
}

export interface InjectOpts {
  readonly mode?: 'context' | 'intercept';
  readonly role?: 'system' | 'user' | 'assistant';
  readonly position?: 'start' | 'historyend' | 'promptend';
  readonly depth?: number;
}

export interface HostDomHandle {
  on(event: string, cb: (ev: { dataset?: Record<string, string | undefined> }) => void): () => void;
  remove(): void;
}

export interface HostApi {
  readonly chat: {
    getChatId?: () => string | null;
    getMessages(): Promise<readonly HostMessage[]>;
    sendMessage(content: string, opts?: { role?: string }): Promise<{ id: string }>;
    editMessage(id: string, content: string): Promise<void>;
    deleteMessage(id: string): Promise<void>;
    getMetadata(key: string): Promise<unknown>;
    setMetadata(key: string, value: unknown): Promise<void>;
    inject(id: string, content: string, opts?: InjectOpts): Promise<void>;
    setExpression?(name: string): Promise<void>;
  };
  readonly characters: {
    get(id: string): Promise<HostCharacter>;
    update(id: string, patch: Partial<HostCharacter>): Promise<void>;
    setExpression?(name: string): Promise<void>;
  };
  readonly worldInfo?: {
    entries: {
      list(bookId: string, opts?: { limit?: number }): Promise<{ data: readonly HostWorldInfoEntry[] }>;
      create(bookId: string, entry: Partial<HostWorldInfoEntry>): Promise<HostWorldInfoEntry>;
      update(id: string, patch: Partial<HostWorldInfoEntry>): Promise<HostWorldInfoEntry>;
      delete(id: string): Promise<void>;
    };
  };
  readonly personas?: {
    getActive(): Promise<HostPersona | null>;
    update(id: string, patch: Partial<HostPersona>): Promise<void>;
  };
  readonly ui?: {
    toast?: (msg: string, kind?: 'info' | 'error' | 'warning' | 'success') => void;
    // Risu scriptings.ts alertNormal/alertError; awaits acknowledgement.
    alert?: (msg: string, kind?: 'info' | 'error' | 'warning' | 'success') => Promise<void>;
    prompt?: (message: string, defaultValue?: string) => Promise<string | null>;
    confirm?: (message: string, defaultValue?: string) => Promise<boolean>;
    pick?: (title: string, options: readonly string[]) => Promise<string | null>;
    dom?: {
      inject: (selector: string, html: string, opts?: { id?: string }) => HostDomHandle;
    };
  };
  readonly broadcast?: {
    emit(topic: string, data: unknown): void;
    on(topic: string, cb: (data: unknown) => void): () => void;
  };
  readonly llm?: {
    generate(req: {
      messages: readonly { role: string; content: string }[];
      model?: string;
      provider?: string;
      connectionId?: string;
      parameters?: Record<string, number>;
      prefillCompat?: boolean;
    }): Promise<{ content: string }>;
    listConnections?(): Promise<readonly {
      readonly id: string;
      readonly name: string;
      readonly provider: string;
      readonly model: string;
      readonly is_default: boolean;
    }[]>;
  };
  readonly tokens?: {
    count(text: string): Promise<number>;
  };
  readonly utils?: {
    template?: {
      render(text: string, vars: Record<string, unknown>): Promise<string>;
    };
  };
  readonly variables?: {
    local?: {
      get<T>(key: string, def?: T): Promise<T>;
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<boolean>;
      has(key: string): Promise<boolean>;
      clear(): Promise<void>;
    };
    global?: {
      get<T>(key: string, def?: T): Promise<T>;
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<boolean>;
    };
  };
}

/**
 * Pre-fetched snapshot of chat-state data the runtime would otherwise pull
 * via Spindle IPC. Used by `runListenEditChain` to share one snapshot across
 * all triggers in the same chain (Risu invariant: "fresh Lua state per
 * trigger" still holds; only the *data* it sees is shared).
 *
 * Each field is independently optional , pass only what you've fetched.
 * Unfilled fields fall through to the per-runtime IPC path as before.
 */
export interface TriggerRuntimePreloaded {
  /** Output of `loadVars(api)` — `$`-prefixed internal key shape. */
  readonly varsCache?: Record<string, string>;
  /** Risu's application-global chat variables (Lumiverse macro_variables.global). */
  readonly globalVars?: Readonly<Record<string, string>>;
  readonly scriptstateDefaults?: Readonly<Record<string, string>>;
  /** Output of `api.chat.getMessages()` — pre-Risu-frame-shift. Same shape
   *  the runtime would receive from Spindle directly. */
  readonly messagesRaw?: readonly HostMessage[];
  /** Pre-built lorebook cache — { entries, primaryBookId }. */
  readonly lorebook?: import('./runtime/lorebook.js').LorebookCache;
}

export interface TriggerRuntimeOpts {
  readonly displayMode?: boolean;
  readonly displayData?: string;
  readonly requestData?: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly lowLevelAccess?: boolean;
  readonly characterId?: string | null;
  readonly binding?: string;
  readonly chatId?: string;
  /** Pre-fetched chat-state snapshot — see `TriggerRuntimePreloaded`. */
  readonly preloaded?: TriggerRuntimePreloaded;
  // Backend uses this to filter MESSAGE_EDITED self-echoes from Lua setChat.
  readonly rememberOurWrite?: (chatId: string, msgId: string, content: string) => void;
  readonly stateChanged?: () => void;
  readonly auxConnectionId?: string | null;
  readonly auxModelOverride?: string | null;
  readonly auxSamplers?: {
    readonly temperature: number | null;
    readonly maxTokens: number | null;
    readonly contextSize: number | null;
    readonly topP: number | null;
    readonly minP: number | null;
    readonly topK: number | null;
    readonly frequencyPenalty: number | null;
    readonly presencePenalty: number | null;
    readonly repetitionPenalty: number | null;
  };
  readonly submodelConnectionId?: string | null;
  readonly submodelModelOverride?: string | null;
  readonly submodelSamplers?: {
    readonly temperature: number | null;
    readonly maxTokens: number | null;
    readonly contextSize: number | null;
    readonly topP: number | null;
    readonly minP: number | null;
    readonly topK: number | null;
    readonly frequencyPenalty: number | null;
    readonly presencePenalty: number | null;
    readonly repetitionPenalty: number | null;
  };
  readonly auxPrefillCompat?: boolean;
  readonly submodelPrefillCompat?: boolean;
  readonly auxDebugCapture?: (event: import("./runtime.js").AuxDebugCaptureEvent) => void;
  /** Backs Lua `cbs(value)`. Used by listenEdit chains that don't run
   *  inside a dispatch-context window. */
  readonly resolveTemplate?: (text: string) => Promise<string>;
}

export interface RegexRuntimeOpts {
  readonly characterId?: string | null;
}

export interface DispatchData {
  content?: string;
  message?: string;
  text?: string;
  characterId?: string;
  characterName?: string;
  userName?: string;
  [k: string]: unknown;
}


export interface ScriptNS {
  require(name: string): Promise<unknown>;
}

export { RisuCompatUnsupportedError } from '../payload/codec.js';
