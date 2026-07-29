

// Risu parser.svelte.ts matcher() scopes: local=getvar/setvar, global=getglobalvar, temp=tempVar
export type VarScope = "local" | "global" | "temp";

export interface VariableStore {
  get(scope: VarScope, name: string): string;
  set(scope: VarScope, name: string, value: string): void;
  add(scope: VarScope, name: string, delta: number): void;
  has(scope: VarScope, name: string): boolean;
  delete(scope: VarScope, name: string): void;
}


export interface IdentityFields {
  readonly charName: string;
  readonly userName: string;
  readonly personaText: string;
  readonly personaName: string;
  readonly personaImage: string;
}


export interface CharacterFields {
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly exampleDialogue: string;
  readonly mainPrompt: string;
  readonly postHistoryInstructions: string;
  readonly creatorNotes: string;
  readonly jailbreakPrompt: string;
  readonly globalNote: string;
  readonly authorsNote: string;
  readonly firstMessage: string;
  readonly alternateGreetings: readonly string[];
  /** Risu chat.fmIndex. -1 = default firstMessage. */
  readonly selectedAlternateGreetingIndex: number;
  readonly type: "character" | "group";
  readonly additionalAssets: readonly CharacterAsset[];
  readonly emotionImages: readonly CharacterAsset[];
  readonly prebuiltAssetCommand: boolean;
  readonly prebuiltAssetExclude: readonly string[];
  readonly chaId: string;
  readonly image: string;
}

export interface CharacterAsset {
  readonly name: string;
  readonly src: string;
  readonly ext?: string;
}

export interface LorebookEntry {
  readonly key: string;
  readonly secondKey?: string;
  readonly content: string;
  readonly alwaysActive?: boolean;
  /** Other Risu-specific fields round-tripped by `{{lorebook}}`. */
  readonly [k: string]: unknown;
}


export interface Message {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly createdAt: number;
  readonly speaker?: string;
}

export interface MessageHistory {
  all(): readonly Message[];
  last(): Message | null;
  lastOf(role: Message["role"]): Message | null;
  count(role?: Message["role"]): number;
}


export interface RandomSource {
  random(): number;
}

export interface Clock {
  now(): number;
}


export interface RisuRuntimeContext {
  readonly chatId: string;
  readonly vars: VariableStore;
  readonly identity: IdentityFields;
  readonly character: CharacterFields;
  readonly messages: MessageHistory;
  readonly rng: RandomSource;
  readonly clock: Clock;
  readonly triggerId: string | null;
  readonly role: Message["role"] | null;
  readonly functions: FunctionRegistry;
  readonly aiModel: string;
  readonly axModel: string;
  readonly isFirstMessage: boolean;
  readonly currentMessageIndex: number | null;
  readonly lorebook: readonly LorebookEntry[];
  readonly jailbreakToggle: boolean;
  readonly maxContext: number;
  readonly language: string;
  readonly appVersion: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly commit: boolean;
  readonly legacyMediaFindings: boolean;
  readonly modulesByNamespace?: Readonly<Record<string, readonly string[]>>;
  /** Tier 3 lorebook decorator support: per-chat map of `{{position::NAME}}` →
   *  joined content from active entries with `@@position pt_<NAME>` decorator.
   *  Populated at worldInfoInterceptor time and read by the `position` macro
   *  handler in `risu-compat/handlers/display.ts`. Risu source:
   *  index.svelte.ts:575-584 (positionParser pt_* substitution). */
  readonly positionPt?: Readonly<Record<string, string>>;
  /** Set when built for a Lua `cbs(value)` call. Handlers branch to match
   *  Risu output (setvar/asset return literal, chatindex returns "-1"). */
  readonly cbsContext?: boolean;
  /** Set for the inline prompt-regex (editprocess/editinput) pass. Risu's
   *  editprocess runs risuChatParser WITHOUT runVar, so the setvar family
   *  returns null -> the macro is re-emitted LITERAL and never executes */
  readonly promptRegexLiteralVars?: boolean;
  /** Risu matcherArg.rmVar (chat display render): setvar family returns ""
   *  without executing. */
  readonly rmVar?: boolean;
  /** Risu matcherArg.runVar (runCurrentChatFunction): setvar family executes.
   *  Every other pass leaves the macro literal (Risu parity). */
  readonly runVar?: boolean;
  /** Recursive parser entry. Closure over scanner.evaluate, absent on the
   *  IPC fallback path. */
  readonly evaluate?: (text: string) => string;
}

export interface FunctionRegistry {
  define(name: string, body: string, argNames: readonly string[]): void;
  get(name: string): { body: string; argNames: readonly string[] } | null;
  delete(name: string): void;
  has(name: string): boolean;
}

export type MacroHandler = (
  ctx: RisuRuntimeContext,
  args: readonly string[],
  raw: string,
) => string;
