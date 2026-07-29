// Builds EvaluatorCtx directly for in-worker pipeline runs. Var writes fire a
// best-effort Spindle writeback for cross-pass visibility.

import type {
  FunctionRegistry,
  LorebookEntry,
  Message,
  VarScope,
  CharacterAsset,
} from "../../core/cbs/index.js";

import type { EvaluatorCtx } from "./types.js";
import type { AssetIndexEntry } from "../../payload/types.js";
import { normalizeRoleToLumi } from "../../util/role-coerce.js";

declare const spindle: import("lumiverse-spindle-types").SpindleAPI | undefined;

const spindleGlobal: import("lumiverse-spindle-types").SpindleAPI | undefined =
  typeof spindle !== "undefined" ? spindle : undefined;

function makeFunctionRegistry(): FunctionRegistry {
  const table = new Map<string, { body: string; argNames: readonly string[] }>();
  return {
    define: (name, body, argNames) => { table.set(name, { body, argNames }); },
    get: (name) => table.get(name) ?? null,
    delete: (name) => { table.delete(name); },
    has: (name) => table.has(name),
  };
}

// Per-chat write-through overlay; coherent setvar/getvar within a pipeline run.
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

/** Drop the in-memory overlay for a chat — call on CHAT_DELETED. */
export function clearVarOverlay(chatId: string): void {
  varOverlays.delete(chatId);
}

// A throwaway overlay for passes that must NOT mutate shared/persistent state
function makeEphemeralOverlay(): VarOverlay {
  return {
    local: new Map(),
    global: new Map(),
    chat: new Map(),
    temp: new Map(),
    lastTouched: 0,
  };
}

export interface VarReadRecorder {
  readonly touched: Set<string>;
  volatile: boolean;
}

export const MSG_DEP_KEY = "__msg__";

// Input shape for a single evaluator run, including direct identity and
// message slices pulled out of the extension's live ActiveCard state.
export interface BuildEvaluatorCtxInput {
  readonly chatId: string;
  readonly userId?: string;
  readonly characterId?: string;
  readonly userName: string;
  readonly charName: string;
  readonly personaText?: string;
  // Risu parser.svelte.ts
  readonly personaImage?: string;
  readonly character: {
    readonly description?: string;
    readonly personality?: string;
    readonly scenario?: string;
    readonly exampleDialogue?: string;
    readonly mainPrompt?: string;
    readonly postHistoryInstructions?: string;
    readonly creatorNotes?: string;
    readonly jailbreakPrompt?: string;
    readonly globalNote?: string;
    readonly authorsNote?: string;
    readonly firstMessage?: string;
    readonly alternateGreetings?: readonly string[];
    readonly selectedAlternateGreetingIndex?: number;
    readonly additionalAssets?: Readonly<Record<string, AssetIndexEntry>>;
    readonly emotionImages?: Readonly<Record<string, AssetIndexEntry>>;
    // Risu parser.svelte.ts
    readonly image?: string;
  };
  readonly chat: {
    readonly messageCount?: number;
    readonly lastMessage?: string;
    readonly lastUserMessage?: string;
    readonly lastCharMessage?: string;
    readonly lastMessageId?: number;
    readonly messages?: readonly Message[];
  };
  readonly variables: {
    readonly local?: Readonly<Record<string, string>>;
    readonly global?: Readonly<Record<string, string>>;
    readonly chat?: Readonly<Record<string, string>>;
  };
  readonly scriptstateDefaults?: Readonly<Record<string, string>>;
  readonly system?: {
    readonly model?: string;
    readonly maxContext?: number;
  };
  readonly screenWidth?: number;
  readonly screenHeight?: number;
  readonly currentMessageIndexOverride?: number;
  readonly currentMessageRoleOverride?: string;
  /** false = display-pass; writes no-op, asset macros emit HTML. */
  readonly commit: boolean;
  readonly suppressVarPersist?: boolean;
  readonly legacyMediaFindings?: boolean;
  readonly modulesByNamespace?: Readonly<Record<string, readonly string[]>>;
  readonly lorebook?: readonly LorebookEntry[];
  /** Per-chat `{{position::NAME}}` substitution map. See RisuRuntimeContext.positionPt. */
  readonly positionPt?: Readonly<Record<string, string>>;
  /** Risu cbs() call context. See RisuRuntimeContext.cbsContext. */
  readonly cbsContext?: boolean;
  /** Risu Chat.svelte display render: setvar family hides without executing. */
  readonly rmVar?: boolean;
  /** Risu runCurrentChatFunction pass: setvar family executes. */
  readonly runVar?: boolean;
  readonly recorder?: VarReadRecorder;
  // Fires on every local-scope write (null = delete) during the runVar strip pass
  // so the caller can persist to chat_variables (see strip-setvar.ts).
  readonly localVarSink?: (name: string, value: string | null) => void;
}

