# Contributing to PromptBr0

Thanks for helping improve PromptBr0. Keep contributions focused on a clear
user or agent need, and include tests when behaviour changes.

## Requirements

- Node.js 22 or later
- pnpm 11.7.0 (pinned in `package.json`; enable it with `corepack enable`)

## Set up

```sh
corepack enable
pnpm install
pnpm build
```

Run the desktop app in development with `pnpm dev`.

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/desktop` | Electron shell: main process, preload bridge, React renderer |
| `apps/cli` | `promptbr0` CLI, bundled with esbuild to `dist/index.js` |
| `packages/core` | SQLite storage, migrations, search, sync engine (no Electron) |
| `packages/ai` | Provider registry, model catalog, runs, judge (no Electron) |
| `docs/` | User-facing documentation |

`packages/core` and `packages/ai` must stay free of Electron and DOM
dependencies; the desktop app adapts them to IPC and the UI.

## Before opening a pull request

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm license-check
```

To run a single suite, filter by package, for example
`pnpm --filter @promptbr0/core test`. Do not weaken existing tests — update call
sites, not expectations, unless behaviour genuinely changed.

## Pull requests

- Branch from `main` and open the pull request against `main`.
- Explain the problem and the user-visible result.
- Keep each change focused, and update the documentation in `docs/` (and
  `README.md` where relevant) when installation or usage changes.
- Do not commit API keys, prompt libraries, or other private data. The `.env`
  files, local databases, and agent workspace directories are gitignored.

## Commit messages

History uses gitmoji plus Conventional Commits, for example:

```
🐛 fix(core): survive ops arriving before their FK parents
🐣 feat(desktop): wire P2P sync into the app
📝 docs: clarify the CLI install path
```

Use the emoji, then `type(scope): subject`.

## Code style

- TypeScript, ESM everywhere; internal imports carry the `.js` suffix
  (`import { … } from "./library.js"`).
- Two-space indent, double quotes, semicolons, roughly 100-column prose in
  comments and docs. Match the surrounding file — there is no formatter
  configuration to lean on.
- Comments explain *why*, not *what*.
- All renderer↔main traffic goes through the Zod schemas in
  `apps/desktop/src/shared/ipc.ts`; the renderer never touches Node or Electron
  APIs directly.
- SQLite migrations are forward-only and append-only: add a new numbered
  migration instead of editing one that already shipped.
- Never sync device-local data (settings, encrypted API keys).

## Licensing

PromptBr0 is released under the [Apache License 2.0](LICENSE). By contributing,
you agree that your contribution is licensed under the same terms.

Please report security issues privately — see
[`.github/SECURITY.md`](.github/SECURITY.md) instead of opening a public issue.
