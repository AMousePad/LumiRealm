import { describe, test, expect, beforeEach } from "bun:test";
import { createLifecycleEventHandlers, type LifecycleEventHandlerDeps } from "../../src/events/lifecycle.js";

interface CallLog {
  refresh: string[];
  invalidate: string[];
}

function makeDeps(log: CallLog): LifecycleEventHandlerDeps {
  return {
    captureUserId: () => {},
    extractIds: (raw) => {
      const r = raw as { chatId?: string; characterId?: string; chat?: { id?: string } };
      return {
        chatId: r.chatId ?? r.chat?.id ?? null,
        characterId: r.characterId ?? null,
      };
    },
    dumpPayload: () => "{}",
    recompileDerivedPayload: async () => {},
    activeCardByChat: new Map(),
    lastActiveChatByUser: new Map(),
    lastSentBgHtmlByChat: new Map(),
    compiledByCharacter: new Map(),
    worldBookIdsByCharacter: new Map(),
    variableState: { clearChat: () => {} },
    toggleState: { clearChat: () => {} },
    ensureActiveCardForChat: async () => null,
    invalidateActiveForCharacter: () => {},
    invalidateRenderMcpForChat: () => {},
    invalidateRenderMcpForMessage: () => {},
    invalidateMacroInterceptorForChat: () => {},
    invalidateListenEditPreload: () => {},
    refreshMessagesCache: async (chatId) => { log.refresh.push(chatId); },
    invalidateMessagesCache: (chatId) => { log.invalidate.push(chatId); },
    clearActiveAssetIndexes: () => {},
    clearActiveCharacterImage: () => {},
    clearActiveScriptstateDefaults: () => {},
    clearActiveLorebook: () => {},
    clearVarOverlay: () => {},
    refreshPersonaImage: async () => {},
    refreshBgHtml: async () => {},
    refreshVariables: async () => {},
    refreshToggleDefinitions: async () => {},
    runBinding: async () => ({ stopSending: false }),
    runMessageVarPass: async () => {},
    generationEndedBindings: [],
    consumeOwnChatChange: () => false,
    consumeOwnCharacterEdit: () => false,
    consumeIfOurWrite: () => false,
    send: () => {},
    sendSetActiveChat: () => {},
    setChatStyleMode: () => {},
    listCards: async () => [],
    pushCards: () => {},
    deleteCardByChar: async () => {},
    journalStorage: () => ({} as unknown as ReturnType<LifecycleEventHandlerDeps["journalStorage"]>),
    readImageJournalFile: async () => null,
    clearImageJournal: async () => {},
    buildLiveImageIdSet: async () => ({ liveIds: new Set<string>() }),
    buildOrphanDetectDepsExcluding: () => ({} as unknown as ReturnType<LifecycleEventHandlerDeps["buildOrphanDetectDepsExcluding"]>),
    deleteImageIds: async () => ({ deleted: 0, absent: 0, failed: 0 }),
    emitOperationProgress: () => {},
    chatsGet: async () => null,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    errMsg: (e) => String(e),
  };
}

let log: CallLog;
let handlers: ReturnType<typeof createLifecycleEventHandlers>;

