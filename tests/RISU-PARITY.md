# Lua and CBS divergence tests

The tables include legacy runtime fixtures and the upstream Wasmoon test adapter.
Production Lua now uses the browser controller described in
[LUA-MIGRATION.md](LUA-MIGRATION.md). These expected failures are not a measurement
of that controller's current behavior or proof of complete production parity.

These synthetic tests assert RisuAI behavior at revision `e565563a288ebe4c65b6099a1645ba477d1c84b4`. They require neither character cards nor a Risu checkout. They retain known differences and regression tests for corrected behavior. See [the Wasmoon migration report](LUA-MIGRATION.md) for source boundaries, validation and benchmarks.

```powershell
bun test risu-divergence
```

Known differences use `test.failing`: their Risu-correct assertions execute, and an unexpected pass fails the suite until the marker is removed. Passing controls use ordinary tests. To see the actual failing assertions:

```powershell
$env:RISU_PARITY_STRICT = '1'
try { bun test risu-divergence } finally { Remove-Item Env:RISU_PARITY_STRICT }
```

The current result is **97 passing examples and 21 known differences across 118 tests**. Examples share root causes; this is not a count of independent bugs or a compatibility percentage.

| Suite | Tests | Known differences | Passing controls |
| --- | ---: | ---: | ---: |
| [CBS](interpreter/cbs-risu-divergence.test.ts) | 39 | 5 | 34 |
| [Lua APIs](interpreter/lua-api-risu-divergence.test.ts) | 34 | 8 | 26 |
| [Hook chains](interpreter/listen-edit-risu-divergence.test.ts) | 11 | 0 | 11 |
| [Frontend boundaries](display/lua-risu-divergence.test.ts) | 9 | 0 | 9 |
| [Wasmoon execution](interpreter/lua-engine-risu-divergence.test.ts) | 15 | 0 | 15 |
| [Runtime and adapter boundaries](interpreter/lua-deep-risu-divergence.test.ts) | 10 | 8 | 2 |

## Risu source grounding

- Named trigger dispatch follows `runTrigger` and `runScripted`: leading Lua bypasses declared/compiled binding types, named calls preserve source order and conditions, and nested calls resolve Lua names absent from trigger comments. `tests/frontend-lua/frontend.test.ts` covers cache refresh after variable changes, later Lua effects, reserved modes, missing callbacks and aborts through the production frontend adapter. `risu-btn` retains the separate live-state behavior of `runLuaButtonTrigger`.
- [CBS callbacks](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/cbs.ts) and [risuChatParser](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/parser.svelte.ts): all 39 expectations were independently rechecked using full original parser/CBS/chat-variable/arithmetic module bodies with equivalent fixtures. Cases identify the exact source location and parser mode. This includes Risu quirks such as timestamp scaling and counted `cbr`.
- [runScripted](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L52): API expectations were initially checked against original `declareAPI` callbacks, then reviewed through full original runScripted, permission issuance and Lua wrappers in actual Wasmoon. Host dependencies remain mocked. Permanent API tests call production Lumi callbacks directly; they do not themselves run the public Lua wrappers.
- [runLuaEditTrigger](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1409), [runScripted callback handling](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1055), and [shared chat variables](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/chatVar.svelte.ts): between trigger scripts, nil retains prior input and later scripts read current shared variables. Within one script, a nil return reaches the next listener as nil and variable writes are visible in both products. Chunk compilation errors restore original chain text and skip later scripts without rolling back earlier side effects; callback errors preserve prior output and allow the chain to continue. Hook tests execute real Lumi runtime factories and Wasmoon, with an in-memory host. The editRequest fixture is a message array.
- [Display access IDs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1058), [setChat](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L194), [cbs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L274), and [identity getters](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L651): frontend tests use the actual local snapshot adapter/resolver. The cbs comparison occurs inside Lua, before the outer display parser can obscure premature expansion. These fast tests use upstream Wasmoon with its native loader; the browser harness exercises the production browser loader and frontend resolver.

The suites isolate host storage, provider responses and VM behavior deliberately. They do not boot the full Risu application or send live provider requests. Lore tests establish return shapes/filtering and the incorrect upsert destination, not full activation budgets or every upsert option. Model multimodal/streaming handling, provider error variants, chat-local global overrides, model metadata, media loading and editInput storage timing remain outside these permanent regression examples.

## Caller-path qualifications

- CBS assertions describe the specified parser pass. Risu later parses display text again: a variable containing `{{char}}` can display identically despite differing intermediate results. Deeper nesting still diverges. Risu asset processing also removes unresolved `source` markers; that parser-stage difference is not a final display defect. Position markers require separate display and prompt checks.
- Risu's public `loadLoreBooks(id)` does not forward a reserve argument. Its upstream lore activation budget applies, but only a direct `loadLoreBooksMain(id, reserve)` call applies the additional reserve cap. Denied public `loadLoreBooks`, `LLM` and `axLLM` calls raise decoder errors in Risu; their Main callbacks return undefined. The API tests assert the latter boundary.
- Risu `simpleLLM` returns a JS object exposed as Lua userdata with readable success/result fields. Tests cover the callback and actual Lua reads, empty/Unicode content, denied access, and thrown requests aborting the callback. Returned provider failure variants remain outside the host's content-only response contract.
- Async false is a VM return-value test. Risu's [start caller](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/index.svelte.ts#L884) consumes stopSending; its input/output/button callers ignore that flag. Real onStart probes confirm the cancellation difference. An onOutput flag difference alone does not demonstrate cancellation.

## Comparing the actual engines

```powershell
bunx playwright install chromium
bun tests/browser/lua-engine-risu-harness.ts
```

This offline browser harness runs the same 15 scenarios through the production browser Wasmoon loader and exact excerpts of Risu's wrapper. All 15 now match. It checks the JSON library hash; set `RISUAI_DIR` to verify the excerpts against a checkout, `LUA_ENGINE_RESULTS` to save JSON results, and `LUA_BROWSER=firefox` to run Firefox. It also checks the actual frontend resolver on an HTTP origin and rejects rendering network requests.

The migration closes the original engine and edit-chain examples, but the deeper audit adds failures in CBS context, state freshness, separate executor access IDs, Promise synchronization and message adapters. Direct callback tests bypass engine permission guards, so their four low-access differences do not describe the public Lua path. The [migration report](LUA-MIGRATION.md#deeper-parity-audit) separates introduced regressions, older adapters, and unverified surfaces. A green normal run includes expected failures; strict mode exposes them.
