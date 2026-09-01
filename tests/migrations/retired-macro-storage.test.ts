import { describe, expect, test } from "bun:test";
import { EMPTY_MIGRATION_STATE } from "../../src/migrations/state.js";

interface Harness {
  readonly spindle: Record<string, unknown>;
  readonly data: Record<string, unknown>;
  readonly characterUpdates: Array<Record<string, unknown>>;
  readonly regexUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  readonly messageUpdates: Array<{
    chatId: string;
    messageId: string;
    patch: Record<string, unknown>;
  }>;
  readonly envelopeWrites: Array<Record<string, unknown>>;
}

function harness(options: { failStandalone?: boolean } = {}): Harness {
  const characterUpdates: Array<Record<string, unknown>> = [];
  const regexUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const messageUpdates: Harness["messageUpdates"] = [];
  const envelopeWrites: Array<Record<string, unknown>> = [];
  const data: Record<string, unknown> = {
    "lumirealm/migration-state.json": {
      ...EMPTY_MIGRATION_STATE,
      // The earlier incomplete rollout marker must not suppress v2.
      macros_unprefixed: true,
    },
  };
  const regexRows = [
    {
      id: "card-regex",
      scope: "character",
      scope_id: "char-1",
      find_regex: "{{risu_abs::-1}}",
      replace_string: "{{risu_upper::x}}",
      metadata: { _risu: { origin: "character" } },
    },
    {
      id: "standalone-global",
      scope: "global",
      scope_id: null,
      find_regex: "{{risu_lower::X}}",
      replace_string: "{{risu_max::1::2}}",
      metadata: { _risu: { imported_regex: true } },
    },
  ];
  const messages = [
    {
      id: "greeting",
      role: "assistant",
      content: "{{risu_getvar::phase}}",
      swipes: ["{{risu_getvar::phase}}", "{{risu_random::a,b}}"],
    },
    {
      id: "user",
      role: "user",
      content: "{{risu_custom::authored}}",
      swipes: [],
    },
  ];

  return {
    data,
    characterUpdates,
    regexUpdates,
    messageUpdates,
    envelopeWrites,
    spindle: {
      userStorage: {
        async getJson(path: string) {
          return data[path];
        },
        async setJson(path: string, value: unknown) {
          data[path] = value;
        },
      },
      characters: {
        async get() {
          return {
            id: "char-1",
            description: "{{risu_description}}",
            alternate_greetings: ["{{risu_upper::alt}}"],
          };
        },
        async update(_id: string, patch: Record<string, unknown>) {
          characterUpdates.push(patch);
        },
      },
      regex_scripts: {
        async list(opts: {
          scope?: string;
          scopeId?: string;
          offset?: number;
          limit?: number;
        }) {
          const filtered = opts.scope
            ? regexRows.filter(
                (row) => row.scope === opts.scope && row.scope_id === opts.scopeId,
              )
            : regexRows;
          const offset = opts.offset ?? 0;
          const limit = opts.limit ?? filtered.length;
          return { data: filtered.slice(offset, offset + limit), total: filtered.length };
        },
        async update(id: string, patch: Record<string, unknown>) {
          if (options.failStandalone && id === "standalone-global") {
            throw new Error("standalone update failed");
          }
          regexUpdates.push({ id, patch });
        },
      },
      chats: {
        async list(opts: { offset?: number }) {
          return opts.offset
            ? { data: [], total: 1 }
            : { data: [{ id: "chat-1" }], total: 1 };
        },
      },
      chat: {
        async getMessages() {
          return messages;
        },
        async updateMessage(
          chatId: string,
          messageId: string,
          patch: Record<string, unknown>,
        ) {
          messageUpdates.push({ chatId, messageId, patch });
        },
      },
    },
  };
}

function envelope() {
  return {
    schema_version: 1,
    payload: {
      background_html: "{{risu_lower::BG}}",
      background_html_source: "{{risu_upper::bg}}",
    },
    regex_scripts: [
      {
        find_regex: "{{risu_abs::-2}}",
        replace_string: "{{risu_upper::sidecar}}",
      },
    ],
  } as never;
}

async function runnerFor(h: Harness) {
  (globalThis as { spindle?: unknown }).spindle = h.spindle;
  const { createMassMigrationsRunner } = await import(
    "../../src/migrations/mass.js"
  );
  const storedEnvelope = envelope();
  return createMassMigrationsRunner({
    currentCharacterSchemaVersion: 1,
    currentModuleSchemaVersion: 1,
    translatorMigrationChecked: new Set(),
    getMissingPermissions: () => [],
    moduleStorage: () => ({}) as never,
    listModules: async () => [],
    readModuleEnvelope: async () => null,
    listLumirealmCharacters: async () => [
      {
        character: { id: "char-1", name: "Card" },
        data: storedEnvelope,
      },
    ],
    writeLumirealm: async (_userId, _characterId, next) => {
      h.envelopeWrites.push(next as unknown as Record<string, unknown>);
    },
    runModuleMigration: async () => ({ ok: true }),
    runCharacterMigration: async () => "noop" as const,
    emitOperationProgress: () => {},
    toastFor: () => {},
    log: { info: () => {}, warn: () => {} },
    errMsg: (error) => String(error),
  });
}

describe("retired macro storage migration", () => {
  test("migrates every translator-owned surface and advances the v2 marker", async () => {
    const h = harness();
    const runner = await runnerFor(h);
    await runner.runRetiredMacroMigrationIfNeeded("user-1");

    expect(h.characterUpdates).toEqual([
      {
        description: "{{description}}",
        alternate_greetings: ["{{upper::alt}}"],
      },
    ]);
    expect(h.regexUpdates).toContainEqual({
      id: "card-regex",
      patch: {
        find_regex: "{{abs::-1}}",
        replace_string: "{{upper::x}}",
      },
    });
    expect(h.regexUpdates).toContainEqual({
      id: "standalone-global",
      patch: {
        find_regex: "{{lower::X}}",
        replace_string: "{{max::1::2}}",
      },
    });
    expect(h.messageUpdates).toEqual([
      {
        chatId: "chat-1",
        messageId: "greeting",
        patch: {
          content: "{{getvar::phase}}",
          swipes: ["{{getvar::phase}}", "{{random::a,b}}"],
        },
      },
    ]);
    expect(h.envelopeWrites).toHaveLength(1);
    const written = h.envelopeWrites[0] as {
      payload: { background_html: string; background_html_source: string };
      regex_scripts: Array<{ find_regex: string; replace_string: string }>;
    };
    expect(written.payload).toMatchObject({
      background_html: "{{lower::BG}}",
      background_html_source: "{{upper::bg}}",
    });
    expect(written.regex_scripts[0]).toMatchObject({
      find_regex: "{{abs::-2}}",
      replace_string: "{{upper::sidecar}}",
    });
    expect(
      (
        h.data["lumirealm/migration-state.json"] as {
          retired_macro_projection_migrated_v2?: boolean;
        }
      ).retired_macro_projection_migrated_v2,
    ).toBe(true);
  });

  test("does not mark the migration complete when an owned row fails", async () => {
    const h = harness({ failStandalone: true });
    const runner = await runnerFor(h);
    await runner.runRetiredMacroMigrationIfNeeded("user-2");

    expect(
      (
        h.data["lumirealm/migration-state.json"] as {
          retired_macro_projection_migrated_v2?: boolean;
        }
      ).retired_macro_projection_migrated_v2,
    ).toBe(false);
  });
});
