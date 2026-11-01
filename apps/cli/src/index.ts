import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import {
  openDatabase,
  PromptLibrary,
  resolveDatabasePath,
  resolvePrompt,
  resolveVersion,
  type PromptRow,
} from "@promptbr0/core";

/**
 * PromptBr0 CLI — for shell pipelines and agents.
 * Thin adapter over @promptbr0/core.
 * Every command supports --json for machine-readable output.
 */

const USAGE = `promptbr0 — PromptBr0 library CLI

Usage:
  promptbr0 list [--tag t] [--collection c]
  promptbr0 create-collection <name> [--parent p] [--sort-order N]
  promptbr0 list-collections [--json]
  promptbr0 collection-tree [--json]
  promptbr0 update-collection <id> [--name N] [--parent p] [--sort-order N]
  promptbr0 delete-collection <id> [--force]
  promptbr0 add-to-collection <collection> <prompt>
  promptbr0 remove-from-collection <collection> <prompt>
  promptbr0 get <name-or-id> [--version-id id | --version n [--branch b]]
  promptbr0 search <query> [--limit n]
  promptbr0 report-run --prompt <name-or-id> [--version-id id | --version n] [--tool t] [--model m] [--outcome 1-5] [--summary "..."]
  promptbr0 add-note --prompt <name-or-id> --body "..." [--version-id id]
  promptbr0 suggest --prompt <name-or-id> (--file path | --content "...") [--rationale "..."] [--base-version-id id | --base-version n]
    The caller supplies the complete rewritten content; suggest does not generate text.
  promptbr0 suggestions
  promptbr0 db-path

Global flags:
  --json    Machine-readable JSON output
  --version Print the CLI package version

Database: ${resolveDatabasePath()}
(override with the PROMPTBR0_DB environment variable)
`;

class CliError extends Error {}

let library: PromptLibrary | null = null;

function getLibrary(): PromptLibrary {
  if (!library) {
    const dbPath = resolveDatabasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { db } = openDatabase(dbPath);
    library = new PromptLibrary(db);
  }
  return library;
}

function currentVersionLabel(lib: PromptLibrary, prompt: PromptRow): string | null {
  try {
    return resolveVersion(lib, prompt.id).label;
  } catch {
    return null;
  }
}

const CLI_APP_VERSION = `promptbr0-cli/${packageJson.version}`;

/** Prints $1 as JSON when --json, otherwise calls the human formatter. */
function out(json: boolean, data: unknown, human: () => void): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    human();
  }
}

function parseIntFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`--${name} must be a positive integer, got "${value}"`);
  return n;
}

const LIST_OPTS = {
  tag: { type: "string" },
  collection: { type: "string" },
  json: { type: "boolean" },
} as const;

const GET_OPTS = {
  "version-id": { type: "string" },
  version: { type: "string" },
  branch: { type: "string" },
  json: { type: "boolean" },
} as const;

const SEARCH_OPTS = {
  limit: { type: "string" },
  json: { type: "boolean" },
} as const;

const REPORT_RUN_OPTS = {
  prompt: { type: "string" },
  "version-id": { type: "string" },
  version: { type: "string" },
  tool: { type: "string" },
  model: { type: "string" },
  outcome: { type: "string" },
  summary: { type: "string" },
  json: { type: "boolean" },
} as const;

const ADD_NOTE_OPTS = {
  prompt: { type: "string" },
  "version-id": { type: "string" },
  body: { type: "string" },
  json: { type: "boolean" },
} as const;

const SUGGEST_OPTS = {
  prompt: { type: "string" },
  file: { type: "string" },
  content: { type: "string" },
  rationale: { type: "string" },
  "base-version-id": { type: "string" },
  "base-version": { type: "string" },
  json: { type: "boolean" },
} as const;

const NO_OPTS = { json: { type: "boolean" } } as const;

const COLLECTION_OPTS = {
  parent: { type: "string" },
  "sort-order": { type: "string" },
  force: { type: "boolean" },
  json: { type: "boolean" },
} as const;

