# Command-Line Interface (CLI)

The **`promptbr0` CLI** (`@promptbr0/cli`) exposes the agent-safe library workflow to shell scripts and terminal workflows.

It requires **Node.js 22** or later and is built from this repository — the
npm packages are not published yet.

```bash
pnpm install
pnpm --filter @promptbr0/cli build
node apps/cli/dist/index.js db-path
```

To use the shorter `promptbr0` command shown in the examples below, put the
bundle on your `PATH`:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/apps/cli/dist/index.js" ~/.local/bin/promptbr0
chmod +x apps/cli/dist/index.js
```

---

## Global Options & Output Formats

### Plain Text vs. Machine-Readable JSON (`--json`)

- **Standard Output (Default)**: Optimized for Unix piping and terminal readability. For example, `promptbr0 get` outputs only the raw prompt content to stdout, making it directly pipeable into LLM CLI utilities or files.
- **`--json` Flag**: Emits structured JSON outputs suitable for parsing with `jq`, Python, or automation scripts.

```bash
# Pipe prompt content directly into an LLM command
promptbr0 get "pr-review" | llm -m claude-3-5-sonnet

# Parse prompt metadata with jq
promptbr0 get "pr-review" --json | jq '.versionLabel'
```

`promptbr0 db-path --json` returns a `{ "path": "..." }` object. Both the
plain and JSON forms only resolve the path; they do not create or migrate a
database.

---

## Command Reference

### 1. `promptbr0 list`
Lists all active prompts in the library.

```bash
promptbr0 list [--tag <tag_name>] [--collection <collection_name>] [--json]
```

#### Example
```bash
promptbr0 list --tag security
# Output:
# sql-injection-audit   v2   2026-08-27T18:00:00.000Z   1202e635-...
# auth-flow-check       v1   2026-08-25T12:30:00.000Z   d6eb38dc-...
```

---

### 2. `promptbr0 get`
Retrieves a prompt's text content. Defaults to the current designated production version.

```bash
promptbr0 get <name-or-id> \
  [--version-id <id> | --version <n> [--branch <branch_name>]] \
  [--json]
```

#### Examples
```bash
# Output raw prompt template to stdout
promptbr0 get "sql-injection-audit"

# Fetch specific version and redirect to a file
promptbr0 get "sql-injection-audit" --version 1 > /tmp/prompt_v1.md

# Reliably fetch the exact same content in automation
promptbr0 get "sql-injection-audit" \
  --version-id "8b3a7d7e-..." > /tmp/pinned_prompt.md

# Fetch prompt on an experimental branch
promptbr0 get "sql-injection-audit" --branch "experiment/concise"
```

JSON output includes `versionId`. Use that stable id when a script or agent must
retrieve the same version record later. A desktop user can amend its content,
so fetch it again before use when freshness matters and create a new version
when content must remain a historical snapshot. Version numbers are useful
display labels scoped to a variation. They remain unchanged when another
version is deleted, so history can contain gaps. A number can still be
reconciled if paired devices independently create the same number; it is not a
durable automation pin.

---

### 3. `promptbr0 search`
Searches prompt titles, descriptions, tags, notes, and version content.

```bash
promptbr0 search <query> [--limit <n>] [--json]
```

#### Example
```bash
promptbr0 search "sanitize inputs" --limit 5
```

---

### 4. `promptbr0 report-run`
Logs an execution run against a prompt version, recording the tool, model, outcome rating (1–5), and summary.

```bash
promptbr0 report-run --prompt <name-or-id> \
  [--version-id <id> | --version <n>] \
  [--tool <tool_name>] \
  [--model <model_name>] \
  [--outcome <1-5>] \
  [--summary "..."] \
  [--json]
```

`--tool` is optional and defaults to `cli`.

#### Example
```bash
promptbr0 report-run --prompt "sql-injection-audit" \
  --tool "local-eval" \
  --model "claude-3-5-sonnet" \
  --outcome 5 \
  --summary "Identified 3 vulnerabilities in sample codebase"
```

---

### 5. `promptbr0 add-note`
Attaches a context note to a prompt or specific version.

```bash
promptbr0 add-note --prompt <name-or-id> --body "..." [--version-id <id>] [--json]
```

---

### 6. `promptbr0 suggest`
Submits caller-provided rewritten content as a variation of a prompt. It does
not generate text: write the complete revision yourself or have an agent create
it first. The suggestion is created as **`pending`** awaiting human approval in
the desktop app.

Supply exactly one content source: `--file` or `--content`. For a multi-line
revision, use `--file`.

```bash
promptbr0 suggest --prompt <name-or-id> \
  (--file <path> | --content "...") \
  [--rationale "..."] \
  [--base-version-id <id> | --base-version <n>] \
  [--json]
```

#### Example
```bash
promptbr0 suggest --prompt "sql-injection-audit" \
  --file ./sql-injection-audit-revision.md \
  --rationale "Refined instructions to reduce false positives"
```

---

### 7. `promptbr0 suggestions`
Lists all pending variations currently waiting in the human review queue.

```bash
promptbr0 suggestions [--json]
```

---

### 8. `promptbr0 db-path`
Prints the absolute filesystem path of the resolved SQLite database file.

```bash
promptbr0 db-path
# /Users/username/Library/Application Support/PromptBr0/library.db

promptbr0 db-path --json
# { "path": "/Users/username/Library/Application Support/PromptBr0/library.db" }
```

---

### `promptbr0 help`
Running `promptbr0`, `promptbr0 help`, `--help`, or `-h` prints the full command list and exits.
