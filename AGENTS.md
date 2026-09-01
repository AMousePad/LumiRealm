# Agent instructions for LumiRealm

Instructions for AI coding agents working in this repository. You must also follow[CONTRIBUTING.md](CONTRIBUTING.md).

All changes must be run through YAGNI+SOLID+DRY+KISS principles and only what passes should be kept. Enforce this before every commit. Most commits, you'll find you built too much shit and have to delete most of it.

Do not scope creep at any cost.

## What this project is

A Lumiverse extension that runs RisuAI character cards and modules (CBS macros, Lua triggers, display regex, lorebooks) inside the Lumiverse host. **RisuAI's behavior is the oracle.** Correctness means that it matches what RisuAI does.

## Commands

```bash
bun install             # setup
bun run build           # typecheck + bundles into dist/ + sandbox patches + safety check
bun run test            # fast suite; must pass before any commit
bun run test:slow       # corpus sweeps; no-op without tests/local_library data
bun run typecheck:all   # whole-tree typecheck including tests
```

`dist/` is committed. Any change to `src/` must be followed by `bun run build` and the rebuilt `dist/` included in the same commit.

## Rules

1. **Single scope.** One change per branch/PR: a single fix or one narrowly-scoped feature. Do not bundle large refactors, formatting, or unrelated improvements with a fix. Large multi-scope changes are rejected on the spot. Minimize lines changed and blast radius.
2. **RisuAI parity.** Never change core pipeline behavior (CBS evaluation, trigger dispatch, Lua runtime, display regex, lorebook activation) without reading the corresponding RisuAI source and matching it. Reference the Risu function you matched (`Risu's processScriptFull`) in the commit/PR text. Deliberate divergences must be flagged as such where they occur and well-motivated. Ask the user to clone the RisuAI repo if it doesn't exist.
3. **Tests are mandatory.** Every change ships with a test. Bug-fix tests must fail without the fix and pass with it. Place tests under `tests/<area>/` mirroring `src/<area>/`. Tests must run on a clean clone: any card-data dependency goes through `tests/helpers/local-library.ts` and must no-op when `tests/local_library/` is empty.
4. **Benchmarks for performance work.** Every performance change needs before/after numbers with methodology. Multiple performance changes in one PR each need their own benchmark.
5. **Consider the failure modes.** For fixes and performance changes, reason explicitly about edge cases, trade-offs, and regressions before finishing, and record the conclusions in the PR description.
6. **Linear history, clear commits.** Rebase; never merge-commit inside a branch. Single-line conventional commit messages (`fix(display): ...`). No reverts. Each commit should contain an individually reviewable portion and should NOT be stretched across multiple commits.
7. **No private references.** Comments, test names, and log strings must never contain absolute machine paths, private documentation references, or names of specific third-party character cards. Comments are 1-2 sentences, state the why (constraint, invariant, gotcha), and default to absent. No em dashes in comments or log strings. No explaining the code below.
8. **Loud failures.** Unsupported surfaces throw typed errors. Never add silent fallbacks, `return ""` stubs, or warn-and-continue paths for failures. Silent errors are the bane of tracability.
9. **Never commit card data.** `tests/local_library/` contents and any `.charx`/`.risum` files stay out. Do not write new tests that depend on this path.

## Layout

- `src/core/` translator (charx reader, mappers, triggers compiler) · `src/interpreter/` CBS evaluator + Lua runtime + dispatch · `src/risu-compat/` CBS macro handlers · `src/display/` frontend display resolver · `src/state/` stores and caches · `src/bghtml/` background-HTML pipeline · `src/ui/` drawer panels · `src/payload/` import pipeline.
- Discipline gates: `bun test tests/risu-compat/registry.test.ts` (handler/catalog alignment), `RISUAI_DIR=<risu checkout> bun tools/audit-handler-parity.ts` (stub detection; skips without the env var).