function required(value: string | undefined, flag: string): string {
  if (!value) throw new CliError(`Missing required flag --${flag}`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "--version") {
    process.stdout.write(`${CLI_APP_VERSION}\n`);
    return;
  }

  if (command === "db-path") {
    const { values } = parseArgs({ args: rest, options: NO_OPTS, strict: true });
    const resolvedPath = resolveDatabasePath();
    out(values.json ?? false, { path: resolvedPath }, () => {
      process.stdout.write(resolvedPath + "\n");
    });
    return;
  }

  const lib = getLibrary();

  switch (command) {
    case "list": {
      const { values } = parseArgs({ args: rest, options: LIST_OPTS, strict: true });
      const prompts = lib.listPrompts({
        ...(values.tag ? { tagIds: [tagIdByName(lib, values.tag)] } : {}),
        ...(values.collection ? { collectionId: collectionIdByName(lib, values.collection) } : {}),
      });
      const rows = prompts.map((p) => ({
        id: p.id,
        title: p.title,
        currentVersionLabel: currentVersionLabel(lib, p),
        updatedAt: p.updated_at,
      }));
      out(values.json ?? false, rows, () => {
        for (const row of rows) {
          process.stdout.write(`${row.title}\t${row.currentVersionLabel ?? "-"}\t${row.updatedAt}\t${row.id}\n`);
        }
        if (rows.length === 0) process.stdout.write("(no prompts)\n");
      });
      return;
    }

    case "get": {
      const { values, positionals } = parseArgs({ args: rest, options: GET_OPTS, strict: true, allowPositionals: true });
      const ref = positionals[0];
      if (!ref) {
        throw new CliError(
          "Usage: promptbr0 get <name-or-id> [--version-id id | --version n [--branch b]]",
        );
      }
      const prompt = resolvePrompt(lib, ref);
      const resolved = resolveVersion(lib, prompt.id, {
        ...(values["version-id"] !== undefined ? { versionId: values["version-id"] } : {}),
        ...(values.version !== undefined ? { version: parseIntFlag(values.version, "version")! } : {}),
        ...(values.branch !== undefined ? { branch: values.branch } : {}),
      });
      if (values.json) {
        out(true, {
          id: prompt.id,
          title: prompt.title,
          versionId: resolved.version.id,
          versionLabel: resolved.label,
          branch: resolved.branchName,
          changeNote: resolved.version.change_note,
          content: resolved.version.content,
        }, () => {});
      } else {
        // Plain content on stdout so the command pipes cleanly.
        process.stdout.write(resolved.version.content);
        if (!resolved.version.content.endsWith("\n")) process.stdout.write("\n");
      }
      return;
    }

    case "search": {
      const { values, positionals } = parseArgs({ args: rest, options: SEARCH_OPTS, strict: true, allowPositionals: true });
      const query = positionals.join(" ").trim();
      if (!query) throw new CliError("Usage: promptbr0 search <query> [--limit n]");
      const limit = parseIntFlag(values.limit, "limit") ?? 10;
      const rows = lib.search(query).slice(0, limit).map((r) => {
        const prompt = lib.getPrompt(r.promptId);
        return {
          promptId: r.promptId,
          title: r.title,
          snippet: r.snippet,
          currentVersionLabel: prompt ? currentVersionLabel(lib, prompt) : null,
        };
      });
      out(values.json ?? false, rows, () => {
        for (const row of rows) {
          process.stdout.write(`${row.title}\t${row.currentVersionLabel ?? "-"}\t${row.snippet}\t${row.promptId}\n`);
        }
        if (rows.length === 0) process.stdout.write("(no matches)\n");
      });
      return;
    }

    case "report-run": {
      const { values } = parseArgs({ args: rest, options: REPORT_RUN_OPTS, strict: true });
      const prompt = resolvePrompt(lib, required(values.prompt, "prompt"));
      const resolved = resolveVersion(lib, prompt.id, {
        ...(values["version-id"] !== undefined ? { versionId: values["version-id"] } : {}),
        ...(values.version !== undefined ? { version: parseIntFlag(values.version, "version")! } : {}),
      });
      const outcome = parseIntFlag(values.outcome, "outcome");
      if (outcome !== undefined && outcome > 5) throw new CliError("--outcome must be between 1 and 5");
      const run = lib.addRun({
        promptId: prompt.id,
        versionId: resolved.version.id,
        tool: values.tool ?? "cli",
        ...(values.model !== undefined ? { model: values.model } : {}),
        ...(outcome !== undefined ? { outcomeRating: outcome } : {}),
        ...(values.summary !== undefined ? { resultSummary: values.summary } : {}),
      });
      out(values.json ?? false, { runId: run.id, promptId: prompt.id, versionId: run.version_id, versionLabel: resolved.label }, () => {
        process.stdout.write(`Logged run ${run.id} for "${prompt.title}" (${resolved.label})\n`);
      });
      return;
    }

    case "add-note": {
      const { values } = parseArgs({ args: rest, options: ADD_NOTE_OPTS, strict: true });
      const prompt = resolvePrompt(lib, required(values.prompt, "prompt"));
      const note = lib.addNote({
        promptId: prompt.id,
        ...(values["version-id"] !== undefined ? { versionId: values["version-id"] } : {}),
        body: required(values.body, "body"),
      });
      out(values.json ?? false, { noteId: note.id, promptId: prompt.id }, () => {
        process.stdout.write(`Added note ${note.id} to "${prompt.title}"\n`);
      });
      return;
    }

    case "suggest": {
      const { values } = parseArgs({ args: rest, options: SUGGEST_OPTS, strict: true });
      const prompt = resolvePrompt(lib, required(values.prompt, "prompt"));
      if (values.file === undefined && values.content === undefined) {
        throw new CliError(
          "suggest requires --file or --content with the complete rewritten prompt; it does not generate text.",
        );
      }
      if (values.file !== undefined && values.content !== undefined) {
        throw new CliError("suggest requires exactly one of --file or --content");
      }
      let newContent: string;
      if (values.file !== undefined) {
        newContent = fs.readFileSync(values.file, "utf8");
      } else {
        newContent = values.content!;
      }
      const base = resolveVersion(lib, prompt.id, {
        ...(values["base-version-id"] !== undefined
          ? { versionId: values["base-version-id"] }
          : {}),
        ...(values["base-version"] !== undefined ? { version: parseIntFlag(values["base-version"], "base-version")! } : {}),
      });
      const { branch, version } = lib.suggestVariation({
        promptId: prompt.id,
        baseVersionId: base.version.id,
        newContent,
        rationale: values.rationale ?? "Suggested via promptbr0 CLI",
      });
      out(values.json ?? false, {
        status: "pending",
        promptId: prompt.id,
        branch: branch.name,
        versionId: version.id,
      }, () => {
        process.stdout.write(
          `Suggestion ${version.id} created on branch "${branch.name}" — PENDING human review in the PromptBr0 app.\n`,
        );
      });
      return;
    }

    case "suggestions": {
      const { values } = parseArgs({ args: rest, options: NO_OPTS, strict: true });
      const rows = lib.listSuggestions().map((s) => ({
        versionId: s.id,
        promptId: s.prompt_id,
        promptTitle: s.prompt_title,
        branch: s.branch_name,
        baseVersionId: s.parent_version_id,
        rationale: s.change_note,
        source: s.source,
        createdAt: s.created_at,
      }));
      out(values.json ?? false, rows, () => {
        for (const row of rows) {
          process.stdout.write(`${row.promptTitle}\t${row.branch}\t${row.rationale ?? ""}\t${row.versionId}\n`);
        }
        if (rows.length === 0) process.stdout.write("(no pending suggestions)\n");
      });
      return;
    }

    case "create-collection": {
      const { values, positionals } = parseArgs({ args: rest, options: COLLECTION_OPTS, strict: true, allowPositionals: true });
      const name = positionals[0];
      if (!name) throw new CliError("Usage: promptbr0 create-collection <name> [--parent p] [--sort-order N]");
      let parentCollectionId: string | null = null;
      if (values.parent !== undefined) {
        parentCollectionId = resolveCollectionByIdOrPath(lib, values.parent);
      }
      const sortOrder = parseIntFlag(values["sort-order"], "sort-order");
      const collection = lib.createCollection({ name, parentCollectionId, sortOrder });
      out(values.json ?? false, {
        id: collection.id,
        name: collection.name,
        parentId: collection.parent_collection_id,
        sortOrder: collection.sort_order,
      }, () => {
        process.stdout.write(`Created collection "${collection.name}" (${collection.id})\n`);
      });
      return;
    }

    case "list-collections": {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } }, strict: true });
      const collections = lib.listCollections().map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_collection_id,
        sortOrder: c.sort_order,
        promptCount: c.prompt_count,
      }));
      out(values.json ?? false, collections, () => {
        for (const c of collections) {
          process.stdout.write(`${c.name}\t${c.promptCount}\t${c.id}\n`);
        }
        if (collections.length === 0) process.stdout.write("(no collections)\n");
      });
      return;
    }

    case "collection-tree": {
      const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } }, strict: true });
      const tree = lib.getCollectionTree();
      out(values.json ?? false, tree, () => {
        function printNode(node: unknown, depth: number): void {
          const rec = node as Record<string, unknown>;
          const indent = "  ".repeat(depth);
          const label = rec.id === "root" ? "(root)" : (rec.name as string);
          const count = rec.promptCount as number;
          process.stdout.write(`${indent}${label} (${count} prompts)\n`);
          const children = (rec.children as Array<unknown>) || [];
          for (const child of children) printNode(child, depth + 1);
        }
        printNode(tree, 0);
      });
      return;
    }

    case "update-collection": {
      const { values, positionals } = parseArgs({ args: rest, options: COLLECTION_OPTS, strict: true, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new CliError("Usage: promptbr0 update-collection <id> [--name N] [--parent P] [--sort-order N]");
      const patch: { name?: string; parentCollectionId?: string | null; sortOrder?: number } = {};
      if (values.parent !== undefined) {
        patch.parentCollectionId = resolveCollectionByIdOrPath(lib, values.parent);
      }
      if (values["sort-order"] !== undefined) {
        patch.sortOrder = parseIntFlag(values["sort-order"], "sort-order")!;
      }
      // --name needs its own option handling; re-parse with extended options.
      // We'll extract --name from positionals since parseArgs doesn't support it yet.
      const rawRest = rest;
      const nameIdx = rawRest.findIndex((a) => a.startsWith("--name"));
      if (nameIdx !== -1 && nameIdx + 1 < rawRest.length) {
        patch.name = rawRest[nameIdx + 1];
      }
      const updated = lib.updateCollection(id, patch);
      out(values.json ?? false, {
        id: updated.id,
        name: updated.name,
        parentId: updated.parent_collection_id,
        sortOrder: updated.sort_order,
      }, () => {
        process.stdout.write(`Updated collection "${updated.name}" (${updated.id})\n`);
      });
      return;
    }

    case "delete-collection": {
      const { values, positionals } = parseArgs({ args: rest, options: COLLECTION_OPTS, strict: true, allowPositionals: true });
      const id = positionals[0];
      if (!id) throw new CliError("Usage: promptbr0 delete-collection <id> [--force]");
      if (!values.force) {
        const readline = createInterface({ input: process.stdin, output: process.stderr });
        try {
          const answer = await readline.question(`Delete collection "${id}"? [y/N] `);
          if (answer.toLowerCase() !== "y") {
            process.stdout.write("Cancelled.\n");
            return;
          }
        } finally {
          readline.close();
        }
      }
      lib.deleteCollection(id);
      out(values.json ?? false, { deleted: id }, () => {
        process.stdout.write(`Deleted collection ${id}\n`);
      });
      return;
    }

    case "add-to-collection": {
      const { values, positionals } = parseArgs({ args: rest, options: NO_OPTS, strict: true, allowPositionals: true });
      const collectionName = positionals[0];
      const promptRef = positionals[1];
      if (!collectionName || !promptRef) {
        throw new CliError("Usage: promptbr0 add-to-collection <collection> <prompt>");
      }
      const collectionId = resolveCollectionByIdOrPath(lib, collectionName);
      const prompt = resolvePrompt(lib, promptRef);
      lib.addPromptToCollection(collectionId, prompt.id);
      out(values.json ?? false, { collectionId, promptId: prompt.id }, () => {
        process.stdout.write(`Added "${prompt.title}" to collection "${collectionName}"\n`);
      });
      return;
    }

    case "remove-from-collection": {
      const { values, positionals } = parseArgs({ args: rest, options: NO_OPTS, strict: true, allowPositionals: true });
      const collectionName = positionals[0];
      const promptRef = positionals[1];
      if (!collectionName || !promptRef) {
        throw new CliError("Usage: promptbr0 remove-from-collection <collection> <prompt>");
      }
      const collectionId = resolveCollectionByIdOrPath(lib, collectionName);
      const prompt = resolvePrompt(lib, promptRef);
      lib.removePromptFromCollection(collectionId, prompt.id);
      out(values.json ?? false, { collectionId, promptId: prompt.id }, () => {
        process.stdout.write(`Removed "${prompt.title}" from collection "${collectionName}"\n`);
      });
      return;
    }

    default:
      throw new CliError(`Unknown command "${command}". Run "promptbr0 help" for usage.`);
  }
}

