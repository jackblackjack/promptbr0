# Changelog

Notable user-facing changes to PromptBr0 are documented here. Installers and
release-specific notes are attached to GitHub Releases.

## [0.1.0] - 2026-11-01

First public release of the desktop app, the CLI, and the shared core library.

### Added

- Prompt library with soft delete, tags, collections (nested folders with
  drag-and-drop ordering), starring, filters, and sort.
- Versioning per prompt with branches, stable version IDs, amend-in-place and
  save-as-new, change notes, history labels, diffs, and "duplicate as
  variation" branching.
- Full-text search across titles, descriptions, tags, notes and version
  content, with a command palette (⌘K / Ctrl+K) and prefix matching.
- Evaluations: 1–5 ratings on four dimensions, a run log in the Results tab,
  side-by-side comparison of any two versions, and an LLM judge with an
  evaluation summary.
- Multi-model runs with a [models.dev](https://models.dev)-backed catalog for
  OpenAI, Anthropic, Google, and OpenAI-compatible endpoints; up to six models
  concurrently, with token and cost tracking.
- AI prompt assist for drafting and improving prompts.
- Peer-to-peer sync between devices on the local network: mDNS discovery,
  code-based pairing bound to TLS certificate fingerprints, mutually pinned
  TLS, and deterministic record-level merges. No server and no account.
- Quick access palette with a configurable global shortcut, variable inputs,
  and an exact text preview; optional system-tray mode with close-to-tray.
- JSON import and export, automatic local backups, and an in-app update check
  that links to the GitHub release for the host platform.
- `promptbr0` CLI over the same library, with `--json` output for every
  command: read and search prompts, log runs and ratings, add notes, manage
  collections, and propose variations as pending suggestions.
- Agent workflow built on the CLI: agents propose, humans approve. Pending
  suggestions stay out of search and listings until reviewed in the
  **Suggestions** view.

### Packages

- `@promptbr0/desktop` 0.1.0
- `@promptbr0/cli` 0.1.0
- `@promptbr0/core` 0.1.0
- `@promptbr0/ai` 0.1.0 (internal)

The npm packages are not published yet; build them from source with
`pnpm build`.
