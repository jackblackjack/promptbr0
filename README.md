# PromptBr0

PromptBr0 is a desktop workbench for prompts you reuse. Each prompt sits in a
SQLite library on your own disk with a branchable history; a version can be run
against several models at once, and the answers are filed beside the version
that produced them. A CLI exposes the same library to shell scripts and coding
agents, under one limit: an agent may propose a rewrite, but only a person
decides whether it joins the library.

Nothing is hosted for you. There is no PromptBr0 account, workspace, or relay.
The app reaches the network only to call a model provider, refresh the model
catalog from [models.dev](https://models.dev), ask GitHub about a newer release,
or sync with a device you paired yourself.

Status: **0.1.0**, pre-1.0, so details can still move. Installers, when a
release is published, are attached to
[GitHub Releases](https://github.com/jackblackjack/promptbr0/releases).

## What it covers

| Part | What you get |
| --- | --- |
| Library | Full-text search (⌘K / Ctrl+K), tags, nested collections, stars, filters, Trash |
| Versions | Branches, stable version ids, drafts, change notes, diffs, variations |
| Runs | Up to six models in parallel, with latency, token use, and estimated cost |
| Review | Four-dimension ratings, a run log, a compare view, and an AI judge |
| Agents | A CLI that reads, logs, and suggests — never promotes on its own |
| Sync | Direct record exchange between your own devices on the local network |

## Install and run

When a release is published, desktop installers for macOS, Windows, and Linux
are attached to [GitHub Releases](https://github.com/jackblackjack/promptbr0/releases).
Until then, build from source. The CLI also comes from this repository; the
npm packages are not published yet.

Building from source needs Node.js 22+ and pnpm 11.7.0:

```sh
corepack enable
pnpm install
pnpm build
pnpm dev
```

`pnpm dev` starts the desktop app. To build only the CLI and put the short
command on your `PATH`:

```sh
pnpm --filter @promptbr0/cli build
mkdir -p ~/.local/bin
ln -sf "$PWD/apps/cli/dist/index.js" ~/.local/bin/promptbr0
chmod +x apps/cli/dist/index.js
```

`promptbr0 db-path` then prints the library location.

## Where the library lives

The desktop app and the CLI open one SQLite file by default:

- macOS — `~/Library/Application Support/PromptBr0/library.db`
- Linux — `${XDG_CONFIG_HOME:-~/.config}/promptbr0/library.db`
- Windows — `%APPDATA%\PromptBr0\library.db`

Set `PROMPTBR0_DB=/path/to/library.db` to point a process at a different file,
for example a scratch library for experiments.

The database runs in WAL mode, so the CLI can write while the app is open; the
window refreshes when you return to it. Backups are written once a day next to
the database, keeping the last ten, and on demand from Settings → Data &
Backup. The same panel copies the database path and exports or imports the
whole library as JSON; an import merges into what is already there.

Because the library is an ordinary file, you can copy it, archive it, or open
it in any SQLite browser.

## Versions, branches, and drafts

A prompt is not one string. It has branches, and each branch has a numbered
sequence of versions with stable ids. Editing the version you are on keeps its
id (amend); saving the edit as new appends the next version on that branch.
Each save can carry a change note, and any two versions can be compared in a
diff.

A draft remembers the exact version it started from, so saving it continues
that branch rather than guessing. Exactly one version per prompt is marked
current, and that is what the CLI reads unless a version is named explicitly.
When a direction needs room of its own, an active version can start a
variation: a new branch whose first version copies the content and then
evolves separately.

## Models and runs

Connect OpenAI, Anthropic, Google, or an OpenAI-compatible endpoint such as
Ollama or LM Studio. A provider is one row in Settings → AI Providers: choose
its type, paste a key, and the connection is checked immediately. Keys are
encrypted through the operating system's credential store and decrypted only
for a request. Existing environment keys — `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` — can stand in for a stored
key, with a one-click connect on the matching provider row.

The catalog is fetched from models.dev and kept in a local cache, so editing
and browsing never need a connection; only runs and catalog refreshes go
online. Once a provider is connected, its whole catalog appears in the
searchable picker beside Run, and models you never use can be hidden.

One Run sends the prompt, after `{{variable}}` substitution, to as many as six
models concurrently. Each model gets its own row: output, status, latency,
tokens, and an estimated cost when the catalog lists pricing. The same models
can draft or improve a prompt through AI assist.

## Reviewing results

The Results tab keeps a run log. Open a group to compare outputs beside their
timing, tokens, and cost. Rate a version on four 1–5 dimensions — effectiveness,
clarity, completeness, actionability — and the library keeps the averages with
that version.

For a second opinion, hand a run group to the LLM judge: choose a connected
model, optionally add criteria, and read its scores and rationale. Scores stay
advisory until you choose to apply them as ratings.

## CLI and the approval gate

The CLI mirrors the library for scripts and agents. Every command accepts
`--json`:

```sh
promptbr0 db-path
promptbr0 list --collection "release notes" --json
promptbr0 get "incident-triage" --version 3
promptbr0 search "rollback"
promptbr0 report-run --prompt "incident-triage" --tool claude-code --model sonnet --outcome 5
promptbr0 add-note --prompt "incident-triage" --body "handled a truncated log well"
promptbr0 suggest --prompt "incident-triage" --file tighter.md --rationale "drops duplicated context"
promptbr0 suggestions
```

A prompt can be addressed by id, or by name: an exact title wins, then a
case-insensitive match, then a unique fragment of the title. An ambiguous name
answers with the near matches instead of guessing.

`suggest` never touches the visible library. It creates a pending version,
which search and listings ignore and which cannot become current. The
Suggestions view is where a person approves or rejects it; approval can also
make it current. There is deliberately no CLI command that approves.

## Between machines

Settings → Sync turns on device-to-device exchange: devices find each other
with mDNS on the local network, or by address when the network blocks it (VPNs,
manual setup). Pairing starts with a short code computed from the fingerprint
of the accepting device's TLS certificate, so anyone intercepting the exchange
arrives at a different code. Both sides pin the other's certificate, and
forgetting a device unpins it permanently.

Every write — from the app, the CLI, or any other process on the same file —
lands in a local operation log with logical timestamps. Paired devices trade
the operations they lack and merge deterministically: records created on both
sides survive under their own ids; when both changed the same record, the later
logical timestamp wins; tags, collections, or branches that share a name become
a single entry. Because each change is durable the moment it is written, there
is no upload queue; devices simply catch up when they meet again.

API keys never travel. Settings, including remembered test models and the sync
state, stay local to each device. macOS asks for Local Network access the first
time sync starts; if you decline, devices cannot find each other.

## Small conveniences

The Quick access palette opens from a configurable global shortcut, fills
`{{variables}}`, and shows the exact text that will be copied. An optional tray
mode keeps the app reachable after the window closes. The update check reads
the latest stable GitHub release and opens its download page in your browser —
it never downloads or installs anything behind your back.

## Documentation

- **Getting started** — [Overview](docs/getting-started/overview.md),
  [Installation](docs/getting-started/installation.md),
  [Quickstart](docs/getting-started/quickstart.md),
  [Core concepts](docs/getting-started/core-concepts.md)
- **Prompts** — [Managing prompts and versions](docs/features/prompt-management.md),
  [Search and organization](docs/features/search-and-organization.md)
- **Models and review** — [Running prompts](docs/features/ai-execution-and-models.md),
  [Evaluations](docs/features/llm-judge-and-evaluations.md),
  [AI assist](docs/features/ai-assist.md)
- **Data** — [Library data and backups](docs/features/library-data-and-backups.md),
  [Configuration and environment](docs/reference/configuration-and-env.md),
  [Updates](docs/reference/updates.md)
- **Integrations** — [CLI](docs/integrations/cli.md),
  [AI providers](docs/integrations/ai-providers.md)
- **Sync** — [Peer-to-peer sync](docs/sync/peer-to-peer-sync.md)

The full index is [docs/SUMMARY.md](docs/SUMMARY.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Third-party attribution lives in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the same list is
reachable in the app from About → Open Source Licenses. Contributions are
covered by [CONTRIBUTING.md](CONTRIBUTING.md).
