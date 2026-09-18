# Lua and CBS divergence tests

These synthetic tests assert RisuAI behavior at revision `e565563a288ebe4c65b6099a1645ba477d1c84b4`. They require neither character cards nor a Risu checkout. They document outstanding differences, not fixes.

```powershell
bun test risu-divergence
```

Known differences use `test.failing`: their Risu-correct assertions execute, and an unexpected pass fails the suite until the marker is removed. Passing controls use ordinary tests. To see the actual failing assertions:

```powershell
$env:RISU_PARITY_STRICT = '1'
try { bun test risu-divergence } finally { Remove-Item Env:RISU_PARITY_STRICT }
```

After caller-path verification, the result is **29 passing controls and 76 failing examples across 105 tests**. Examples share root causes; this is not a count of independent bugs or a compatibility percentage.

| Suite | Tests | Known differences | Passing controls |
| --- | ---: | ---: | ---: |
| [CBS](interpreter/cbs-risu-divergence.test.ts) | 39 | 26 | 13 |
| [Lua APIs](interpreter/lua-api-risu-divergence.test.ts) | 34 | 28 | 6 |
| [Hook chains](interpreter/listen-edit-risu-divergence.test.ts) | 11 | 7 | 4 |
| [Frontend boundaries](display/lua-risu-divergence.test.ts) | 6 | 4 | 2 |
| [Fengari execution](interpreter/lua-engine-risu-divergence.test.ts) | 15 | 11 | 4 |

## Risu source grounding

- [CBS callbacks](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/cbs.ts) and [risuChatParser](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/parser.svelte.ts): all 39 expectations were independently rechecked using full original parser/CBS/chat-variable/arithmetic module bodies with equivalent fixtures. Cases identify the exact source location and parser mode. This includes Risu quirks such as timestamp scaling and counted `cbr`.
- [runScripted](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L52): API expectations were initially checked against original `declareAPI` callbacks, then reviewed through full original runScripted, permission issuance and Lua wrappers in actual Wasmoon. Host dependencies remain mocked. Permanent API tests call production Lumi callbacks directly; they do not themselves run the public Lua wrappers.
- [runLuaEditTrigger](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1409), [runScripted callback handling](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1055), and [shared chat variables](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/chatVar.svelte.ts): between trigger scripts, nil retains prior input and later scripts read current shared variables. Within one script, a nil return reaches the next listener as nil and variable writes are visible in both products. Chunk compilation errors restore original chain text and skip later scripts without rolling back earlier side effects; callback errors preserve prior output and allow the chain to continue. Hook tests execute real Lumi runtime factories and Fengari, with an in-memory host. The editRequest fixture is a message array.
- [Display access IDs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L1058), [setChat](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L194), [cbs](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L274), and [identity getters](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts#L651): frontend tests use the actual local snapshot adapter/resolver. The cbs comparison occurs inside Lua, before the outer display parser can obscure premature expansion. These fast tests use Fengari; the earlier browser reproduction also confirmed the same boundaries with Wasmoon.

The suites isolate host storage, provider responses and VM behavior deliberately. They do not boot the full Risu application or send live provider requests. Lore tests establish return shapes/filtering and the incorrect upsert destination, not full activation budgets or every upsert option. Model multimodal/streaming handling, provider error variants, chat-local global overrides, model metadata, media loading and editInput storage timing remain outside these permanent regression examples.

## Caller-path qualifications

- CBS assertions describe the specified parser pass. Risu later parses display text again: a variable containing `{{char}}` can display identically despite differing intermediate results. Deeper nesting still diverges. Risu asset processing also removes unresolved `source` markers; that parser-stage difference is not a final display defect. Position markers require separate display and prompt checks.
- Risu's public `loadLoreBooks(id)` does not forward a reserve argument. Its upstream lore activation budget applies, but only a direct `loadLoreBooksMain(id, reserve)` call applies the additional reserve cap. Denied public `loadLoreBooks`, `LLM` and `axLLM` calls raise decoder errors in Risu; their Main callbacks return undefined. The API tests assert the latter boundary.
- Risu `simpleLLM` returns a JS object exposed as Lua userdata with readable success/result fields. Returned provider failures produce failure objects; thrown request errors can reject in both products. The permanent test checks only the host callback's success object.
- Async false is a VM return-value test. Risu's [start caller](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/index.svelte.ts#L884) consumes stopSending; its input/output/button callers ignore that flag. Real onStart probes confirm the cancellation difference. An onOutput flag difference alone does not demonstrate cancellation.

## Comparing the actual engines

```powershell
bunx playwright install chromium
bun tests/browser/lua-engine-risu-harness.ts
```

This offline browser harness runs the same 15 scenarios through real Fengari, the current Lumi Wasmoon executor, and exact excerpts of Risu's Lua wrapper in Wasmoon. It checks the JSON library hash. Set `RISUAI_DIR` to a checkout to verify wrapper excerpts against source, and optionally `LUA_ENGINE_RESULTS` to write JSON results. `RISU_PARITY_STRICT=1` makes all engine mismatches fail the harness.

Risu matches all 15 expectations. Fengari differs in 11 scenarios; current Lumi Wasmoon differs in four. Wasmoon matches eight scenarios where Fengari diverges: Lua version, integer range, persistent globals, async values, async false, caught promise rejection, first-return selection and top-level CBS. These are sampled scenarios, not eight independent defects. Both local engines retain invalid-state-JSON and missing-wrapper differences; current Wasmoon also fails a plain callback calling our asynchronous cbs wrapper where Risu and Fengari succeed. Full runScripted probes confirm that failure when forcing Wasmoon for plain onStart/button callbacks; async callbacks and normal editDisplay succeed. This is a migration constraint, since those plain backend callbacks currently use Fengari.

These findings support consolidating on Wasmoon for Lua compatibility, after fixing wrapper and integration differences. Merely replacing the VM does not fix shared hook snapshots, host API contracts or the TypeScript CBS parser. Risu keeps one last source per mode: uninterrupted same-source execution preserves globals even across chat changes, but an intervening different source resets them. Matching that policy requires mode keys, source-change resets and serialized execution; neither a fresh VM per invocation nor one persistent VM per card matches it.

Wasmoon 1.16.0 runs in standalone Bun. Our current `executeWasmoon` uses a browser-oriented embedded data URI that fails as a filesystem path under Windows Bun, so it is not yet a backend drop-in. Backend packaging and worker integration need validation. No speed or memory benchmark is claimed, and these tests do not establish that changing engines fixes display rerender lag.
