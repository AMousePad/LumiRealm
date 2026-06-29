// Wires 179 risu-compat handlers into Spindle via registerMacro.
// Handlers are passed as functions; Lumi worker-runtime.ts accepts them.
// Per-macro env variables arrive as plain objects; writes are cached in varOverlays.

import '../risu-compat/handlers/index.js';
import { registry } from '../risu-compat/registry.js';
import type {
  RisuRuntimeContext,
  VarScope,
  FunctionRegistry,
  LorebookEntry,
  Message,
  CharacterAsset,
} from '../core/cbs/index.js';
import catalogJson from '../core/cbs/catalog/risu-macros.json';
import { CatalogIndex, parseCatalog } from '../core/cbs/index.js';
import { getActiveAssetIndexes } from './asset-cache.js';
import { getActiveScriptstateDefaults, getCharacterIdForChat } from './defaults-cache.js';
import { getActiveLorebook } from '../state/lorebook-cache.js';
import { getActiveModulesByNamespace } from './modules-by-namespace-cache.js';
import { getDecoratorBuffers } from './decorator-buffers.js';
import { getActiveCharacterImage, getActivePersonaImage } from './image-cache.js';
import type { AssetIndexEntry } from '../payload/types.js';
import { normalizeRoleToLumi } from '../util/role-coerce.js';
import { getCachedMessages } from './messages-cache.js';

import { makeSafeLogger } from '../util/safe-log.js';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI | undefined;

const spindleGlobal: import('lumiverse-spindle-types').SpindleAPI | undefined =
  typeof spindle !== 'undefined' ? spindle : undefined;

const logger = makeSafeLogger('macros');
const logInfo = (msg: string): void => logger.info(msg);
const logWarn = (msg: string): void => logger.warn(msg);

// Opt in per-invoke trace with RISU_COMPAT_TRACE_MACROS=1; off by default
// because a single #each over 1500 assets produces ~28k log lines per render.
const TRACE_MACROS: boolean = (() => {
  // Bun.env avoids process.env (Lumi commit 5195652 blocks it).
  try {
    const env = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env;
    return env?.RISU_COMPAT_TRACE_MACROS === '1';
  } catch {
    return false;
  }
})();

// Lumi worker-host.ts / worker-runtime.ts.
// env.variables arrive as plain objects (structured-clone, Maps not preserved).
export interface MacroInvokeCtx {
  readonly name: string;
  readonly args: readonly string[];
  readonly isScoped: boolean;
  readonly body: string;
  readonly offset?: number;
  readonly globalOffset?: number;
  readonly flags?: unknown;
  readonly env: MacroInvokeEnv;
  readonly commit?: boolean;
}

interface MacroInvokeEnv {
  readonly names?: {
    readonly user?: string;
    readonly char?: string;
  };
  readonly character?: {
    readonly name?: string;
    readonly description?: string;
    readonly personality?: string;
    readonly scenario?: string;
    readonly persona?: string;
    readonly mesExamples?: string;
    readonly systemPrompt?: string;
    readonly postHistoryInstructions?: string;
    readonly creatorNotes?: string;
    readonly firstMessage?: string;
  };
  readonly chat?: {
    readonly id?: string;
    readonly messageCount?: number;
    readonly lastMessage?: string;
    readonly lastUserMessage?: string;
    readonly lastCharMessage?: string;
    readonly lastMessageId?: number;
  };
  readonly system?: {
    readonly model?: string;
    readonly maxContext?: number;
    readonly isMobile?: boolean;
  };
  readonly variables?: {
    readonly local?: Record<string, string>;
    readonly global?: Record<string, string>;
    readonly chat?: Record<string, string>;
  };
  readonly extra?: Record<string, unknown>;
}

// Write overlay so setvar/getvar cohere within one prompt-assembly pass.
// Each macro RPC gets a frozen env snapshot; this cache bridges the gap.
interface VarOverlay {
  readonly local: Map<string, string>;
  readonly global: Map<string, string>;
  readonly chat: Map<string, string>;
  readonly temp: Map<string, string>;
  lastTouched: number;
}

const varOverlays = new Map<string, VarOverlay>();
const MAX_OVERLAYS = 100;

