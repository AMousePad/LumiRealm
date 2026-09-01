# Contributing to LumiRealm

LumiRealm is a [Lumiverse](https://github.com/Prolix-OC/Lumiverse) extension that runs RisuAI character cards (`.charx`), modules (`.risum`), and their CBS macros, Lua triggers, display regex, and lorebooks inside the Lumiverse host. RisuAI's behavior is the specification: when in doubt, the answer is "what does RisuAI do?", not "what seems reasonable?".

Thank you for considering a contribution. Please read this document before opening a pull request; PRs that clearly ignore this will be closed.

## Table of contents

- [Contributing to LumiRealm](#contributing-to-lumirealm)
  - [Table of contents](#table-of-contents)
  - [Setting up the dev environment](#setting-up-the-dev-environment)
  - [Build](#build)
  - [Tests](#tests)
    - [Card library (optional, for data-driven tests)](#card-library-optional-for-data-driven-tests)
  - [Deploying to a Lumiverse instance](#deploying-to-a-lumiverse-instance)
  - [Pull request guidelines](#pull-request-guidelines)
  - [RisuAI parity](#risuai-parity)
  - [Performance changes](#performance-changes)
  - [Use of AI coding tools](#use-of-ai-coding-tools)
  - [Code conventions](#code-conventions)
  - [Repo layout](#repo-layout)
  - [Legal](#legal)

## Setting up the dev environment

Requirements:

- [Bun](https://bun.sh) 1.x — build, tests, and tooling all run on Bun.
- Required: a [Lumiverse](https://github.com/Prolix-OC/Lumiverse) checkout, to deploy and live-test the extension.
- Optional: a [RisuAI](https://github.com/kwaroran/RisuAI) checkout, required when touching core pipeline behavior (see [parity](#risuai-parity-is-non-negotiable)) and for the handler-parity gate (`RISUAI_DIR`).

```bash
git clone <your fork>
cd LumiRealm
bun install
```

## Build

```bash
bun run build
```

This typechecks, bundles `src/backend.ts` / `src/regex-runner.ts` / `src/frontend.ts` into `dist/`, applies sandbox-compatibility patches, and runs a static safety check mirroring the host's dangerous-capability scan. `dist/` is committed: Lumiverse installs from the committed bundles, so commits that change `src/` must include the rebuilt `dist/`.

## Tests

```bash
bun run test            # fast suite (excludes *.slow.test.ts) — must pass before every PR
bun run test:slow       # corpus sweeps; need a populated card library
bun run test:all        # everything
bun run test:parallel   # fast suite on all cores
```

Tests live under `tests/`, organized to mirror `src/` (`tests/core`, `tests/interpreter`, `tests/state`, `tests/display`, ...).

**Every change needs a test.** If the change is a bug fix, the test must fail without the fix and pass with it. State this in the PR description and make it easy to verify (e.g. name the test and the commit where it starts passing).

### Card library (optional, for data-driven tests)

`tests/local_library/` is an empty, gitignored folder. Some tests browse this folder for charx cards. Please populate this library with a wide range of cards so you can better guarentee no regression. Do not write new tests that depend on this path.

## Deploying to a Lumiverse instance

```bash
bun run deploy
```

The destination resolves from, in order: the `-Dest` parameter, the `LUMIVERSE_DIR` environment variable (`<dir>/data/extensions/lumirealm/repo`), or a `.deploy-dest` file at the repo root containing the destination path. Restart the extension and hard-refresh the browser tab.

## Pull request guidelines

- **One PR, one fix.** A PR targets a single fix or a single narrowly-scoped feature. Scope creep is avoided at all costs. If you noticed a second problem while working, open a second PR.
- **Minimize lines changed and blast radius.** Prefer the smallest diff that correctly solves the problem. Drive-by refactors, formatting churn, and "while I was here" edits will get the PR rejected regardless of the core change's merit.
- **Large PRs need justification.** If a PR is large, the description must explain why it cannot be broken into separate PRs. "It was all one session" is not a justification.
- **Linear history.** Commit history must be linear; rebase your branch onto the target before opening or updating the PR. No merge commits, self-reverts, broken-up commits for a feature/fix inside a PR.
- **Clear commits.** Single-line conventional messages (`fix(display): repaint owned bubbles on reloadDisplay`). Each commit should build and make sense on its own; squash fixups before review.
- **Describe why.** The PR description states the problem, the root cause, the approach, and how it was tested, in plain language. Do not AI generate this and pass it through without human review and rewording so the maintainers can understand it.
- **Tests are required.** See [Tests](#tests). Non-trivial changes without tests will not be merged.
- **Fixes and performance changes need depth.** Think through and document edge cases, trade-offs, and possible regressions. A fix that trades one failure mode for another must describe this explicitly.

## RisuAI parity

LumiRealm's job is to run RisuAI content faithfully. All changes must not diverge from RisuAI behavior.

- If you are fixing or changing anything in the core pipeline (CBS evaluation, trigger dispatch, Lua runtime surface, display regex application, lorebook activation semantics), **clone the RisuAI repo and cross-check the implementation against the Risu source before writing code.** Cite the Risu function you matched in the PR description (e.g. "matches Risu's `processScriptFull` ordering in file `x`").
- Deliberate divergences (host limitations, security posture) must be documented as such in the PR and in a short code comment at the divergence point.
- The handler-parity gate can catch stub regressions: `RISUAI_DIR=<risu checkout> bun tools/audit-handler-parity.ts`.

## Performance changes

All performance changes must be benchmarked **before and after**, with the numbers and methodology in the PR description. If a PR contains multiple independent performance changes, include a separate benchmark for each one, so each can be evaluated (and reverted) on its own. Performance claims without measurements will be treated as unsubstantiated.

## Use of AI coding tools

AI assistance is welcome. You are responsible for all lines you submit and must understand it. Do not pass an AI change without understanding it and its implications.

- A large, AI-generated, multi-scope PR will be rejected on the spot.
- All the rules above (single scope, minimal LOC, tests, parity cross-check, benchmarks) apply with no AI exception.
- See [AGENTS.md](AGENTS.md) for the instructions we give coding agents working in this repo; human contributors using agents should hold their output to the same rules.

## Code conventions

- **Don't invent.** Runtime semantics mirror RisuAI. Name the Risu function you ported in the commit or comment (`Risu's runLuaEditTrigger`).
- **Dry comments.** Default to no comment. Keep comments to 1-2 sentences carrying a constraint, invariant, or gotcha. Do not comment the plain code.
- **No private references.** Comments, test names, and log strings must not contain absolute machine paths, references to private documentation, or the names of specific third-party character cards.
- **Loud failures.** No silent `return ""` stubs, no warn-and-continue for failures.

## Repo layout

- `src/`: extension source. `backend.ts` (Spindle worker) and `frontend.ts` are the entry points.
- `tests/`: bun:test suite, mirrors `src/` by area; `tests/local_library/` is the optional gitignored card mount.
- `scripts/`: build patching, safety check, deploy, test runners.

## Legal

LumiRealm is licensed GPL-3.0-or-later (it ports substantial semantics from GPLv3 RisuAI). By contributing you agree your contribution is licensed under the same terms.