function tagIdByName(lib: PromptLibrary, name: string): string {
  const tag = lib.listTags().find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!tag) throw new CliError(`Tag not found: "${name}"`);
  return tag.id;
}

function collectionIdByName(lib: PromptLibrary, name: string): string {
  const collection = lib.listCollections().find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!collection) throw new CliError(`Collection not found: "${name}"`);
  return collection.id;
}

/**
 * Resolve a collection by id, exact name, or breadcrumb path (e.g. "Root/Child").
 * Handles nested collections with the same name under different parents.
 */
function resolveCollectionByIdOrPath(lib: PromptLibrary, ref: string): string {
  // Exact id match first (fast path).
  const all = lib.listCollections();
  if (all.some((c) => c.id === ref)) return ref;

  // Try breadcrumb path: split by "/" and walk down.
  const parts = ref.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length > 0) {
    let currentId: string | null = null;
    for (const part of parts) {
      const children: Array<{ id: string; name: string }> = currentId === null
        ? lib.listCollectionsByParent(null)
        : lib.listCollectionsByParent(currentId);
      const found = children.find((c) => c.name.toLowerCase() === part);
      if (!found) {
        throw new CliError(`Collection not found: "${ref}" (no match for "${part}" at depth ${parts.indexOf(part)})`);
      }
      currentId = found.id;
    }
    if (currentId === null) {
      throw new CliError(`Collection not found: "${ref}"`);
    }
    return currentId;
  }

  // Fallback: flat name search (backwards compatibility for simple cases).
  const collection = all.find((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (!collection) throw new CliError(`Collection not found: "${ref}"`);
  return collection.id;
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`promptbr0: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