function getOverlay(chatId: string): VarOverlay {
  let overlay = varOverlays.get(chatId);
  if (!overlay) {
    if (varOverlays.size >= MAX_OVERLAYS) {
      // Evict oldest entry.
      let oldestKey: string | null = null;
      let oldestTouched = Infinity;
      for (const [k, v] of varOverlays) {
        if (v.lastTouched < oldestTouched) {
          oldestTouched = v.lastTouched;
          oldestKey = k;
        }
      }
      if (oldestKey) varOverlays.delete(oldestKey);
    }
    overlay = {
      local: new Map(),
      global: new Map(),
      chat: new Map(),
      temp: new Map(),
      lastTouched: Date.now(),
    };
    varOverlays.set(chatId, overlay);
  }
  overlay.lastTouched = Date.now();
  return overlay;
}

// Deviation from Risu: Risu clears functions per evaluation pass; we persist across worker lifetime.
const sessionFunctions: FunctionRegistry = (() => {
  const table = new Map<string, { body: string; argNames: readonly string[] }>();
  return {
    define: (name, body, argNames) => { table.set(name, { body, argNames }); },
    get: (name) => table.get(name) ?? null,
    delete: (name) => { table.delete(name); },
    has: (name) => table.has(name),
  };
})();


export function clearMacroVarOverlay(chatId: string): void {
  varOverlays.delete(chatId);
}

