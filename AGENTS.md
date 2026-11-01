# AGENTS.md — PromptBr0

Guidance for AI coding agents working in this repository. Assumes no prior
knowledge of the project.

**Contents**

- [Project overview](#project-overview)
- [Architecture & Repositories](#architecture--repositories)
- [Build, test, and dev commands](#build-test-and-dev-commands)
- [Commit message convention](#commit-message-convention)
- [Code style guidelines](#code-style-guidelines)
- [Documentation verification (Ref MCP)](#documentation-verification-ref-mcp)
- [Testing instructions](#testing-instructions)
- [Database, concurrency, and environment](#database-concurrency-and-environment)
- [Agent integration rules](#agent-integration-rules-agents-propose-humans-approve)
- [Multi-device sync rules](#multi-device-sync-rules)
- [Security considerations](#security-considerations)
- [Packaging and release notes](#packaging-and-release-notes)

> **Maintaining this file:** when editing AGENTS.md, verify that the table of
> contents above stays in sync — every `##` section must have a TOC entry, and
> the TOC order must match the document order.

## Project overview

PromptBr0 is a cross-platform (macOS-first), local-first desktop app for
managing, versioning and evolving AI prompts — part prompt library, part
version-control system. The product and all pnpm workspace packages use the
unified **`@promptbr0/*`** namespace (`@promptbr0/core`,
`@promptbr0/ai`,
`@promptbr0/cli`, `@promptbr0/desktop`).

Key features:

- Prompt CRUD with soft delete, branches, version-bound drafts, editable active
  versions, and append-new per-branch sequential versions (with change notes
  and a preferred "current" pointer).
- Tags, collections, starred prompts, filters/sort, FTS5 search (⌘K), History
  and Notes tabs, JSON import/export, automatic local backups.
- Evaluation: 1–5 four-dimension ratings, a run log (Results tab), diff
  view for any two versions, "duplicate as variation" branching.
- Agent integration (see below): a CLI over the same core;
  agents propose, humans approve.
- AI integration: a models.dev-backed provider catalog (OpenAI, Anthropic,
  Google, OpenAI-compatible endpoints) with safeStorage-encrypted API keys,
  streaming multi-model runs (up to 6 models concurrently) with token/cost
  tracking, an LLM judge, side-by-side run compare and an evaluation summary.
- Multi-device sync: peer-to-peer over the local network (no server, no
  accounts). Devices pair via a short code verified against a self-signed
  certificate fingerprint, discover each other via mDNS, and exchange
  incremental record-level ops over mutually-pinned TLS with deterministic
  merges (HLC last-writer-wins per record; independently created rows union).

The root `README.md` and everything under `docs/` are **user-facing product
documentation** (installation, setup, configuration, usage, supported
features, troubleshooting). They must never reference internal development
material: this file, `docs-internal/`, or dev-only workflows (CI, signing,
packaging internals). The architecture description lives in this file.
User-facing docs live in `docs/` (see `docs/SUMMARY.md`); design specs and
implementation plans live in `docs-internal/` (`specs/`, `plans/`).

## Architecture & Repositories

Everything lives in this repository — the client, the agent surface, and the
core domain, as a pnpm workspace:

- `apps/desktop` — Electron + React desktop application (`@promptbr0/desktop`)
- `apps/cli` — `promptbr0` CLI (`@promptbr0/cli`, bundled to
  `apps/cli/dist/index.js`; the npm packages are not published yet)
- `packages/core` — SQLite database, migrations, sync engine (`@promptbr0/core`)
- `packages/ai` — Multi-model runner and LLM judge (`@promptbr0/ai`)

Git remotes: `origin` is the sole configured remote and fetches/pushes
`git@github.com:jackblackjack/promptbr0.git`.

Package responsibilities:

- `packages/core` owns **all** domain logic. SQLite via `better-sqlite3`
  (plain SQL, **no ORM**), with a versioned forward-only migration runner
  (`user_version` pragma, automatic pre-migration backup for on-disk
  databases). Also: prompts/versions/branches/notes/tags/collections/ratings/
  runs, FTS5 search (porter tokenizer, bm25 ranking,
  prefix queries), lossless JSON export/import with id remapping on
  collisions, and `resolveDatabasePath()` for the shared DB path. Main entry
  points: `src/library.ts` (`PromptLibrary`), `src/db.ts`,
  `src/migrations.ts`, `src/schema.ts`, `src/resolve.ts`. The
  transport-agnostic sync engine lives in `src/sync/` (`engine.ts` =
  refine/apply/serve, `hlc.ts` = hybrid logical clock, `tables.ts` = the
  synced-table registry that also generates migration v6's dirty-capture
  triggers); zero Electron deps, zero runtime dependencies beyond
  `better-sqlite3`.
- `packages/ai` is a zero-Electron LLM layer over the Vercel AI SDK: provider
  registry (one entry per provider; a provider's `type` is its models.dev
  catalog id, its `driver` picks execution — openai/anthropic/google natively,
  everything else through `@ai-sdk/openai-compatible`), models.dev catalog
  fetching/parsing (the package deliberately does not cache — callers own
  persistence/staleness, so the app stores it in the settings table), prompt
  execution and cost estimation, AI prompt assist (`src/assist.ts`) and the
  LLM judge (`src/judge.ts`, `src/judge-average.ts`).
- `apps/desktop` is a thin Electron shell:
  - `src/main/` — main process (`index.ts`, `ai.ts`,
    `deep-link.ts`); exposes `packages/core` and `packages/ai` over a
    **Zod-validated typed IPC** surface (`src/shared/ipc.ts` +
    `src/shared/channels.ts`); `{{variable}}` substitution happens here
    before each run; API keys are encrypted with Electron `safeStorage` and
    only decrypted inside the main process. `src/main/sync/` is the P2P
    transport: `identity.ts` (self-signed cert, fingerprint-derived pairing
    code), `frames.ts`/`messages.ts` (wire protocol), `session.ts`
    (hello-driven anti-entropy over any Duplex), `pairing.ts`,
    `peers-service.ts` (pinned-TLS listener, mDNS via `bonjour-service`,
    reconnect backoff) and `service.ts` (`DesktopSync` coordinator bridging
    to IPC/renderer events). `src/main/tray.ts` owns the optional system tray
    (close-to-tray, Show/Quit menu in the current UI language; the preference
    and language are device-local settings).
  - `src/preload/` — `contextBridge` wrapper implementing the typed
    `PromptBr0Api` exposed to the renderer as `window.promptbr0`.
  - `src/renderer/` — React 19 + Tailwind v4 + Radix UI + CodeMirror 6 +
    TanStack Query. Pure UI; renderer code must never touch Node/Electron APIs
    directly — go through the preload API (`window.promptbr0` bridge,
    mocked in tests via `src/renderer/src/test/mock-bridge.ts`).
- `apps/cli` (`src/index.ts`, single file) — CLI tool surface for shell
  pipelines, plus human-only `suggest`/`suggestions` agent commands. Bundled
  with esbuild to `dist/index.js`.

## Build, test, and dev commands

Package manager is **pnpm 11.7.0** (pinned via `packageManager` in the root
`package.json`). Workspace is declared in `pnpm-workspace.yaml`
(`apps/*`, `packages/*`); native-module build scripts are gated there via
`allowBuilds` (`better-sqlite3`, `electron`, `esbuild` allowed).

```sh
pnpm install                                # install everything
pnpm test                                   # all vitest suites (core + ai + desktop + cli)
pnpm typecheck                              # strict TS in every package (pnpm -r typecheck)
pnpm build                                  # pnpm -r build
pnpm dev                                    # run the Electron app in dev mode
pnpm --filter @promptbr0/desktop dev    # same, explicit
pnpm --filter @promptbr0/desktop build  # production build of main/preload/renderer
pnpm --filter @promptbr0/desktop icons  # regenerate build/ icons (icns/ico/png) from scratch
pnpm --filter @promptbr0/desktop dist   # package installers into apps/desktop/dist/
pnpm --filter @promptbr0/cli build      # build the CLI to apps/cli/dist/
```

To run one suite: `pnpm --filter @promptbr0/core test` (or `ai`,
`desktop`, `cli`). Note that the CLI `test` script runs
`pnpm build` first because its tests exercise the built `dist/index.js`.

Node: CI runs on Node 22; local development on Node 26 also works
(`better-sqlite3` loads under both without a rebuild). The CLI esbuild
bundles target Node 22.

Quality gates and CI (`.github/workflows/`):

- `main` is the only long-lived branch. Feature work happens on short-lived
  branches that open pull requests directly against `main`; maintainers may
  commit small changes straight to `main`.
- `ci.yml` runs the license check, typecheck, tests and build on pushes to
  `main` and pull requests targeting `main` (macos-latest, Node 22, `pnpm
  install --frozen-lockfile`). The `npm-package-smoke` matrix packs and
  exercises the workspace packages on the six supported OS/architecture
  targets.
- `release-installers.yml` builds the desktop installers for a `v*` tag (or a
  manual dispatch) on Linux, Windows and macOS runners, verifies each packaged
  architecture, and keeps the canonical files as workflow artifacts. It does
  not sign, tag, publish or create a GitHub Release.
- GitHub Actions never creates branches, publishes npm packages, creates tags,
  or creates GitHub Releases. Publication is manual; follow
  `docs-internal/RELEASING.md`.
- The `apps/cli` workspace entry point must be
  published with pnpm. Their `workspace:*` dependencies are rewritten only by
  pnpm's pack/publish path; source-directory `npm pack`/`npm publish` is
  guarded and must not be used.

## Commit message convention

History uses **gitmoji + Conventional Commits**, e.g.
`🐛 fix(core): survive ops arriving before their FK parents`,
`🐣 feat(desktop): wire P2P sync into the app`, `📝 docs: …`,
`⚡ perf(sync): …`, `💄 style(desktop): …`, `🔧 chore(license): …`.
Match that format: emoji, `type(scope): subject`.

## Code style guidelines

- **TypeScript, ESM everywhere** (`"type": "module"` in every package).
  Shared `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`,
  `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `noEmit`. Respect
  these — e.g. `noUncheckedIndexedAccess` means indexed access yields
  `T | undefined`.
- Internal imports use **`.js` suffixes** on TypeScript paths
  (`import ... from "./library.js"`) — required by NodeNext-style resolution
  for the Node-side builds.
- There is no ESLint/Prettier config; formatting is by convention (2-space
  indent, double quotes, semicolons, ~100-column prose wrapping in comments
  and docs). Match the surrounding file.
- Keep the layering rule: **`packages/core` and `packages/ai` must stay free
  of Electron (and DOM) dependencies**; `apps/desktop` main/preload adapt
  core to IPC; the renderer is pure UI.
- All cross-process data goes through the Zod schemas in
  `apps/desktop/src/shared/ipc.ts` — when adding an IPC surface, add a
  channel in `src/shared/channels.ts` (zod-free: the sandboxed preload cannot
  import zod) + schema + preload method + `ipcMain.handle` registration in
  `src/main/index.ts` (`registerIpcHandlers`); never send raw rows without a
  mapper (`apps/desktop/src/main/mappers.ts`).
- SQLite migrations are **forward-only and append-only**: add a new numbered
  migration in `packages/core/src/migrations.ts`; never edit an
  already-shipped migration. The runner backs up on-disk DBs before migrating
  automatically. (Currently at v18: v8 adds exact run prompt snapshots, v9
  replaces composite-key sync triggers with delimiter-safe record keys, v10
  makes prompt hard-delete tombstones durable, v11 canonicalizes natural-key
  sync, v12 revokes stale model-catalog credential trust, v13 binds drafts to
  their exact saved base version, v14 adds sync-history and rating lookup
  indexes, v15 maintains incremental search row mappings, v16 repairs
  version-bound draft columns left absent by an earlier version marker, v17
  turns collections into a folder hierarchy, and v18 drops the retired
  sharing table.)
- Comments in the codebase explain *why*, not what; match that density and
  tone (see `packages/core/src/db.ts` / `paths.ts` for the house style).
- Theming: CSS custom properties (`--pb-*`) in
  `apps/desktop/src/renderer/src/index.css`; dark is the `:root` default,
  light overrides under `[data-theme="light"]`.

## Documentation verification (Ref MCP)

When implementing or changing external library/framework/API usage, verify
the relevant behavior with Ref MCP against the project's dependency version.
Use `ref_search_documentation`, then `ref_read_url` when more detail is
needed. Do not guess APIs or silently apply documentation for a different
version. Skip Ref for purely local changes; reuse documentation already
retrieved. If verification is unavailable, state the uncertainty.

## Testing instructions

- Framework: **Vitest 4** in every package; config in each package's
  `vitest.config.ts`.
- `packages/core` and `packages/ai`: node environment,
  tests in `tests/` (`*.test.ts`). Core tests use `openMemoryDatabase()`
  (in-memory SQLite with migrations applied) — no temp files needed. The
  sync engine's twin-library suite (`tests/sync-engine.test.ts`) drives two
  engines over a fake in-memory transport: concurrent edits, LWW, name
  collisions, tombstones, transitive gossip, idempotency, tiny budgets,
  order-independent convergence.
- `apps/desktop`: node by default; React component tests use
  `// @vitest-environment jsdom` at the top of the file plus Testing Library.
  Test files live next to the code they cover (e.g.
  `src/renderer/src/components/main-pane.test.tsx`,
  `src/renderer/src/lib/diff.test.ts`, `src/main/ai.test.ts`). The preload
  bridge is mocked via `src/renderer/src/test/mock-bridge.ts`
  (`installMockBridge()`); shared setup in
  `src/renderer/src/test/setup.ts` (wired through `vitest.config.ts`);
  `src/renderer/src/test/render.tsx` is the render harness (jest-dom
  matchers, provider wrapper, jsdom polyfills). Sync transport tests live in
  `src/main/sync/`: in-memory stream-pair sessions plus real-TLS loopback
  pairing tests (identity, frames, session, peers-service, DesktopSync
  coordinator).
- `apps/cli`: smoke/integration tests
  (`apps/cli/tests/cli.test.ts`)
  that spawn the **built** binary against a scratch database via `PROMPTBR0_DB`;
  `testTimeout: 30_000` and the `test` script builds first.
- Do not weaken existing tests when refactoring; update call sites, not
  expectations, unless behavior genuinely changed.

## Database, concurrency, and environment

- The desktop app and CLI open the **same SQLite file**:
  `~/Library/Application Support/PromptBr0/library.db` (macOS),
  `$XDG_CONFIG_HOME/promptbr0/library.db` (Linux),
  `%APPDATA%\PromptBr0\library.db` (Windows). Resolved by
  `resolveDatabasePath()` in `packages/core/src/paths.ts`.
- **`PROMPTBR0_DB=/path/to.db` overrides the DB location** for any of the
  two entry points (tests, scratch library, debugging). It is the only
  supported variable; a set-but-blank value is ignored.
- Concurrency: WAL mode + `busy_timeout = 3000`. Writes from agents while the
  app is open are safe; the app refetches on window focus (no live push).
  Migration v6 adds the sync storage (`sync_dirty`, `sync_ops`,
  `sync_cursors`, `sync_heads`, `sync_id_remaps`, `sync_pending_pointers`,
  `sync_peers`, `sync_meta`) plus dirty-capture triggers on the synced
  tables — CLI writes are picked up by the desktop app's background sync
  drain.
- On first launch, the desktop app copies a database left by an older dev
  build inside Electron's `userData` directory (with WAL/SHM sidecars) into
  the shared location, leaving the old copy untouched.

## Agent integration rules ("agents propose, humans approve")

External tools (via CLI) can read prompts, report runs and notes, and
**suggest** variations — but a suggested variation is created as a **pending**
version: invisible to search/listings, and it cannot become current until a
human approves it in the app's **Suggestions** view. Preserve this invariant:
pending suggestions must never leak into search results, listings, or the
current-version pointer.

Tools work only against the local library: they cannot pull remote content
into it.

Prompts are referenced by title (exact → case-insensitive → unique substring;
ambiguous matches return the close candidates) or by id. Onboarding for users
is copy-paste from Settings → *Agent integration*.

## Multi-device sync rules

Sync is pure P2P over the LAN (spec:
`docs-internal/specs/2026-08-27-sync-design.md`). Invariants to preserve
when touching it:

- The dirty-capture triggers (generated in
  `packages/core/src/sync/tables.ts`, applied by migration v6) must stay
  **pure SQL** — no app-registered functions — because older CLI binaries
keep writing to the same database file. Their writes are captured and
refined when the desktop app runs.
- **Never sync device-local data**: the `settings` table (remembered test
  models, catalog cache, `sync.*` keys, update state) and
  `providers.api_key_enc` (redacted at refine, never overwritten on apply).
  The synced-table registry in `tables.ts` is the single source of truth
  for what travels.
- Apply must stay **commutative and idempotent** (same ops in any order
  converge); LWW ties break by device id. Pending agent suggestions sync as
  rows but keep their `pending` status — the agents-propose-humans-approve
  invariant holds across devices.
- The pairing code derives from the accepting device's TLS certificate
  fingerprint; the fingerprint a device pins always comes from the TLS layer,
  never from a message field.
- `sync_peers`/`sync_meta`/`sync_*` tables are engine-owned storage; the
  device certificate/key live in `userData/sync/` (never in the shared DB).

## Security considerations

- **API keys are encrypted with Electron `safeStorage`** before they touch
  the database; only the opaque blob is stored, and decryption happens inside
  the main process at execution time. Never log keys, pass them to the
  renderer, or store plaintext.
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` in
  the environment enable a one-click "Use environment key" connect — handle
  env keys with the same care.
- All renderer↔main traffic is Zod-validated; keep it that way (defense
  against a compromised renderer).
- Never commit `.env` files or notarization credentials. The manual release
  process may use a local `Developer ID Application` certificate and Apple
  notarization credentials, but they must stay outside the repository. Signed
  artifacts must pass the bundle signature, Gatekeeper and stapled-ticket
  verifier before publication.
- The desktop `postinstall` script (`scripts/patch-electron-name.mjs`)
  patches the dev Electron bundle's Info.plist to say "PromptBr0",
  breaking the dev binary's code signature — expected, dev-only, never
  ships.
- The renderer has a CSP (see `apps/desktop/scripts/csp-theme-hash.mjs`);
  update the hash script output if you change the inline theme script in
  `index.html`.

## Packaging and release notes

- `pnpm --filter @promptbr0/desktop dist [--mac|--win|--linux]` runs
  electron-vite then electron-builder (config inline in
  `apps/desktop/package.json` → `build`), writing to `apps/desktop/dist/`.
  All targets build from macOS; default is the host platform.
- For 0.1.0, release exactly two macOS artifacts: DMG for arm64 and x64.
  Every artifact must be signed with Developer ID, notarized, stapled, and pass
  `verify-macos-distribution.mjs` before publication. Windows and Linux use
  their own clearly named architecture-specific installers; CLI setup
  remains cross-platform.
- Maintainers build each macOS target manually from the exact production
  commit, verify the packaged architecture, and use
  `collect-release-installers.mjs` to stage only the exact installer
  allowlist. Release filenames always include the target OS and architecture.
  `.yml` metadata and `.blockmap` files are never uploaded as user-facing
  release assets.
- Icons are generated assets committed for cross-platform packaging: run the
  `icons` script on macOS before `dist` if `build/icon*` files are missing or
  the source icon changes. CI verifies the committed assets without invoking
  macOS-only `sips`/`iconutil`. The script also generates the
  monochrome template icons for the native app-menu items
  (`build/menu-icons/`, shipped via `extraResources`, loaded by
  `src/main/menu-icons.ts` — macOS renders them in the app-menu dropdown;
  Windows/Linux menu bars draw no item icons).
- `better-sqlite3` is a native module. It currently loads under both Node 26
  and Electron 43 without a rebuild, so packaging sets `npmRebuild: false`
  and ships the prebuilt binary (`asarUnpack: **/*.node`). If a future
  Electron bump breaks ABI compatibility, rebuild against Electron headers
  (e.g. `@electron/rebuild`) and drop that flag.
- `packages/core` and `packages/ai` are consumed as
  **TypeScript source** (their `exports` point at `src/*.ts`; their `build`
  script is a no-emit `tsc` typecheck). The desktop app bundles them via
  electron-vite; the CLI esbuild bundles inline them
  (`better-sqlite3` kept external — Node cannot resolve core's
  `.js`-suffixed TS imports directly without compilation).
- Desktop updates use a main-process service that checks the latest stable
  GitHub Release, compares semantic versions, and exposes only canonical,
  exact OS/architecture installer assets. The validated release and ETag are
  cached in device-local settings; automatic detection is enabled by default
  and runs once after each packaged-app startup, with no periodic checks while
  the app remains open. Downloads open in the system browser and
  installation remains manual: there is no `electron-updater` dependency or
  unattended download/install path. Adding in-app installation requires a
  separate signed, architecture-aware design and target-backed update testing.
- The app is offline-first *except* for model-catalog refreshes (models.dev)
  and model runs; a failed catalog refresh keeps serving the stale cache.
- Licensing: the project uses a permissive license, mirrored into every package
  manifest. `THIRD_PARTY_NOTICES.md` is generated from the production
  dependency tree (`pnpm notices` / `scripts/generate-notices.mjs`) and must
  be regenerated after dependency changes; it ships via the desktop
  `extraResources` and, for npm packages, via
  `scripts/sync-package-licenses.mjs` (run manually before npm publication;
  the per-package copies are gitignored). `pnpm license-check`
  (`scripts/check-licenses.mjs`, also a CI step) fails the build on unknown
  or copyleft production licenses.
