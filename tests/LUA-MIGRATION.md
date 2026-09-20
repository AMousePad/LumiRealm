# Frontend Lua migration

All production Lua execution now runs in the originating browser through Wasmoon
1.16.0. Generation hooks send one complete operation to that document; buttons,
manual triggers and display hooks run locally. Backend prompt regex remains on
the backend. There is no backend Lua fallback.

This is a paired LumiRealm/Lumiverse change. The host must advertise
`frontend-session-routing-v1`, `runtime-state-v1`,
`required-context-handlers-v1` and `required-interceptors-v1`.
Missing capabilities, missing origin, disconnects and required-hook failures
fail explicitly. The new host API declarations are local contracts; publishing
the corresponding SDK and validating installation from a clean clone remain
release work. The draft has been loaded in an isolated test instance; the main
installation is unchanged.

## Risu source and execution semantics

The original oracle is RisuAI `e565563a288ebe4c65b6099a1645ba477d1c84b4`:
[runScripted, runLuaEditTrigger and luaCodeWrapper](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts).
The full wrapper prefix and JSON module are copied from Risu. Source identity,
per-mode serialization, engine replacement, retained display access IDs and
chunk/callback error boundaries follow that implementation. Every eligible
chunk runs, including empty chunks; source text is never used to guess whether
a callback will register. Full JSON round trips remain where Risu performs them.

Direct hooks share live chat and variables across awaits. Structured trigger
frames retain Risu's copied-frame behavior. Identity, CBS, chat history, lore and
variables read browser state; local hash callbacks do not cause backend state
polling. Persistence and genuine host services still cross the host boundary.

[ChatBody.svelte](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/lib/ChatScreens/ChatBody.svelte),
[ParseMarkdown](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/parser/parser.svelte.ts)
and [processScriptFull](https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scripts.ts)
remain the display-order references. The host's outer body cache is retained;
actual resolutions run all Lua chunks, and dependencies and explicit GUI reload
still invalidate. A render's raw bubble is scoped to that invocation rather
than published as stored chat text.

These runtime and display source files are unchanged at current reference
`669b12ceabe1c5066d3dadbe0973f2188d10cc97`. The executable source harness now
checks that revision. Its 52 comparisons pass, including exact wrapper text.

## State and transport contracts

Native host events and atomic state reads carry an epoch and ordered revision.
Pending writes are visible immediately. Per-field revisions prevent old replies
from replacing newer values, and mutation IDs retire only the acknowledged
optimistic writes. Commit events can retire those writes before the service
reply, so a subsequent native edit is visible even when that reply is delayed.
Failed persistence rejects the flush. Reconnect invalidates the old state epoch.

Equal structured state from JSON replies preserves its visible identity and
does not notify again. Reference equality alone made unchanged metadata echoes
invalidate all bodies repeatedly. Tests cover separately cloned commit/reply
payloads and ensure actual nested changes still notify.

Requests bind to the authenticated user and original browser document, including
durable Edit-and-Send replay. Replies from another user/document cannot settle
them. Disconnect, cancellation and teardown reject pending work; late replies
are ignored. Cancellation checks run before queued Lua and after suspended
callbacks. Already issued host effects cannot be undone, and an infinite
synchronous Lua loop cannot be interrupted by this mechanism.

The manifest gives LumiRealm a 30-second interceptor budget. This overrides the
host's 10-second default only for this extension. It provides headroom; it does
not reduce execution time or impose a new Lua semantic shortcut.

## Validation and measured limits

Production-controller tests cover native edits during awaited display hooks,
local state reads and hashes, one variable persistence batch, raw display input,
stale source snapshots, ordered acknowledgements, exact origin matching, host
capability failures and cancellation of individual UI prompts. Host tests cover
native database ownership, transaction revisions, mutation metadata, multiple
tabs, origin propagation, outbox replay and required-hook failure behavior.

The [browser harness](browser/frontend-lua-harness.ts) uses Risu source extracted
from the pinned checkout. Set `RISUAI_DIR` before running it. The
[host display lifecycle harness](browser/display-host-lifecycle-harness.ts)
requires `LUMIVERSE_DIR` and bundles the real host scheduler/cache/compiler with
the extension's production frontend setup. Synthetic fixtures require no cards.

A captured 543,211-character request with 16 eligible Lua chunks was replayed
through the production backend RPC, a real Bun worker and loopback WebSocket,
and the production frontend controller. One warmup and five alternating measured
runs used identical input and chunk order. All outputs matched the original Risu
functions; there were zero state-service calls after bootstrap.

| Browser | LumiRealm operation round trip | Original Risu execution |
| --- | ---: | ---: |
| Chromium 147 | 2,732 ms | 2,607 ms |
| Firefox 148 | 9,505 ms | 9,197 ms |

These are controlled draft measurements, not deployed application timings.
Native state was a fixture; provider calls, full-app contention and surrounding
prompt assembly were excluded. The earlier backend Fengari replay measured
11,569 ms in Bun, which is a different environment and is not a matched browser
speedup comparison. The browser difference also occurs in original Risu code.