function indexToCharacterAssets(
  index: Readonly<Record<string, AssetIndexEntry>> | undefined,
): CharacterAsset[] {
  if (!index) return [];
  const out: CharacterAsset[] = [];
  for (const [name, entry] of Object.entries(index)) {
    // Risu parser.svelte.ts
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

export function buildEvaluatorContext(input: BuildEvaluatorCtxInput): EvaluatorCtx {
  const { chatId, commit, character: card, chat, variables } = input;
  const persistVars = commit && input.suppressVarPersist !== true;
  // suppressVarPersist passes (the prompt-regex runner) get a throwaway overlay,
  // never the shared module-level map, so any incidental write can't bleed into
  // other chats' state or across pipeline runs in the singleton runner. (In the
  // prompt-regex pass the setvar family is left literal per Risu — see the
  // promptRegexLiteralVars gate below — so this overlay normally stays empty.)
  const overlay = !commit
    ? null
    : input.suppressVarPersist === true
      ? makeEphemeralOverlay()
      : chatId
        ? getOverlay(chatId)
        : null;
  // Temp vars are per-pass scratchpad (Risu cbs.ts). Not persisted;
  // not gated on commit so display-mode settempvar chains work correctly.
  const tempOverlay = new Map<string, string>();

  const envLocal = variables.local ?? {};
  const envGlobal = variables.global ?? {};
  const envChat = variables.chat ?? {};
  const defaults = input.scriptstateDefaults ?? {};

  const recorder = input.recorder;
  const recordMessagesDep = (): void => { if (recorder) recorder.touched.add(MSG_DEP_KEY); };
  const recordRead = recorder
    ? (scope: VarScope, name: string): void => {
        if (scope === "temp") return;
        if (scope === "global") recorder.touched.add(`global:${name}`);
        else {
          recorder.touched.add(`chat:${name}`);
          recorder.touched.add(`local:${name}`);
        }
      }
    : null;

  const vars = {
    get(scope: VarScope, name: string): string {
      if (recordRead) recordRead(scope, name);
      if (scope === "temp") return tempOverlay.get(name) ?? "";
      if (overlay) {
        if (scope === "local" && overlay.local.has(name)) return overlay.local.get(name)!;
        if (scope === "global" && overlay.global.has(name)) return overlay.global.get(name)!;
        if (scope === "local" && overlay.chat.has(name)) return overlay.chat.get(name)!;
      }
      // Risu chatVar.svelte.ts: unset returns "null", not "".
      // Character defaults shadow "null" on local scope.
      if (scope === "global") return envGlobal[name] ?? "null";
      const fromChat = envChat[name];
      if (fromChat !== undefined) return fromChat;
      const fromLocal = envLocal[name];
      if (fromLocal !== undefined) return fromLocal;
      const fromDefaults = defaults[name];
      if (fromDefaults !== undefined) return fromDefaults;
      return "null";
    },
    set(scope: VarScope, name: string, value: string): void {
      if (scope === "temp") { tempOverlay.set(name, value); return; }
      if (!commit || !overlay) return;
      if (scope === "global") {
        overlay.global.set(name, value);
        if (chatId && spindleGlobal && persistVars) {
          try {
            void spindleGlobal.variables.global.set(name, value).catch(() => { /* best-effort */ });
          } catch { /* best-effort */ }
        }
        return;
      }
      // In-prompt setvar is overlay-only. The runVar strip pass is the one path
      // that persists message-text setvar, via localVarSink (see strip-setvar.ts).
      overlay.chat.set(name, value);
      if (input.localVarSink) input.localVarSink(name, value);
    },
    add(scope: VarScope, name: string, delta: number): void {
      if (scope !== "temp" && !commit) return;
      // Risu cbs.ts addvar: raw Number coercion, a missing var ("null") yields "NaN".
      this.set(scope, name, String(Number(this.get(scope, name)) + delta));
    },
    has(scope: VarScope, name: string): boolean {
      if (recordRead) recordRead(scope, name);
      if (scope === "temp") return tempOverlay.has(name);
      if (overlay) {
        if (scope === "local" && (overlay.local.has(name) || overlay.chat.has(name))) return true;
        if (scope === "global" && overlay.global.has(name)) return true;
      }
      if (scope === "global") return Object.prototype.hasOwnProperty.call(envGlobal, name);
      // Character defaults count as "has" on local scope (consistent with get()).
      return Object.prototype.hasOwnProperty.call(envChat, name)
        || Object.prototype.hasOwnProperty.call(envLocal, name)
        || Object.prototype.hasOwnProperty.call(defaults, name);
    },
    delete(scope: VarScope, name: string): void {
      if (scope === "temp") { tempOverlay.delete(name); return; }
      if (!commit) return;
      if (overlay) {
        if (scope === "global") overlay.global.delete(name);
        else { overlay.local.delete(name); overlay.chat.delete(name); }
      }
      if (scope !== "global" && input.localVarSink) input.localVarSink(name, null);
      if (scope === "global" && chatId && spindleGlobal && persistVars) {
        try {
          void spindleGlobal.variables.global.delete(name).catch(() => {});
        } catch { /* best-effort */ }
      }
    },
  };

  // Lumi messageCount includes greeting; Risu doesn't. Shift by 1.
  const messageCount = Math.max(0, Number(chat.messageCount ?? 0) - 1);
  const lastMessage = String(chat.lastMessage ?? "");
  const lastUser = String(chat.lastUserMessage ?? "");
  const lastChar = String(chat.lastCharMessage ?? "");
  // Prefer the full pre-loaded array when the caller supplied it (lumi-hooks
  // pulls from messages-cache). Synthesized lastUser+lastChar is the fallback
  // for chat-wide / bootstrap contexts where the cache is missing.
  const fullMessages = chat.messages;
  const synthesized: Message[] = [];
  if (lastUser) synthesized.push({ role: "user", content: lastUser, createdAt: 0 });
  if (lastChar) synthesized.push({ role: "assistant", content: lastChar, createdAt: 0 });
  if (lastMessage && !synthesized.some((m) => m.content === lastMessage)) {
    synthesized.push({ role: "assistant", content: lastMessage, createdAt: 0 });
  }
  const effective: readonly Message[] = fullMessages ?? synthesized;
  const messages = {
    all: () => { recordMessagesDep(); return effective; },
    last: () => { recordMessagesDep(); return effective[effective.length - 1] ?? null; },
    lastOf: (role: Message["role"]): Message | null => {
      recordMessagesDep();
      for (let i = effective.length - 1; i >= 0; i--) {
        const m = effective[i]!;
        if (m.role === role) return m;
      }
      return null;
    },
    count: (role?: Message["role"]): number => {
      recordMessagesDep();
      if (role === undefined) {
        if (fullMessages) return effective.length;
        return chat.messageCount != null ? messageCount : synthesized.length;
      }
      let n = 0;
      for (const m of effective) if (m.role === role) n++;
      return n;
    },
  };

  const identity = {
    charName: input.charName,
    userName: input.userName,
    personaText: input.personaText ?? "",
    personaName: input.userName,
    personaImage: input.personaImage ?? "",
  };

  const character = {
    description: card.description ?? "",
    personality: card.personality ?? "",
    scenario: card.scenario ?? "",
    exampleDialogue: card.exampleDialogue ?? "",
    mainPrompt: card.mainPrompt ?? "",
    postHistoryInstructions: card.postHistoryInstructions ?? "",
    creatorNotes: card.creatorNotes ?? "",
    jailbreakPrompt: card.jailbreakPrompt ?? "",
    globalNote: card.globalNote ?? "",
    authorsNote: card.authorsNote ?? "",
    firstMessage: card.firstMessage ?? "",
    alternateGreetings: card.alternateGreetings ?? [],
    selectedAlternateGreetingIndex: card.selectedAlternateGreetingIndex ?? -1,
    type: "character" as const,
    additionalAssets: indexToCharacterAssets(card.additionalAssets),
    emotionImages: indexToCharacterAssets(card.emotionImages),
    prebuiltAssetCommand: false,
    prebuiltAssetExclude: [] as readonly string[],
    chaId: input.characterId ?? "",
    image: card.image ?? "",
  };

  const lorebook: readonly LorebookEntry[] = input.lorebook ?? [];

  // Risu creates this table inside each risuChatParser call. Recursive calls
  // share it through parser arguments, but independent templates never do.
  const functions = makeFunctionRegistry();

  const rng = recorder
    ? { random: () => { recorder.volatile = true; return Math.random(); } }
    : { random: () => Math.random() };
  const clock = recorder
    ? { now: () => { recorder.volatile = true; return Date.now(); } }
    : { now: () => Date.now() };

  const out: EvaluatorCtx = {
    vars,
    identity,
    character,
    messages,
    rng,
    clock,
    triggerId: null,
    role: input.currentMessageRoleOverride
      ? normalizeRoleToLumi(input.currentMessageRoleOverride)
      : null,
    functions,
    aiModel: input.system?.model ?? "",
    axModel: "",
    isFirstMessage: Number(chat.messageCount ?? 0) <= 1,
    currentMessageIndex: input.currentMessageIndexOverride !== undefined
      ? Math.max(-1, input.currentMessageIndexOverride)
      : (chat.lastMessageId != null
        ? Math.max(-1, chat.lastMessageId - 1)
        : null),
    lorebook,
    jailbreakToggle: false,
    maxContext: Number(input.system?.maxContext ?? 0),
    language: "",
    appVersion: "",
    // Risu cbs.ts,1375. Backend populates from screen-dims-cache when available.
    screenWidth: Number(input.screenWidth ?? 0),
    screenHeight: Number(input.screenHeight ?? 0),
    commit,
    legacyMediaFindings: input.legacyMediaFindings === true,
    callStack: 0,
    ...(input.modulesByNamespace ? { modulesByNamespace: input.modulesByNamespace } : {}),
    ...(input.positionPt ? { positionPt: input.positionPt } : {}),
    ...(input.cbsContext ? { cbsContext: true } : {}),
    ...(input.rmVar ? { rmVar: true } : {}),
    ...(input.runVar ? { runVar: true } : {}),
    // The prompt-regex pass (suppressVarPersist) leaves the setvar family literal,
    // mirroring Risu's editprocess (no runVar). See RisuRuntimeContext.promptRegexLiteralVars.
    ...(input.suppressVarPersist ? { promptRegexLiteralVars: true } : {}),
  };
  // Late-bound: handlers re-parse field content with the same context.
  // Lazy require dodges the circular dep through dispatch->handlers.
  (out as { evaluate?: (text: string) => string }).evaluate = (text: string) => {
    if (typeof text !== "string" || text.length === 0) return "";
    if (text.indexOf("{{") < 0 && text.indexOf("<") < 0) return text;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { evaluate } = require("./scanner.js") as typeof import("./scanner.js");
    return evaluate(text, out, out.callStack !== undefined ? { callStack: out.callStack } : {});
  };
  return out;
}