export function buildRuntimeContext(mctx: MacroInvokeCtx): RisuRuntimeContext {
  const env = mctx.env ?? ({} as MacroInvokeEnv);
  const chatId = env.chat?.id ?? '';
  // commit === false: dry-fire; mutating surfaces become no-ops.
  const committing = mctx.commit !== false;
  const overlay = (chatId && committing) ? getOverlay(chatId) : null;
  // Risu cbs.ts. Temp vars are per-invocation scratchpad, always writable.
  const tempOverlay = new Map<string, string>();

  const envLocal = env.variables?.local ?? {};
  const envGlobal = env.variables?.global ?? {};
  const envChat = env.variables?.chat ?? {};
  // Risu chatVar.svelte.ts getChatVar fallback; published on ensureActiveCardForChat.
  const defaults = getActiveScriptstateDefaults(chatId) ?? {};

  const vars = {
    get(scope: VarScope, name: string): string {
      if (scope === 'temp') return tempOverlay.get(name) ?? '';
      if (overlay) {
        if (scope === 'local' && overlay.local.has(name)) return overlay.local.get(name)!;
        if (scope === 'global' && overlay.global.has(name)) return overlay.global.get(name)!;
        // Risu conflates chat and local on the read side; try chat overlay
        // first for a written value, fall back to env.chat then env.local.
        if (scope === 'local' && overlay.chat.has(name)) return overlay.chat.get(name)!;
      }
      // Risu chatVar.svelte.ts,:36: unset keys return literal "null", not empty string.
      if (scope === 'global') return envGlobal[name] ?? 'null';
      const fromChat = envChat[name];
      if (fromChat !== undefined) return fromChat;
      const fromLocal = envLocal[name];
      if (fromLocal !== undefined) return fromLocal;
      const fromDefaults = defaults[name];
      if (fromDefaults !== undefined) return fromDefaults;
      return 'null';
    },
    set(scope: VarScope, name: string, value: string): void {
      if (scope === 'temp') { tempOverlay.set(name, value); return; }
      if (!committing || !overlay) return;
      if (scope === 'global') overlay.global.set(name, value);
      else overlay.chat.set(name, value);
      // Fire-and-forget writeback so trigger-path reads see the change on next generation.
      if (chatId && spindleGlobal) {
        try {
          const target = scope === 'global'
            ? spindleGlobal.variables.global.set(name, value)
            : spindleGlobal.variables.chat.set(chatId, name, value);
          void target.catch((err: unknown) => {
            logWarn(`vars.set writeback failed scope=${scope} name=${name}: ${err instanceof Error ? err.message : String(err)}`);
          });
        } catch (err) {
          logWarn(`vars.set threw scope=${scope} name=${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    add(scope: VarScope, name: string, delta: number): void {
      if (scope !== 'temp' && !committing) return;
      const cur = Number(this.get(scope, name));
      const next = String((Number.isFinite(cur) ? cur : 0) + delta);
      this.set(scope, name, next);
    },
    has(scope: VarScope, name: string): boolean {
      if (scope === 'temp') return tempOverlay.has(name);
      if (overlay) {
        if (scope === 'local' && (overlay.local.has(name) || overlay.chat.has(name))) return true;
        if (scope === 'global' && overlay.global.has(name)) return true;
      }
      if (scope === 'global') return Object.prototype.hasOwnProperty.call(envGlobal, name);
      return Object.prototype.hasOwnProperty.call(envChat, name)
        || Object.prototype.hasOwnProperty.call(envLocal, name)
        || Object.prototype.hasOwnProperty.call(defaults, name);
    },
    delete(scope: VarScope, name: string): void {
      if (scope === 'temp') { tempOverlay.delete(name); return; }
      if (!committing) return;
      if (overlay) {
        if (scope === 'global') overlay.global.delete(name);
        else { overlay.local.delete(name); overlay.chat.delete(name); }
      }
      if (chatId && spindleGlobal) {
        try {
          const op = scope === 'global'
            ? spindleGlobal.variables.global.delete(name)
            : spindleGlobal.variables.chat.delete(chatId, name);
          void op.catch(() => {});
        } catch { /* ignore */ }
      }
    },
  };

  // Lumi messageCount includes greeting at index 0; Risu's doesn't. Shift by 1.
  const messageCount = Math.max(0, Number(env.chat?.messageCount ?? 0) - 1);
  const lastMessage = String(env.chat?.lastMessage ?? '');
  const lastUser = String(env.chat?.lastUserMessage ?? '');
  const lastChar = String(env.chat?.lastCharMessage ?? '');
  // Risu-frame full array (greeting stripped) when the cache has it. Synthesized
  // last-user+last-char is the bootstrap fallback for chat-wide contexts.
  const cachedFull = chatId ? getCachedMessages(chatId) : null;
  const synthesized: Message[] = [];
  if (lastUser) synthesized.push({ role: 'user', content: lastUser, createdAt: 0 });
  if (lastChar) synthesized.push({ role: 'assistant', content: lastChar, createdAt: 0 });
  if (lastMessage && !synthesized.some((m) => m.content === lastMessage)) {
    synthesized.push({ role: 'assistant', content: lastMessage, createdAt: 0 });
  }
  const effective: readonly Message[] = cachedFull ?? synthesized;

  const messages = {
    all: () => effective,
    last: () => effective[effective.length - 1] ?? null,
    lastOf: (role: Message['role']): Message | null => {
      for (let i = effective.length - 1; i >= 0; i--) {
        const m = effective[i]!;
        if (m.role === role) return m;
      }
      return null;
    },
    count: (role?: Message['role']) => {
      if (role === undefined) {
        if (cachedFull) return effective.length;
        return env.chat?.messageCount != null ? messageCount : synthesized.length;
      }
      let n = 0;
      for (const m of effective) if (m.role === role) n++;
      return n;
    },
  };

  const cachedChatId = String(env.chat?.id ?? '');
  const cachedUserId = (() => {
    const raw = (env.extra as { userId?: unknown } | undefined)?.userId;
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  })();
  const identity = {
    charName: String(env.names?.char ?? env.character?.name ?? ''),
    userName: String(env.names?.user ?? ''),
    personaText: String(env.character?.persona ?? ''),
    personaName: String(env.names?.user ?? ''),
    personaImage: getActivePersonaImage(cachedUserId),
  };

  // Risu parser.svelte.ts: missing asset returns "". Populated on CHAT_CHANGED.
  const assetIndexes = getActiveAssetIndexes(String(env.chat?.id ?? ''));
  const additionalAssets = assetIndexes
    ? indexToCharacterAssets(assetIndexes.assets)
    : [];
  const emotionImages = assetIndexes
    ? indexToCharacterAssets(assetIndexes.emotions)
    : [];

  // Risu parser.svelte.ts pickHashRand seed. Resolved from chat->character cache.
  const cachedCharacterId = getCharacterIdForChat(cachedChatId) ?? '';

  const character = {
    description: String(env.character?.description ?? ''),
    personality: String(env.character?.personality ?? ''),
    scenario: String(env.character?.scenario ?? ''),
    exampleDialogue: String(env.character?.mesExamples ?? ''),
    mainPrompt: String(env.character?.systemPrompt ?? ''),
    postHistoryInstructions: String(env.character?.postHistoryInstructions ?? ''),
    creatorNotes: String(env.character?.creatorNotes ?? ''),
    jailbreakPrompt: '',
    globalNote: '',
    authorsNote: '',
    firstMessage: String(env.character?.firstMessage ?? ''),
    alternateGreetings: [] as readonly string[],
    selectedAlternateGreetingIndex: -1,
    type: 'character' as const,
    additionalAssets,
    emotionImages,
    prebuiltAssetCommand: false,
    prebuiltAssetExclude: [] as readonly string[],
    chaId: cachedCharacterId,
    image: getActiveCharacterImage(cachedChatId),
  };

  const lorebook: readonly LorebookEntry[] = getActiveLorebook(chatId);

  // Dry-fire: writes no-op; reads still find functions from prior committing pass.
  const functions: FunctionRegistry = committing
    ? sessionFunctions
    : {
        define: () => {},
        get: (name) => sessionFunctions.get(name),
        delete: () => {},
        has: (name) => sessionFunctions.has(name),
      };

  return {
    vars,
    identity,
    character,
    messages,
    rng: { random: () => Math.random() },
    clock: { now: () => Date.now() },
    triggerId: null,
    role: (() => {
      const dyn = (env as { dynamicMacros?: Record<string, string> }).dynamicMacros;
      const r = typeof dyn?.role === 'string' ? dyn.role : null;
      return r ? normalizeRoleToLumi(r) : null;
    })(),
    functions,
    aiModel: String(env.system?.model ?? ''),
    axModel: '',
    isFirstMessage: Number(env.chat?.messageCount ?? 0) <= 1,
    // Lumi resolves macros once per rule, not per message; lastMessageId-1 is the best approximation.
    currentMessageIndex: env.chat?.lastMessageId != null
      ? Math.max(-1, env.chat.lastMessageId - 1)
      : null,
    lorebook,
    jailbreakToggle: false,
    maxContext: Number(env.system?.maxContext ?? 0),
    language: '',
    appVersion: '',
    // Screen dims not available via Lumi-engine path; worker-eval populates real dims.
    screenWidth: 0,
    screenHeight: 0,
    commit: committing,
    legacyMediaFindings: false,
    ...(getActiveModulesByNamespace(chatId)
      ? { modulesByNamespace: getActiveModulesByNamespace(chatId)! }
      : {}),
    // Tier 3 lorebook decorator: {{position::NAME}} → joined content from
    // active entries with @@position pt_<NAME>. Buffer is staged by the
    // worldInfoInterceptor in backend.ts and consumed here per macro eval.
    ...(getDecoratorBuffers(chatId)?.positionPt
      ? { positionPt: getDecoratorBuffers(chatId)!.positionPt }
      : {}),
  };
}


function reconstructRaw(name: string, args: readonly string[]): string {
  if (args.length === 0) return name;
  return `${name}::${args.join('::')}`;
}

function indexToCharacterAssets(
  index: Readonly<Record<string, AssetIndexEntry>>,
): CharacterAsset[] {
  const out: CharacterAsset[] = [];
  for (const [name, entry] of Object.entries(index)) {
    for (const imageId of entry.imageIds) {
      out.push({
        name,
        src: `/api/v1/images/${imageId}`,
        ...(entry.ext ? { ext: entry.ext } : {}),
      });
    }
  }
  return out;
}


let registered = false;

interface InvokeCounter {
  total: number;
  byName: Map<string, number>;
  lastEmitTotal: number;
  lastEmitTs: number;
}
const invokeCounter: InvokeCounter = {
  total: 0,
  byName: new Map(),
  lastEmitTotal: 0,
  lastEmitTs: 0,
};
const SUMMARY_EVERY = 500;
const SUMMARY_MIN_MS = 250;

function noteInvoke(name: string): void {
  invokeCounter.total += 1;
  invokeCounter.byName.set(name, (invokeCounter.byName.get(name) ?? 0) + 1);
  const since = invokeCounter.total - invokeCounter.lastEmitTotal;
  const now = Date.now();
  if (since >= SUMMARY_EVERY && now - invokeCounter.lastEmitTs >= SUMMARY_MIN_MS) {
    const top = Array.from(invokeCounter.byName.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => `${n}(${c})`)
      .join(' ');
    logInfo(`[invoke-summary] total=${invokeCounter.total} since_last=${since} top5=${top}`);
    invokeCounter.lastEmitTotal = invokeCounter.total;
    invokeCounter.lastEmitTs = now;
  }
}

// Skip these to avoid "Cannot override built-in macro" warnings (Lumi worker-host.ts).
const LUMI_NATIVE_COLLISIONS = new Set<string>([
  'or', 'trim', 'reverse', 'pick', 'getglobalvar', 'deletevar', 'flushvar',
  'datetimeformat', '//', 'lastcharmessage', 'lastusermessage',
  'lastmessageid', 'maxcontext', 'messagecount', 'isotime', 'isodate',
  'idleduration', 'idle_duration', 'newline', 'jailbreak',
  // Bare-registered Risu macros Lumi added natively on 2026-06-20. Our evaluator
  // resolves them, so skip the rejected Lumi registration to silence the warning.
  'sum', 'average', 'all', 'any', 'contains', 'range', 'filter',
]);

export function registerAll(): void {
  if (!spindleGlobal) {
    logWarn('spindle unavailable — macros NOT registered');
    return;
  }
  if (registered) {
    logInfo('registerAll: already registered — skip');
    return;
  }
  const aliasByCanonical = buildAliasMap();

  const all = registry.entries();
  logInfo(`registerAll: starting registration of ${all.length} handlers`);
  let ok = 0;
  let failed = 0;
  let aliasesRegistered = 0;
  let skippedLumiNatives = 0;
  for (const reg of all) {
    if (LUMI_NATIVE_COLLISIONS.has(reg.name)) {
      skippedLumiNatives += 1;
      continue;
    }
    try {
      const handlerFn = (mctx: MacroInvokeCtx): string => {
        noteInvoke(reg.name);
        const ctx = buildRuntimeContext(mctx);
        const args = reg.scoped ? [...mctx.args, mctx.body] : mctx.args;
        const raw = reconstructRaw(reg.name, args);
        let result = '';
        let threw: Error | null = null;
        try {
          result = reg.handler(ctx, args, raw);
        } catch (err) {
          threw = err instanceof Error ? err : new Error(String(err));
        }
        if (TRACE_MACROS) {
          try {
            const env = mctx.env;
            const argsPreview = args.slice(0, 4).map((a) => JSON.stringify(String(a).slice(0, 40))).join(', ');
            const msgCount = env?.chat?.messageCount ?? '?';
            const lmi = env?.chat?.lastMessageId ?? '?';
            const chatId = env?.chat?.id ?? '?';
            const commit = mctx.commit;
            const resultPreview = JSON.stringify(String(result).slice(0, 80));
            const suffix = threw ? ` THREW=${threw.message}` : '';
            logInfo(
              `invoke name=${reg.name} scoped=${reg.scoped ? '1' : '0'} commit=${commit === false ? 'dry' : 'commit'} ` +
                `chat.id=${chatId} chat.messageCount=${msgCount} chat.lastMessageId=${lmi} ` +
                `args=[${argsPreview}] result=${resultPreview}${suffix}`,
            );
          } catch { /* logging must never throw */ }
        }
        if (threw) {
          logWarn(`handler "${reg.name}" threw: ${threw.message}`);
          return '';
        }
        return result;
      };
      spindleGlobal.registerMacro({
        name: reg.name,
        category: reg.category,
        description: reg.description,
        returnType: 'string',
        handler: handlerFn as unknown as string,
      });
      ok += 1;
      const aliases = aliasByCanonical.get(normaliseMacroName(reg.name)) ?? [];
      for (const alias of aliases) {
        if (alias === reg.name) continue;
        if (LUMI_NATIVE_COLLISIONS.has(alias)) continue;
        try {
          spindleGlobal.registerMacro({
            name: alias,
            category: reg.category,
            description: `${reg.description} (alias of ${reg.name})`,
            returnType: 'string',
            handler: handlerFn as unknown as string,
          });
          aliasesRegistered += 1;
        } catch (err) {
          logWarn(`registerMacro alias "${alias}" for "${reg.name}" threw: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      failed += 1;
      logWarn(`registerMacro "${reg.name}" threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logInfo(`registerAll: done ok=${ok} aliases=${aliasesRegistered} failed=${failed} skipped_lumi_natives=${skippedLumiNatives} total=${all.length}`);
  registered = true;
}

function buildAliasMap(): Map<string, readonly string[]> {
  const out = new Map<string, string[]>();
  let catalog: CatalogIndex;
  try {
    catalog = new CatalogIndex(parseCatalog(catalogJson as unknown));
  } catch (err) {
    logWarn(`buildAliasMap: catalog parse failed (${err instanceof Error ? err.message : String(err)}) — no aliases will be registered`);
    return out;
  }
  for (const entry of catalog.entries) {
    if (!entry.aliases || entry.aliases.length === 0) continue;
    const key = normaliseMacroName(entry.name);
    const list = out.get(key) ?? [];
    for (const alias of entry.aliases) {
      if (typeof alias !== 'string' || alias.length === 0) continue;
      if (!list.includes(alias)) list.push(alias);
    }
    out.set(key, list);
  }
  return out;
}

function normaliseMacroName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^[#:]+/, '')
    .replace(/[\s_-]+/g, '');
}