A fresh same-process Bun comparison uses baseline `47aadc9`, the upstream
Wasmoon test adapter and Risu's original wrapper, with the same 543,211-character
request and 16 chunks. One warmup and three alternating samples give medians of
4,134 ms, 855 ms and 707 ms respectively; every output matches. This isolates VM
and adapter work. It excludes browser execution, transport and prompt assembly,
and the remaining adapter difference must not be presented as Risu speed parity.

The host display integration passes in Chromium and Firefox with equal output,
settled authored state, zero rendering network calls and all bodies rerun on
explicit GUI reload. It uses mocked store transport and unrelated UI. The
baseline forcibly disables body-cache eligibility to reproduce the earlier
feedback bug; its censored timing is not a shipped-version comparison.

Passing these checks does not establish universal Risu parity. Existing CBS,
message reconciliation, lore/provider and renderer differences remain recorded
in [RISU-PARITY.md](RISU-PARITY.md) and the historical audit below. Selected real
Chrome checks on an isolated native instance cover prompt dry runs, panel
toggles, reload persistence and two-document state delivery. Provider output,
generation cancellation/disconnection and mobile/PWA still need live acceptance.
The Bun test adapter uses upstream Wasmoon. The custom embedded backend build
and its generator have been removed; neither is needed for browser execution.

## Historical audit of the backend Wasmoon draft

The audit below predates the frontend cutover. Its results describe the old two-executor draft, not the current production route. The expected-failure tests remain useful records of adapter gaps, but their legacy fixtures do not establish current frontend behavior.

The follow-up combines complete original `runScripted`/`runLuaEditTrigger` bodies
with the original CBS/parser/chat-variable/arithmetic modules. UI, provider and
storage dependencies remain mocked. It also exercises the production message
adapter and both actual executor loaders in Chromium and Firefox. Baseline
classification below comes from source comparison with `47aadc9`, not a fresh
Fengari execution of every case.

| Boundary | Risu result | Current result | Origin |
| --- | --- | --- | --- |
| Lua `cbs('{{isfirstmsg}}\|{{role}}')` | `0\|null` | Backend `1\|null`; frontend with explicit role `1\|user` | First-message regression introduced; frontend role leakage already existed |
| Change scenario while Lua awaits, then call CBS | New scenario | Prepared old scenario | Introduced by capturing CBS context; identity refresh omits this field |
| Reuse a retained display access ID in backend Lua | Variable write succeeds | Write silently denied | New guards expose the separate executor registries |
| Await local `hash` while an unrelated persona refresh fails | Hash succeeds | Callback aborts | Introduced by generic Promise synchronization |
| Production backend message timestamps | Original timestamp | Adapter drops it; Lua reports zero | Older adapter omission, now exposed by timestamp API additions |
| `setFullChat(id,getFullChat(id))` | Timestamps removed | Existing timestamps retained | Older reconciliation adapter; newly exposed by timestamp reads |
| Change a role or insert a message | Surviving messages retain timestamps | Rebuilt suffix loses them | Older reconciliation adapter |
| Malformed `setFullChatMain` JSON | Callback aborts | Callback continues | Pre-existing |
| `setChat(id,0,42)` then read data type | `number` | `string` | Pre-existing host coercion |

The hash probe used 0, 1 and 64 sequential calls with the same in-memory adapter.
Character/persona/metadata read totals were `(2,1,3)`, `(3,2,4)` and `(66,65,67)`.
Thus 64 local hashes add 192 backend adapter reads. The production adapter maps
each of these to a host call. This is an operation count, not measured IPC latency.
Removing refreshes blindly would reopen the verified stale-identity regressions;
the synchronization boundary needs to satisfy freshness and bounded host work.
Frontend display state has no such synchronizer and adds no rendering IPC.

Risu's retained display IDs are shared across modes. The two-loader probe writes
an ID to a variable during display and later uses it to write another variable in
backend Lua: Risu returns `7`, both browser probes return the unchanged `2`.
A fix must retain operator isolation and permission checks; accepting arbitrary
browser-supplied IDs would not be a valid solution.

Other source-confirmed older adaptations remain: `reloadChat(id,index)` discards
the index and requests a broad refresh, chat persistence catches some failures,
and an empty author note can fall back to the legacy variable mapping. The legacy
note probe returns empty in Risu and the stored fallback in LumiRealm. Provider,
lore activation, complete DOM/CSS behavior and every concurrent navigation case
remain outside this audit's executable coverage.

The [new runtime cases](interpreter/lua-deep-risu-divergence.test.ts) and added
[frontend case](display/lua-risu-divergence.test.ts) contain 11 Risu assertions
marked as known failures. Strict mode reproduces all 11 assertion failures; the
normal parity suite has 72 passing controls and 46 expected failures across 118
examples. These are examples, not independent bug counts or a compatibility score.
The full fast suite passes 3,541 tests including those expected failures. The
whole-tree typecheck reports only the existing ignored `outputOrder` fixture
error. No production implementation changed during this audit.