beforeEach(() => {
  log = { refresh: [], invalidate: [] };
  handlers = createLifecycleEventHandlers(makeDeps(log));
});

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("lifecycle — messages-cache wiring", () => {
  test("MESSAGE_SENT triggers refreshMessagesCache(chatId)", async () => {
    await handlers.MESSAGE_SENT({ chatId: "c1" }, "u1");
    await settle();
    expect(log.refresh).toEqual(["c1"]);
    expect(log.invalidate).toEqual([]);
  });

  test("MESSAGE_EDITED triggers refreshMessagesCache(chatId)", async () => {
    await handlers.MESSAGE_EDITED({ chatId: "c1", message: { id: "m1", content: "x" } }, "u1");
    await settle();
    expect(log.refresh).toEqual(["c1"]);
  });

  test("MESSAGE_DELETED triggers refreshMessagesCache(chatId)", async () => {
    await handlers.MESSAGE_DELETED({ chatId: "c1", messageId: "m1" }, "u1");
    await settle();
    expect(log.refresh).toEqual(["c1"]);
  });

  test("MESSAGE_SWIPED triggers refreshMessagesCache(chatId)", async () => {
    await handlers.MESSAGE_SWIPED({ chatId: "c1", message: { id: "m1" }, action: "swipe_add" }, "u1");
    await settle();
    expect(log.refresh).toEqual(["c1"]);
  });

  test("GENERATION_ENDED triggers refreshMessagesCache(chatId) — but only when active card present, fall back gracefully if not", async () => {
    await handlers.GENERATION_ENDED({ chatId: "c1" }, "u1");
    await settle();
    expect(log.refresh).toEqual([]);
  });

  test("CHAT_SWITCHED triggers refreshMessagesCache when active card resolves", async () => {
    const depsWithActive = makeDeps(log);
    (depsWithActive as { ensureActiveCardForChat: typeof depsWithActive.ensureActiveCardForChat }).ensureActiveCardForChat
      = async () => ({ card: { character_id: "ch1", risuPayload: {} } } as unknown as Awaited<ReturnType<typeof depsWithActive.ensureActiveCardForChat>>);
    const h = createLifecycleEventHandlers(depsWithActive);
    await h.CHAT_SWITCHED({ chatId: "c1" }, "u1");
    await settle();
    expect(log.refresh).toEqual(["c1"]);
  });

  test("CHAT_DELETED triggers invalidateMessagesCache(chatId)", async () => {
    await handlers.CHAT_DELETED({ chatId: "c1" }, "u1");
    await settle();
    expect(log.invalidate).toEqual(["c1"]);
    expect(log.refresh).toEqual([]);
  });

  test("MESSAGE_SENT with missing chatId is a no-op", async () => {
    await handlers.MESSAGE_SENT({}, "u1");
    await settle();
    expect(log.refresh).toEqual([]);
    expect(log.invalidate).toEqual([]);
  });
});

describe("lifecycle — world-book mutation burst coalescing", () => {
  test("N rapid WORLD_BOOK_ENTRY_CHANGED events collapse to ONE trailing invalidation", async () => {
    const invalidated: string[] = [];
    const deps = makeDeps(log);
    deps.activeCardByChat.set("c1", {
      card: { character_id: "ch1", risuPayload: {} },
      ownerUserId: "u1",
    } as never);
    (deps as { invalidateActiveForCharacter: (cid: string, uid: string | undefined) => void }).invalidateActiveForCharacter
      = (cid) => { invalidated.push(cid); };
    const h = createLifecycleEventHandlers(deps);

    for (let i = 0; i < 50; i++) {
      await h.WORLD_BOOK_ENTRY_CHANGED({ id: `e${i}`, worldBookId: "wb1" }, "u1");
    }
    // Inside the debounce window nothing fires.
    expect(invalidated).toEqual([]);
    await new Promise((r) => setTimeout(r, 700));
    expect(invalidated).toEqual(["ch1"]);
  });
});

