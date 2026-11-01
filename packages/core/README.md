# PromptBr0 Core

`@promptbr0/core` is the Node.js domain library behind PromptBr0. It
provides a SQLite-backed prompt library with version history, branches, tags,
collections, ratings, run records, full-text search, JSON import/export, and
peer-to-peer sync primitives. It has no Electron dependency.

Requires Node.js 22 or later.

Source: [GitHub](https://github.com/jackblackjack/promptbr0/tree/main/packages/core) ·
[documentation](https://github.com/jackblackjack/promptbr0#documentation) ·
[report an issue](https://github.com/jackblackjack/promptbr0/issues)

## Install

`@promptbr0/core` is not published to npm yet. It is consumed from this
repository as TypeScript source (`exports` point at `src/`), so workspace
packages depend on it directly:

```json
"dependencies": {
  "@promptbr0/core": "workspace:*"
}
```

`better-sqlite3` is a native dependency. Use a supported Node.js platform and
architecture with a compatible prebuilt binary, or a working native build
toolchain.

## Create a prompt library

```js
import { openMemoryDatabase, PromptLibrary } from "@promptbr0/core";

const db = openMemoryDatabase();
const library = new PromptLibrary(db);

const prompt = library.createPrompt({
  title: "Review this change",
  content: "Review {{target}} for correctness and security.",
  tagNames: ["code-review"],
});

console.log(library.getPrompt(prompt.id));
db.close();
```

`openMemoryDatabase()` applies the latest schema to a disposable in-memory
database. For a persistent library, pass an explicit path to `openDatabase()`:

```js
import { openDatabase, PromptLibrary } from "@promptbr0/core";

const { db, backupPath } = openDatabase("/absolute/path/library.db");
const library = new PromptLibrary(db);

console.log(library.listPrompts());
console.log({ backupPath });
db.close();
```

Migrations run automatically. When an existing on-disk database needs a
migration, PromptBr0 creates a timestamped backup first and returns its
path as `backupPath`; otherwise that value is `null`.

## Resolve an exact version

Each version has a stable id. Use it with `resolveVersion()` when a saved
workflow must keep referring to the same version record:

```js
import { resolveVersion } from "@promptbr0/core";

const versionId = library.getPrompt(prompt.id)?.current_version_id;
if (!versionId) throw new Error("Prompt has no current version");

const exact = resolveVersion(library, prompt.id, { versionId });
console.log(exact.version.content);
```

Numeric version labels are scoped to a branch. Deleting an older version does
not renumber the surviving history, so gaps are normal. Paired devices may
also reconcile a true concurrent number collision; use the stable id as the
durable identity for automation. Desktop users can amend that version's
content, so create a new version when the content must remain a snapshot.

## Main exports

- `PromptLibrary` — prompt, version, branch, note, tag, collection, rating,
  run, search, and import/export operations.
- `openDatabase()` and `openMemoryDatabase()` — SQLite lifecycle and schema
  setup.
- `resolveDatabasePath()` — the shared PromptBr0 library location, with
  `PROMPTBR0_DB` override support.
- `extractPromptVariables()`, `missingPromptVariables()`, and
  `substitutePromptVariables()` — `{{variable}}` discovery and substitution.
- `resolvePrompt()` and `resolveVersion()` — id/title and version reference
  resolution, including exact lookup by stable version id.
- `SyncEngine` and hybrid logical clock helpers — transport-independent sync
  primitives.

The desktop app and CLI use this package against the same local
database. If several processes open that database, WAL mode and a busy timeout
are configured automatically.

## Build from source

From the [PromptBr0 repository](https://github.com/jackblackjack/promptbr0),
with pnpm 11.7.0 available:

```sh
pnpm install
pnpm --filter @promptbr0/core build
```

The published package contains compiled ESM in `dist/` and TypeScript
declarations.
