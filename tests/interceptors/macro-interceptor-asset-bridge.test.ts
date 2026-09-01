import { afterEach, describe, expect, test } from "bun:test";
import {
  createLumiInterceptors,
  type CreateLumiInterceptorsDeps,
} from "../../src/interceptors/lumi-hooks.js";
import {
  resetAllAssetIndexes,
  setActiveAssetIndexes,
} from "../../src/interpreter/asset-cache.js";
import type { ActiveCard } from "../../src/interpreter/dispatch.js";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "../../src/state/settings-store.js";

type MacroInterceptorHandler = Parameters<SpindleAPI["registerMacroInterceptor"]>[0];

const CHAT_ID = "macro-interceptor-asset-chat";
const CHARACTER_ID = "macro-interceptor-asset-character";
const USER_ID = "macro-interceptor-asset-user";

function activeCard(): ActiveCard {
  return {
    chatId: CHAT_ID,
    ownerUserId: USER_ID,
    characterWorldBookIds: [],
    card: {
      character_id: CHARACTER_ID,
      asset_index: {},
      emotion_index: {},
      regex_scripts: [],
      risuPayload: {
        scriptstate_defaults: {},
        triggers: [],
        lua_scripts: [],
        at_actions: [],
        extra: {},
      },
    },
  } as unknown as ActiveCard;
}

function deps(active: ActiveCard): CreateLumiInterceptorsDeps {
  return {
    activeCardByChat: new Map([[CHAT_ID, active]]),
    captureUserId: () => undefined,
    isFeDisplayAuthoritative: () => false,
    isPromptRegexAuthoritative: () => false,
    dispatchPromptRegex: async (_prebuilt, _scripts, messages) => ({
      ok: false,
      changed: false,
      messages,
    }),
    ensureActiveCardForChat: async () => active,
    getCachedSettingsSync: () => DEFAULT_SETTINGS,
    modulesByNamespaceFromCard: () => null,
    resolveReadonly: async (template) => template,
    resolveReadonlyMany: async (templates) => templates,
    runMessageVarPass: async () => undefined,
    runBinding: async () => ({ stopSending: false }),
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      trace: () => undefined,
      debug: () => undefined,
    },
    errMsg: (error) => error instanceof Error ? error.message : String(error),
  };
}

afterEach(() => {
  resetAllAssetIndexes();
  delete (globalThis as { spindle?: unknown }).spindle;
});

describe("MacroInterceptor asset resolution without MacroRegistry registration", () => {
  test("resolves a raw asset macro through the in-worker evaluator", async () => {
    let macroInterceptor: MacroInterceptorHandler | null = null;
    (globalThis as { spindle?: unknown }).spindle = {
      registerMacroInterceptor(handler: MacroInterceptorHandler) {
        macroInterceptor = handler;
      },
      registerMessageContentProcessor() {},
      registerInterceptor() {},
      registerWorldInfoInterceptor() {},
      registerContextHandler() {},
      // Deliberately no registerMacro API: this test exercises only the current
      // whole-template MacroInterceptor path.
    };

    setActiveAssetIndexes(CHAT_ID, {
      assets: {
        pixel: { imageIds: ["image-asset-1"], ext: "png" },
      },
      emotions: {},
    });

    createLumiInterceptors(deps(activeCard())).registerAll();
    expect(macroInterceptor).not.toBeNull();

    const result = await macroInterceptor!({
      template: "{{path::pixel}}",
      env: {
        commit: true,
        names: { user: "User", char: "Character" },
        character: { name: "Character", firstMessage: "", alternateGreetings: [] },
        chat: { id: CHAT_ID, messageCount: 1, lastMessageId: 0, greetingIndex: 0 },
        system: {},
        variables: { local: {}, global: {}, chat: {} },
        dynamicMacros: {},
        extra: {},
      },
      commit: true,
      phase: "prompt",
      userId: USER_ID,
    });

    expect(result).toEqual({
      text: "/api/v1/images/image-asset-1",
      touchedVars: [],
      volatile: false,
    });
  });
});