describe("lifecycle — persona change refresh", () => {
  interface PersonaLog {
    imageRefreshes: string[];
    varRefreshes: { chatId: string; force: boolean }[];
    bgRefreshes: string[];
    mcpInvalidates: string[];
  }

  function makePersonaDeps(plog: PersonaLog, opts: { risuActive: boolean }): LifecycleEventHandlerDeps {
    const deps = makeDeps(log);
    deps.lastActiveChatByUser.set("u1", "c1");
    const fakeActive = { card: { character_id: "ch1", risuPayload: {} }, ownerUserId: "u1" };
    const mutable = deps as {
      refreshPersonaImage: LifecycleEventHandlerDeps["refreshPersonaImage"];
      ensureActiveCardForChat: LifecycleEventHandlerDeps["ensureActiveCardForChat"];
      refreshVariables: LifecycleEventHandlerDeps["refreshVariables"];
      refreshBgHtml: LifecycleEventHandlerDeps["refreshBgHtml"];
      invalidateRenderMcpForChat: LifecycleEventHandlerDeps["invalidateRenderMcpForChat"];
    };
    mutable.refreshPersonaImage = async (userId) => { plog.imageRefreshes.push(userId); };
    mutable.ensureActiveCardForChat = async () =>
      (opts.risuActive ? fakeActive : null) as Awaited<ReturnType<LifecycleEventHandlerDeps["ensureActiveCardForChat"]>>;
    mutable.refreshVariables = async (_a, chatId, _u, o) => {
      plog.varRefreshes.push({ chatId, force: !!o?.force });
    };
    mutable.refreshBgHtml = async (_a, chatId) => { plog.bgRefreshes.push(chatId); };
    mutable.invalidateRenderMcpForChat = (chatId) => { plog.mcpInvalidates.push(chatId); };
    return deps;
  }

  const DEBOUNCE_SETTLE_MS = 400;

  test("SETTINGS_UPDATED activePersonaId force-refreshes the active Risu chat", async () => {
    const plog: PersonaLog = { imageRefreshes: [], varRefreshes: [], bgRefreshes: [], mcpInvalidates: [] };
    const h = createLifecycleEventHandlers(makePersonaDeps(plog, { risuActive: true }));
    await h.SETTINGS_UPDATED({ key: "activePersonaId", value: "p2" }, "u1");
    expect(plog.varRefreshes).toEqual([]);
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));
    expect(plog.imageRefreshes).toEqual(["u1"]);
    expect(plog.mcpInvalidates).toEqual(["c1"]);
    expect(plog.varRefreshes).toEqual([{ chatId: "c1", force: true }]);
    expect(plog.bgRefreshes).toEqual(["c1"]);
  });

  test("batch settings put (keys[]) also triggers the refresh", async () => {
    const plog: PersonaLog = { imageRefreshes: [], varRefreshes: [], bgRefreshes: [], mcpInvalidates: [] };
    const h = createLifecycleEventHandlers(makePersonaDeps(plog, { risuActive: true }));
    await h.SETTINGS_UPDATED({ keys: ["theme", "activePersonaId"] }, "u1");
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));
    expect(plog.varRefreshes).toEqual([{ chatId: "c1", force: true }]);
  });

  test("PERSONA_CHANGED bursts coalesce to one refresh", async () => {
    const plog: PersonaLog = { imageRefreshes: [], varRefreshes: [], bgRefreshes: [], mcpInvalidates: [] };
    const h = createLifecycleEventHandlers(makePersonaDeps(plog, { risuActive: true }));
    for (let i = 0; i < 10; i++) await h.PERSONA_CHANGED({ id: `p${i}` }, "u1");
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));
    expect(plog.varRefreshes).toEqual([{ chatId: "c1", force: true }]);
  });

  test("vanilla active chat: persona image cache refreshes, chat is untouched", async () => {
    const plog: PersonaLog = { imageRefreshes: [], varRefreshes: [], bgRefreshes: [], mcpInvalidates: [] };
    const h = createLifecycleEventHandlers(makePersonaDeps(plog, { risuActive: false }));
    await h.PERSONA_CHANGED({ id: "p1" }, "u1");
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));
    expect(plog.imageRefreshes).toEqual(["u1"]);
    expect(plog.varRefreshes).toEqual([]);
    expect(plog.bgRefreshes).toEqual([]);
    expect(plog.mcpInvalidates).toEqual([]);
  });

  test("other settings keys do not schedule a refresh", async () => {
    const plog: PersonaLog = { imageRefreshes: [], varRefreshes: [], bgRefreshes: [], mcpInvalidates: [] };
    const h = createLifecycleEventHandlers(makePersonaDeps(plog, { risuActive: true }));
    await h.SETTINGS_UPDATED({ key: "theme", value: "dark" }, "u1");
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));
    expect(plog.imageRefreshes).toEqual([]);
    expect(plog.varRefreshes).toEqual([]);
  });
});
