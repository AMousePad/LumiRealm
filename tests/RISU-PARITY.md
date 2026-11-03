# Lua and CBS divergence tests

These suites cover callback, interpreter and current frontend runtime boundaries.
Production Lua uses the browser controller described in [LUA-MIGRATION.md](LUA-MIGRATION.md).
The frontend tests execute its real state, host adapter and Wasmoon executor with fixture transport;
they do not establish live browser, provider or complete application parity.

These synthetic tests assert RisuAI behavior at revision `e565563a288ebe4c65b6099a1645ba477d1c84b4`. They require neither character cards nor a Risu checkout. They retain known differences and regression tests for corrected behavior. See [the Wasmoon migration report](LUA-MIGRATION.md) for source boundaries, validation and benchmarks.

```powershell
$parityTests = @(
  './tests/interpreter/cbs-risu-divergence.test.ts',
  './tests/interpreter/lua-api-risu-divergence.test.ts',
  './tests/interpreter/listen-edit-risu-divergence.test.ts',
  './tests/display/lua-risu-divergence.test.ts',
  './tests/interpreter/lua-engine-risu-divergence.test.ts',
  './tests/interpreter/lua-deep-risu-divergence.test.ts',
  './tests/frontend-lua/runtime-parity.test.ts'
)
bun test $parityTests
```

All current cases use ordinary passing assertions. The CBS harness retains strict-mode support for future known differences; strict mode must also pass:

```powershell
$env:RISU_PARITY_STRICT = '1'
try { bun test $parityTests } finally { Remove-Item Env:RISU_PARITY_STRICT }
```

The current strict result is **122 passing examples, zero failures and zero expected failures**. Examples share root causes; this is not a count of independent bugs or a compatibility percentage.

| Suite | Tests | Known differences | Passing controls |
| --- | ---: | ---: | ---: |
| [CBS](interpreter/cbs-risu-divergence.test.ts) | 39 | 0 | 39 |
| [Lua APIs](interpreter/lua-api-risu-divergence.test.ts) | 36 | 0 | 36 |
| [Hook chains](interpreter/listen-edit-risu-divergence.test.ts) | 11 | 0 | 11 |
| [Frontend boundaries](display/lua-risu-divergence.test.ts) | 9 | 0 | 9 |
| [Wasmoon execution](interpreter/lua-engine-risu-divergence.test.ts) | 15 | 0 | 15 |
| [Runtime and adapter boundaries](interpreter/lua-deep-risu-divergence.test.ts) | 6 | 0 | 6 |
| [Current frontend lifecycle](frontend-lua/runtime-parity.test.ts) | 6 | 0 | 6 |

The current frontend cases replace four obsolete expected failures: backend identity refresh around hashing, a captured scenario, a milliseconds-as-seconds fixture, and an artificial pair of executors. They verify zero unrelated host calls, native updates during suspension, timestamp conversion, and retained access IDs with permission controls. Separate [message placement](frontend-lua/message-placement.test.ts), [replacement timestamp](frontend-lua/full-chat-time.test.ts), and [raw message data](frontend-lua/message-data.test.ts) tests cover acknowledgement and reload. Ordinary string edits assert one state publication across native acknowledgement.

## Risu source grounding

- Named trigger dispatch follows `runTrigger` and `runScripted`: leading Lua bypasses declared/compiled binding types, named calls preserve source order and conditions, and nested calls resolve Lua names absent from trigger comments. `tests/frontend-lua/frontend.test.ts` covers cache refresh after variable changes, later Lua effects, reserved modes, missing callbacks and aborts through the production frontend adapter. `risu-btn` retains the separate live-state behavior of `runLuaButtonTrigger`.
- [CBS callbacks](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/cbs.ts) and [risuChatParser](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/parser.svelte.ts): all 39 expectations were independently rechecked using full original parser/CBS/chat-variable/arithmetic module bodies with equivalent fixtures. Cases identify the exact source location and parser mode. This includes Risu quirks such as timestamp scaling and counted `cbr`.
- [runScripted](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L52): API expectations were initially checked against original `declareAPI` callbacks, then reviewed through full original runScripted, permission issuance and Lua wrappers in actual Wasmoon. Host dependencies remain mocked. Permanent API tests call production Lumi callbacks directly; they do not themselves run the public Lua wrappers.
- [runLuaEditTrigger](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1409), [runScripted callback handling](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1055), and [shared chat variables](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/chatVar.svelte.ts): between trigger scripts, nil retains prior input and later scripts read current shared variables. Within one script, a nil return reaches the next listener as nil and variable writes are visible in both products. Chunk compilation errors restore original chain text and skip later scripts without rolling back earlier side effects; callback errors preserve prior output and allow the chain to continue. Hook tests execute real Lumi runtime factories and Wasmoon, with an in-memory host. The editRequest fixture is a message array.
- [Display access IDs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1058), [setChat](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L194), [cbs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L274), and [identity getters](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L651): frontend tests use the actual local snapshot adapter/resolver. The cbs comparison occurs inside Lua, before the outer display parser can obscure premature expansion. These fast tests use upstream Wasmoon with its native loader; the browser harness exercises the production browser loader and frontend resolver.

The suites isolate host storage, provider responses and VM behavior deliberately. They do not boot the full Risu application or send live provider requests. Lore tests cover return shapes, chat-local mutation and the resolved native activation adapter. Model multimodal/streaming handling, provider error variants, chat-local global overrides, model metadata, media loading and every editInput storage timing remain outside these permanent regression examples.

## Caller-path qualifications

- CBS assertions describe the specified parser pass. Returned macro text stays literal for that pass; explicit field/function parsing and the existing later display pass retain their own semantics. Position markers require separate display and prompt checks.
- Risu's public `loadLoreBooks(id)` does not forward a reserve argument. Its upstream lore activation budget applies, but only a direct `loadLoreBooksMain(id, reserve)` call applies the additional reserve cap. Denied public `loadLoreBooks`, `LLM` and `axLLM` calls raise decoder errors in Risu; their Main callbacks return undefined. The API tests assert the latter boundary.
- Risu `simpleLLM` returns a JS object exposed as Lua userdata with readable success/result fields. Tests cover the callback and actual Lua reads, empty/Unicode content, denied access, and thrown requests aborting the callback. Returned provider failure variants remain outside the host's content-only response contract.
- Async false is a VM return-value test. Risu's [start caller](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/index.svelte.ts#L884) consumes stopSending; its input/output/button callers ignore that flag. Real onStart probes confirm the cancellation difference. An onOutput flag difference alone does not demonstrate cancellation.

## Comparing the actual engines

```powershell
bunx playwright install chromium
bun tests/browser/lua-engine-risu-harness.ts
```

This offline browser harness runs the same 15 scenarios through the production browser Wasmoon loader and exact excerpts of Risu's wrapper. All 15 now match. It checks the JSON library hash; set `RISUAI_DIR` to verify the excerpts against a checkout, `LUA_ENGINE_RESULTS` to save JSON results, and `LUA_BROWSER=firefox` to run Firefox. It also checks the actual frontend resolver on an HTTP origin and rejects rendering network requests.

Direct callback tests bypass engine permission guards; the frontend tests separately exercise issued and forged access IDs. The [historical migration audit](LUA-MIGRATION.md#historical-audit-of-the-backend-wasmoon-draft) records the retired backend draft. Its old failure counts are not current results; both normal and strict runs of the listed suites now pass without expected failures.
