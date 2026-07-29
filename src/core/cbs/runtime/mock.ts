import type {
  RisuRuntimeContext, VariableStore, VarScope, MessageHistory, Message,
  IdentityFields, CharacterFields, RandomSource, Clock, FunctionRegistry,
  LorebookEntry,
} from "./context.js";


export class MockVariableStore implements VariableStore {
  private readonly data: Record<VarScope, Map<string, string>> = {
    local: new Map(),
    global: new Map(),
    temp: new Map(),
  };

  get(scope: VarScope, name: string): string {
    return this.data[scope].get(name) ?? "";
  }
  set(scope: VarScope, name: string, value: string): void {
    this.data[scope].set(name, value);
  }
  add(scope: VarScope, name: string, delta: number): void {
    // Risu cbs.ts addvar: raw Number coercion, non-numeric current yields "NaN".
    this.data[scope].set(name, String(Number(this.data[scope].get(name) ?? "0") + delta));
  }
  has(scope: VarScope, name: string): boolean {
    return this.data[scope].has(name);
  }
  delete(scope: VarScope, name: string): void {
    this.data[scope].delete(name);
  }
}

export class MockMessageHistory implements MessageHistory {
  constructor(private readonly msgs: readonly Message[] = []) {}

  all(): readonly Message[] { return this.msgs; }
  last(): Message | null { return this.msgs[this.msgs.length - 1] ?? null; }
  lastOf(role: Message["role"]): Message | null {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i]!;
      if (m.role === role) return m;
    }
    return null;
  }
  count(role?: Message["role"]): number {
    if (role === undefined) return this.msgs.length;
    let n = 0;
    for (const m of this.msgs) if (m.role === role) n++;
    return n;
  }
}

/** Mulberry32 PRNG — seeded so tests reproduce random-macro output. */
export class SeededRng implements RandomSource {
  private state: number;
  constructor(seed: number = 0x6d2b79f5) { this.state = seed >>> 0; }
  random(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export class FixedClock implements Clock {
  constructor(private readonly t: number) {}
  now(): number { return this.t; }
}

export class MockFunctionRegistry implements FunctionRegistry {
  private readonly table = new Map<string, { body: string; argNames: readonly string[] }>();
  define(name: string, body: string, argNames: readonly string[]): void {
    this.table.set(name, { body, argNames });
  }
  get(name: string): { body: string; argNames: readonly string[] } | null {
    return this.table.get(name) ?? null;
  }
  delete(name: string): void { this.table.delete(name); }
  has(name: string): boolean { return this.table.has(name); }
}

export interface MockContextOptions {
  identity?: Partial<IdentityFields>;
  character?: Partial<CharacterFields>;
  messages?: readonly Message[];
  now?: number;
  rngSeed?: number;
  triggerId?: string | null;
  role?: Message["role"] | null;
  aiModel?: string;
  axModel?: string;
  isFirstMessage?: boolean;
  currentMessageIndex?: number | null;
  lorebook?: readonly LorebookEntry[];
  jailbreakToggle?: boolean;
  maxContext?: number;
  language?: string;
  appVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  commit?: boolean;
  legacyMediaFindings?: boolean;
  cbsContext?: boolean;
  rmVar?: boolean;
  runVar?: boolean;
}

const DEFAULT_IDENTITY: IdentityFields = {
  charName: "Alice",
  userName: "Bob",
  personaText: "",
  personaName: "",
  personaImage: "",
};

const DEFAULT_CHARACTER: CharacterFields = {
  description: "",
  personality: "",
  scenario: "",
  exampleDialogue: "",
  mainPrompt: "",
  postHistoryInstructions: "",
  creatorNotes: "",
  jailbreakPrompt: "",
  globalNote: "",
  authorsNote: "",
  firstMessage: "",
  alternateGreetings: [],
  selectedAlternateGreetingIndex: -1,
  type: "character",
  additionalAssets: [],
  emotionImages: [],
  prebuiltAssetCommand: false,
  prebuiltAssetExclude: [],
  chaId: "",
  image: "",
};

export function makeMockContext(opts: MockContextOptions = {}): RisuRuntimeContext {
  return {
    vars: new MockVariableStore(),
    identity: { ...DEFAULT_IDENTITY, ...opts.identity },
    character: { ...DEFAULT_CHARACTER, ...opts.character },
    messages: new MockMessageHistory(opts.messages ?? []),
    rng: new SeededRng(opts.rngSeed),
    clock: new FixedClock(opts.now ?? 1_700_000_000_000),
    triggerId: opts.triggerId ?? null,
    role: opts.role ?? null,
    functions: new MockFunctionRegistry(),
    aiModel: opts.aiModel ?? "",
    axModel: opts.axModel ?? "",
    isFirstMessage: opts.isFirstMessage ?? false,
    currentMessageIndex: opts.currentMessageIndex ?? null,
    lorebook: opts.lorebook ?? [],
    jailbreakToggle: opts.jailbreakToggle ?? false,
    maxContext: opts.maxContext ?? 4096,
    language: opts.language ?? "en-US",
    appVersion: opts.appVersion ?? "0.0.0",
    screenWidth: opts.screenWidth ?? 0,
    screenHeight: opts.screenHeight ?? 0,
    commit: opts.commit ?? true,
    legacyMediaFindings: opts.legacyMediaFindings ?? false,
    ...(opts.cbsContext ? { cbsContext: true } : {}),
    ...(opts.rmVar ? { rmVar: true } : {}),
    ...(opts.runVar ? { runVar: true } : {}),
  };
}
