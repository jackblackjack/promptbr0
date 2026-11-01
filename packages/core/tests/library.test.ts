import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, openMemoryDatabase, PromptLibrary, type Database } from "../src/index.js";

let db: Database;
let lib: PromptLibrary;

function waitForOutput(
  child: ReturnType<typeof spawn>,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const stdout = child.stdout;
  if (!stdout) throw new Error("Child stdout is unavailable");
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child output ${JSON.stringify(expected)}: ${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.split("\n").includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Child exited with code ${code} before writing ${JSON.stringify(expected)}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      child.off("exit", onExit);
    };
    stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForSuccessfulExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  const stderr = child.stderr;
  if (!stderr) throw new Error("Child stderr is unavailable");
  return new Promise((resolve, reject) => {
    let errorOutput = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child exit: ${errorOutput}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      errorOutput += chunk.toString();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(`Child exited with code ${code}: ${errorOutput}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function observeExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = (): void => {
      child.off("exit", settle);
      child.off("close", settle);
      child.off("error", settle);
      resolve();
    };
    child.once("exit", settle);
    child.once("close", settle);
    child.once("error", settle);
  });
}

beforeEach(() => {
  db = openMemoryDatabase();
  lib = new PromptLibrary(db);
});

describe("test process cleanup", () => {
  it("settles observation when a child fails before emitting exit", async () => {
    const scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "promptbr0-spawn-failure-"));
    const child = spawn(path.join(scratchDirectory, "missing-executable"), [], { stdio: "ignore" });

    try {
      await observeExit(child);
    } finally {
      fs.rmSync(scratchDirectory, { recursive: true, force: true });
    }
  }, 1_000);
});

describe("prompts", () => {
  it.each(["pending", "rejected"])("rejects manual and model runs of a %s version", (status) => {
    const prompt = lib.createPrompt({ title: "Legacy corrupt pointer", content: "private" });
    db.prepare("UPDATE versions SET status = ? WHERE id = ?").run(status, prompt.current_version_id);
    expect(() => lib.addRun({ promptId: prompt.id, versionId: prompt.current_version_id! }))
      .toThrow(/active/i);
    expect(() => lib.recordModelRun({ promptId: prompt.id, versionId: prompt.current_version_id!,
      provider: "test", model: "test", status: "completed", output: "result" }))
      .toThrow(/active/i);
    expect(lib.listRuns(prompt.id)).toEqual([]);
  });

  it("creates a prompt with main branch, version 1 and current pointer set", () => {
    const prompt = lib.createPrompt({ title: "Hello", description: "Greeting", content: "Say hi" });

    const branches = lib.listBranches(prompt.id);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("main");

    const versions = lib.listVersions(prompt.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.number).toBe(1);
    expect(versions[0]!.content).toBe("Say hi");
    expect(versions[0]!.branch_name).toBe("main");

    expect(prompt.current_version_id).toBe(versions[0]!.id);
    expect(prompt.is_starred).toBe(0);
    expect(prompt.deleted_at).toBeNull();
  });

  it("updates metadata and refreshes updated_at", () => {
    const prompt = lib.createPrompt({ title: "Old", content: "x" });
    const updated = lib.updatePromptMetadata(prompt.id, { title: "New", description: "desc" });
    expect(updated.title).toBe("New");
    expect(updated.description).toBe("desc");
    expect(updated.updated_at >= prompt.updated_at).toBe(true);
    expect(() => lib.updatePromptMetadata(prompt.id, { title: "  " })).toThrow();
  });

  it("duplicates one selected version into a fresh prompt with prompt organization", () => {
    const source = lib.createPrompt({
      title: "Security review",
      description: "Reviews a target",
      icon: "shield",
      content: "Review version one",
    });
    const sourceV1 = lib.listVersions(source.id)[0]!;
    db.prepare("UPDATE versions SET content_format = 'text' WHERE id = ?").run(sourceV1.id);
    const main = lib.listBranches(source.id)[0]!;
    lib.createVersion({ promptId: source.id, branchId: main.id, content: "Review version two" });
    lib.createBranch({
      promptId: source.id,
      name: "concise",
      fromVersionId: sourceV1.id,
    });
    lib.setStarred(source.id, true);
    const tag = lib.createTag({ name: "security" });
    lib.addTagToPrompt(source.id, tag.id);
    const firstCollection = lib.createCollection({ name: "Work" });
    const secondCollection = lib.createCollection({ name: "Favorites" });
    lib.addPromptToCollection(firstCollection.id, source.id, 2);
    lib.addPromptToCollection(secondCollection.id, source.id, 7);
    lib.addNote({ promptId: source.id, body: "Source-only note" });

    const duplicate = lib.duplicatePrompt({
      promptId: source.id,
      versionId: sourceV1.id,
      title: "Security review copy",
    });

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate).toMatchObject({
      title: "Security review copy",
      description: "Reviews a target",
      icon: "shield",
      is_starred: 0,
      deleted_at: null,
    });
    expect(lib.listVersions(duplicate.id)).toMatchObject([
      {
        number: 1,
        branch_name: "main",
        content: "Review version one",
        content_format: "text",
        label: null,
      },
    ]);
    expect(lib.listBranches(duplicate.id).map((branch) => branch.name)).toEqual(["main"]);
    expect(lib.listTagsForPrompt(duplicate.id).map((item) => item.id)).toEqual([tag.id]);
    expect(lib.listCollectionIdsForPrompt(duplicate.id)).toEqual([
      firstCollection.id,
      secondCollection.id,
    ]);
    expect(lib.listNotes(duplicate.id)).toEqual([]);
  });

  it("rejects duplicating a version from another prompt", () => {
    const source = lib.createPrompt({ title: "Source", content: "source" });
    const other = lib.createPrompt({ title: "Other", content: "other" });
    const otherVersion = lib.listVersions(other.id)[0]!;

    expect(() =>
      lib.duplicatePrompt({
        promptId: source.id,
        versionId: otherVersion.id,
        title: "Invalid copy",
      }),
    ).toThrow(`Version ${otherVersion.id} not found on prompt ${source.id}`);
    expect(lib.listPrompts()).toHaveLength(2);
  });

  it("lists prompts with filters and sorting", () => {
    const a = lib.createPrompt({ title: "Alpha", content: "a" });
    const b = lib.createPrompt({ title: "Beta", content: "b" });
    lib.setStarred(b.id, true);

    expect(lib.listPrompts().map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(lib.listPrompts({ starred: true }).map((p) => p.id)).toEqual([b.id]);
    expect(lib.listPrompts({ sort: "title" }).map((p) => p.title)).toEqual(["Alpha", "Beta"]);

    lib.softDeletePrompt(a.id);
    expect(lib.listPrompts().map((p) => p.id)).toEqual([b.id]);
    expect(lib.listPrompts({ includeDeleted: true })).toHaveLength(2);
    lib.restorePrompt(a.id);
    expect(lib.listPrompts()).toHaveLength(2);
  });

  it("hard-deletes a prompt and its children", () => {
    const prompt = lib.createPrompt({ title: "Doomed", content: "x" });
    const tag = lib.createTag({ name: "t1" });
    lib.addTagToPrompt(prompt.id, tag.id);
    lib.addNote({ promptId: prompt.id, body: "note" });

    lib.hardDeletePrompt(prompt.id);
    expect(lib.getPrompt(prompt.id)).toBeNull();
    expect(lib.listVersions(prompt.id)).toHaveLength(0);
    expect(lib.listNotes(prompt.id)).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS c FROM prompt_tags WHERE prompt_id = ?").get(prompt.id))
      .toMatchObject({ c: 0 });
    expect(lib.search("Doomed")).toHaveLength(0);
  });

  it("stores and clears a draft with its exact active base version", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    expect(lib.getDraft(prompt.id)).toBeNull();
    expect(prompt.draft_base_version_id).toBeNull();
    lib.setDraft(prompt.id, "work in progress", prompt.current_version_id!);
    expect(lib.getDraft(prompt.id)).toBe("work in progress");
    expect(lib.getPrompt(prompt.id)?.draft_base_version_id).toBe(prompt.current_version_id);
    lib.setDraft(prompt.id, null);
    expect(lib.getDraft(prompt.id)).toBeNull();
    expect(lib.getPrompt(prompt.id)?.draft_base_version_id).toBeNull();
  });

  it("rejects a draft base from another prompt or an inactive suggestion", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const other = lib.createPrompt({ title: "Other", content: "y" });
    const pending = lib.suggestVariation({
      promptId: prompt.id,
      baseVersionId: prompt.current_version_id!,
      newContent: "candidate",
      rationale: "test",
    }).version;

    expect(() => lib.setDraft(prompt.id, "wrong prompt", other.current_version_id!)).toThrow(
      /not found on prompt/i,
    );
    expect(() => lib.setDraft(prompt.id, "pending", pending.id)).toThrow(/pending/i);
  });
});

describe("versions", () => {
  it("rejects deleting the current or a missing version without changing history", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const currentId = prompt.current_version_id!;

    expect(() => lib.deleteVersion(currentId)).toThrow(/current version/i);
    expect(() => lib.deleteVersion("missing-version")).toThrow("Version not found: missing-version");
    expect(lib.listVersions(prompt.id).map((version) => version.id)).toEqual([currentId]);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(currentId);
  });

  it("rejects deleting pending and rejected suggestion versions", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const suggestion = lib.suggestVariation({
      promptId: prompt.id,
      baseVersionId: prompt.current_version_id!,
      newContent: "candidate",
      rationale: "test",
    }).version;

    expect(() => lib.deleteVersion(suggestion.id)).toThrow(/pending/i);
    lib.rejectSuggestion(suggestion.id);
    expect(() => lib.deleteVersion(suggestion.id)).toThrow(/rejected/i);
    expect(lib.getVersion(suggestion.id)?.status).toBe("rejected");
  });

  it("rechecks version status after acquiring the deletion transaction", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const main = lib.listBranches(prompt.id)[0]!;
    const historical = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "v2",
    });
    lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3" });
    const transaction = db.transaction.bind(db);
    let injectStatusChange = true;
    db.transaction = ((fn) => {
      if (injectStatusChange) {
        injectStatusChange = false;
        db.prepare("UPDATE versions SET status = 'rejected' WHERE id = ?").run(historical.id);
      }
      return transaction(fn);
    }) as Database["transaction"];

    expect(() => lib.deleteVersion(historical.id)).toThrow(/rejected/i);
    expect(lib.getVersion(historical.id)?.status).toBe("rejected");
  });

  it("deletes a historical version without reassigning surviving version numbers", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1 searchable" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v2 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "obsolete needle",
    });
    const v3 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3" });
    lib.setDraft(prompt.id, "draft stays");
    const note = lib.addNote({ promptId: prompt.id, versionId: v2.id, body: "keep this note" });
    lib.addRun({ promptId: prompt.id, versionId: v2.id, tool: "manual" });
    lib.addRating({ targetType: "version", targetId: v2.id, clarity: 4 });

    lib.deleteVersion(v2.id);

    expect(lib.getVersion(v2.id)).toBeNull();
    expect(lib.listVersions(prompt.id).map(({ id, number }) => ({ id, number }))).toEqual([
      { id: prompt.current_version_id, number: 1 },
      { id: v3.id, number: 3 },
    ]);
    expect(lib.getVersion(v3.id)?.parent_version_id).toBeNull();
    expect(lib.getPrompt(prompt.id)).toMatchObject({
      current_version_id: v3.id,
      draft_content: "draft stays",
    });
    expect(lib.listNotes(prompt.id)).toMatchObject([{ id: note.id, version_id: null }]);
    expect(lib.listRuns(prompt.id)).toEqual([]);
    expect(lib.getLatestRating("version", v2.id)).toBeNull();
    expect(lib.search("obsolete needle")).toEqual([]);
    const v4 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v4" });
    expect(v4.number).toBe(4);
  });

  it("clears a draft when its exact base version is deleted", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v2 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v2" });
    lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3" });
    lib.setDraft(prompt.id, "unfinished v2 edit", v2.id);

    lib.deleteVersion(v2.id);

    expect(lib.getPrompt(prompt.id)).toMatchObject({
      draft_content: null,
      draft_base_version_id: null,
    });
  });

  it("preserves version numbers when surviving versions share a timestamp", () => {
    db.transaction(() => {
      db.pragma("defer_foreign_keys = ON");
      db.prepare(
        `INSERT INTO prompts (id, title, current_version_id, created_at, updated_at)
         VALUES ('fixed-prompt', 'Fixed', 'z-first', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO branches (id, prompt_id, name, created_at)
         VALUES ('fixed-branch', 'fixed-prompt', 'main', '2026-09-04T00:00:00.000Z')`,
      ).run();
      const insert = db.prepare(
        `INSERT INTO versions
           (id, prompt_id, branch_id, parent_version_id, number, content, created_at)
         VALUES (?, 'fixed-prompt', 'fixed-branch', ?, ?, ?, '2026-09-04T00:00:00.000Z')`,
      );
      insert.run("z-first", null, 1, "first");
      insert.run("m-delete", "z-first", 2, "middle");
      insert.run("a-last", "m-delete", 3, "last");
    })();

    lib.deleteVersion("m-delete");

    expect(lib.listVersions("fixed-prompt").map(({ id, number }) => ({ id, number }))).toEqual([
      { id: "z-first", number: 1 },
      { id: "a-last", number: 3 },
    ]);
  });

  it("removes a variation when its only version is deleted", () => {
    const prompt = lib.createPrompt({ title: "P", content: "main" });
    const { branch, version } = lib.createBranch({
      promptId: prompt.id,
      name: "temporary",
      fromVersionId: prompt.current_version_id!,
    });

    lib.deleteVersion(version.id);

    expect(lib.getVersion(version.id)).toBeNull();
    expect(lib.listBranches(prompt.id).map((item) => item.id)).not.toContain(branch.id);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(prompt.current_version_id);
  });

  it("sets and clears a version's custom display label", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const version = lib.listVersions(prompt.id)[0]!;

    expect(lib.updateVersionLabel(version.id, "  Production  ").label).toBe("Production");
    expect(lib.updateVersionLabel(version.id, "   ").label).toBeNull();
    expect(lib.getVersion(version.id)?.number).toBe(1);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(version.id);
  });

  it("rejects renaming a missing version", () => {
    expect(() => lib.updateVersionLabel("missing-version", "Production")).toThrow(
      "Version not found: missing-version",
    );
  });

  it("amends the exact active version without changing its identity or preferred pointer", () => {
    const prompt = lib.createPrompt({ title: "P", content: "original amber wording" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v1 = lib.getVersion(prompt.current_version_id!)!;
    const v2 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "preferred second version",
      changeNote: "advance preferred",
      label: "Production",
    });

    const amended = lib.updateVersionContent(v1.id, "revised cobalt wording");

    expect(amended).toEqual({ ...v1, content: "revised cobalt wording" });
    expect(lib.listVersions(prompt.id)).toHaveLength(2);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(v2.id);
    expect(lib.search("cobalt").map((result) => result.promptId)).toEqual([prompt.id]);
    expect(lib.search("amber")).toEqual([]);
  });

  it("preserves legacy run snapshots before amending a version", () => {
    const prompt = lib.createPrompt({ title: "P", content: "exact text used by legacy run" });
    const versionId = prompt.current_version_id!;
    const legacy = lib.addRun({ promptId: prompt.id, versionId });
    const captured = lib.addRun({
      promptId: prompt.id,
      versionId,
      promptContent: "already captured substituted text",
    });

    lib.updateVersionContent(versionId, "new editor content");

    const runs = lib.listRuns(prompt.id);
    expect(runs.find((run) => run.id === legacy.id)?.prompt_content).toBe(
      "exact text used by legacy run",
    );
    expect(runs.find((run) => run.id === captured.id)?.prompt_content).toBe(
      "already captured substituted text",
    );
  });

  it("rejects amending missing, pending, or rejected versions", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const suggestion = lib.suggestVariation({
      promptId: prompt.id,
      baseVersionId: prompt.current_version_id!,
      newContent: "candidate",
      rationale: "test",
    }).version;

    expect(() => lib.updateVersionContent("missing-version", "new text")).toThrow(
      "Version not found: missing-version",
    );
    expect(() => lib.updateVersionContent(suggestion.id, "new text")).toThrow(/pending/i);
    lib.rejectSuggestion(suggestion.id);
    expect(() => lib.updateVersionContent(suggestion.id, "new text")).toThrow(/rejected/i);
    expect(lib.getVersion(suggestion.id)?.content).toBe("candidate");
  });

  it("commits the first non-empty save into an empty version 1 placeholder", () => {
    const prompt = lib.createPrompt({ title: "P", content: "" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v1Id = prompt.current_version_id!;

    const saved = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "first committed content",
      changeNote: "initial prompt",
    });

    expect(saved.id).toBe(v1Id);
    expect(saved.number).toBe(1);
    expect(saved.parent_version_id).toBeNull();
    expect(saved.content).toBe("first committed content");
    expect(saved.change_note).toBe("initial prompt");
    expect(lib.listVersions(prompt.id)).toHaveLength(1);
    expect(lib.getPrompt(prompt.id)!.current_version_id).toBe(v1Id);
    expect(lib.search("committed content").map((result) => result.promptId)).toEqual([prompt.id]);

    const v2 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "second committed content",
    });
    expect(v2.number).toBe(2);
    expect(v2.parent_version_id).toBe(v1Id);
    expect(lib.listVersions(prompt.id)).toHaveLength(2);
  });

  it("auto-increments per-branch numbers, updates current pointer and stores change notes", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1 content" });
    const main = lib.listBranches(prompt.id)[0]!;

    const v2 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "v2 content",
      changeNote: "tightened wording",
    });
    expect(v2.number).toBe(2);
    expect(v2.change_note).toBe("tightened wording");
    expect(v2.parent_version_id).toBe(prompt.current_version_id);

    const v3 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3 content" });
    expect(v3.number).toBe(3);
    expect(v3.parent_version_id).toBe(v2.id);
    expect(lib.getPrompt(prompt.id)!.current_version_id).toBe(v3.id);
    expect(lib.getBranchHead(main.id)!.id).toBe(v3.id);
  });

  it("waits for a concurrent writer before creating a version from a fresh snapshot", async () => {
    const scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "promptbr0-version-lock-"));
    const databasePath = path.join(scratchDirectory, "library.db");
    const releasePath = path.join(scratchDirectory, "release.command");
    const diskDatabase = openDatabase(databasePath).db;
    const diskLibrary = new PromptLibrary(diskDatabase);
    const prompt = diskLibrary.createPrompt({ title: "Concurrent", content: "v1" });
    const main = diskLibrary.listBranches(prompt.id)[0]!;
    const helper = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, "fixtures", "hold-write-lock.mjs"),
        databasePath,
        prompt.id,
        main.id,
        prompt.current_version_id!,
        releasePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    // SQLite waits up to 3 seconds for a writer. The synchronous wait blocks
    // this process's event loop, so allow the helper's release output to be
    // delivered after that contention window rather than racing the timeout.
    const helperExit = waitForSuccessfulExit(helper, 5_000);
    const helperClosed = observeExit(helper);
    let helperReleased: Promise<void> | null = null;

    try {
      await waitForOutput(helper, "locked", 5_000);
      helperReleased = waitForOutput(helper, "released", 5_000);
      let transactionMode: "deferred" | "immediate" | null = null;
      let releaseSent = false;
      const releaseWriter = (): void => {
        if (releaseSent) return;
        releaseSent = true;
        fs.writeFileSync(releasePath, "release\n", { flag: "wx" });
      };
      const originalTransaction = diskDatabase.transaction.bind(diskDatabase);
      diskDatabase.transaction = ((fn) => {
        const transaction = originalTransaction(fn);
        const wrapped = (...args: unknown[]) => {
          transactionMode = "deferred";
          return Reflect.apply(transaction, transaction, args);
        };
        Object.defineProperties(wrapped, {
          default: { value: wrapped },
          deferred: { value: wrapped },
          immediate: {
            value: (...args: unknown[]) => {
              transactionMode = "immediate";
              releaseWriter();
              return Reflect.apply(transaction.immediate, transaction, args);
            },
          },
          exclusive: {
            value: (...args: unknown[]) => Reflect.apply(transaction.exclusive, transaction, args),
          },
        });
        return wrapped;
      }) as Database["transaction"];
      const originalPrepare = diskDatabase.prepare.bind(diskDatabase);
      diskDatabase.prepare = ((source) => {
        const statement = originalPrepare(source);
        if (
          typeof source !== "string" ||
          !source.includes("SELECT * FROM versions WHERE branch_id = ?")
        ) {
          return statement;
        }
        return new Proxy(statement, {
          get(target, property, receiver) {
            if (property !== "get") return Reflect.get(target, property, receiver);
            return (...args: unknown[]) => {
              const row = Reflect.apply(target.get, target, args);
              if (transactionMode === "deferred") releaseWriter();
              return row;
            };
          },
        });
      }) as Database["prepare"];
      let saved: ReturnType<PromptLibrary["createVersion"]> | undefined;
      let createError: unknown;
      try {
        saved = diskLibrary.createVersion({
          promptId: prompt.id,
          branchId: main.id,
          content: "v3 after concurrent writer",
        });
      } catch (error) {
        createError = error;
      }
      if (createError && transactionMode === null) throw createError;
      expect(fs.readFileSync(releasePath, "utf8")).toBe("release\n");
      await helperReleased;
      await helperExit;

      if (createError) {
        expect(transactionMode).toBe("deferred");
        expect(createError).toMatchObject({ code: expect.stringMatching(/^SQLITE_BUSY/) });
        expect(diskLibrary.listVersions(prompt.id).map(({ id, number }) => ({ id, number })))
          .toEqual([
            { id: prompt.current_version_id, number: 1 },
            { id: "concurrent-writer-version", number: 2 },
          ]);
        expect(diskLibrary.getPrompt(prompt.id)?.current_version_id)
          .toBe("concurrent-writer-version");
        throw createError;
      }

      expect(transactionMode).toBe("immediate");
      expect(saved).toMatchObject({
        number: 3,
        parent_version_id: "concurrent-writer-version",
        content: "v3 after concurrent writer",
      });
      expect(diskLibrary.listVersions(prompt.id).map(({ id, number, parent_version_id }) => ({
        id,
        number,
        parent_version_id,
      }))).toEqual([
        { id: prompt.current_version_id, number: 1, parent_version_id: null },
        {
          id: "concurrent-writer-version",
          number: 2,
          parent_version_id: prompt.current_version_id,
        },
        { id: saved!.id, number: 3, parent_version_id: "concurrent-writer-version" },
      ]);
      expect(diskLibrary.getPrompt(prompt.id)?.current_version_id).toBe(saved!.id);
    } finally {
      if (helper.exitCode === null) {
        if (!fs.existsSync(releasePath)) fs.writeFileSync(releasePath, "release\n");
      }
      await helperExit.catch(() => {
        if (helper.exitCode === null) helper.kill();
      });
      await helperReleased?.catch(() => undefined);
      await helperClosed;
      diskDatabase.close();
      fs.rmSync(scratchDirectory, { recursive: true, force: true });
    }
  }, 10_000);

  it("appends from an explicit historical base without changing the preferred version", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v1 = prompt.current_version_id!;
    const v2 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v2" });
    const v3 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3" });

    const v4 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      baseVersionId: v1,
      content: "new direction from v1",
    });

    expect(v4.number).toBe(4);
    expect(v4.parent_version_id).toBe(v1);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(v3.id);

    const v5 = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      baseVersionId: v3.id,
      content: "preferred continues",
    });
    expect(v5.number).toBe(5);
    expect(v5.parent_version_id).toBe(v3.id);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(v5.id);
    expect(v2.parent_version_id).toBe(v1);
  });

  it("rejects an explicit version base outside the supplied active variation", () => {
    const prompt = lib.createPrompt({ title: "P", content: "v1" });
    const main = lib.listBranches(prompt.id)[0]!;
    const pending = lib.suggestVariation({
      promptId: prompt.id,
      baseVersionId: prompt.current_version_id!,
      newContent: "candidate",
      rationale: "test",
    }).version;
    const other = lib.createPrompt({ title: "Other", content: "other" });

    expect(() =>
      lib.createVersion({
        promptId: prompt.id,
        branchId: main.id,
        baseVersionId: other.current_version_id!,
        content: "wrong prompt",
      }),
    ).toThrow(/not found on prompt/i);
    expect(() =>
      lib.createVersion({
        promptId: prompt.id,
        branchId: main.id,
        baseVersionId: pending.id,
        content: "pending base",
      }),
    ).toThrow(/pending/i);
  });

  it("restores an older version as current", () => {
    const prompt = lib.createPrompt({ title: "P", content: "first" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v1Id = prompt.current_version_id!;
    const v2 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "second" });
    expect(lib.getPrompt(prompt.id)!.current_version_id).toBe(v2.id);

    const restored = lib.setCurrentVersion(prompt.id, v1Id);
    expect(restored.current_version_id).toBe(v1Id);
  });

  it("rejects versions on a branch belonging to another prompt", () => {
    const a = lib.createPrompt({ title: "A", content: "x" });
    const b = lib.createPrompt({ title: "B", content: "y" });
    const branchOfB = lib.listBranches(b.id)[0]!;
    expect(() =>
      lib.createVersion({ promptId: a.id, branchId: branchOfB.id, content: "nope" }),
    ).toThrow();
  });
});

describe("branches", () => {
  it("creates a branch copying content with parent_version_id set", () => {
    const prompt = lib.createPrompt({ title: "P", content: "base content" });
    const { branch, version } = lib.createBranch({
      promptId: prompt.id,
      name: "experiment",
      fromVersionId: prompt.current_version_id!,
    });

    expect(branch.prompt_id).toBe(prompt.id);
    expect(version.number).toBe(1);
    expect(version.branch_id).toBe(branch.id);
    expect(version.content).toBe("base content");
    expect(version.parent_version_id).toBe(prompt.current_version_id);
    expect(lib.getPrompt(prompt.id)?.current_version_id).toBe(prompt.current_version_id);
    expect(lib.listBranches(prompt.id).map((b) => b.name).sort()).toEqual(["experiment", "main"]);
  });

  it("numbers versions independently per branch", () => {
    const prompt = lib.createPrompt({ title: "P", content: "base" });
    const { branch } = lib.createBranch({
      promptId: prompt.id,
      name: "alt",
      fromVersionId: prompt.current_version_id!,
    });
    const v = lib.createVersion({ promptId: prompt.id, branchId: branch.id, content: "alt v2" });
    expect(v.number).toBe(2);
  });

  it("rejects duplicate branch names on the same prompt", () => {
    const prompt = lib.createPrompt({ title: "P", content: "base" });
    lib.createBranch({ promptId: prompt.id, name: "alt", fromVersionId: prompt.current_version_id! });
    expect(() =>
      lib.createBranch({ promptId: prompt.id, name: "alt", fromVersionId: prompt.current_version_id! }),
    ).toThrow(/already exists/);
  });

  it("rejects creating an active variation from a pending or rejected suggestion", () => {
    const prompt = lib.createPrompt({ title: "P", content: "base" });
    const pending = lib.suggestVariation({
      promptId: prompt.id,
      baseVersionId: prompt.current_version_id!,
      newContent: "candidate",
      rationale: "test",
    }).version;

    expect(() =>
      lib.createBranch({ promptId: prompt.id, name: "pending-copy", fromVersionId: pending.id }),
    ).toThrow(/pending/i);
    lib.rejectSuggestion(pending.id);
    expect(() =>
      lib.createBranch({ promptId: prompt.id, name: "rejected-copy", fromVersionId: pending.id }),
    ).toThrow(/rejected/i);
  });

  it("parents new versions on the branch head, independently of main", () => {
    const prompt = lib.createPrompt({ title: "P", content: "base" });
    const main = lib.listBranches(prompt.id)[0]!;
    const { branch, version: branchV1 } = lib.createBranch({
      promptId: prompt.id,
      name: "alt",
      fromVersionId: prompt.current_version_id!,
    });

    // Saving on the branch chains off the branch head, not main's.
    const branchV2 = lib.createVersion({ promptId: prompt.id, branchId: branch.id, content: "alt v2" });
    expect(branchV2.number).toBe(2);
    expect(branchV2.parent_version_id).toBe(branchV1.id);

    // ...and saving on main still chains off main's head.
    const mainV2 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "main v2" });
    expect(mainV2.number).toBe(2);
    expect(mainV2.parent_version_id).toBe(prompt.current_version_id);
    expect(lib.getBranchHead(branch.id)!.id).toBe(branchV2.id);
    expect(lib.getBranchHead(main.id)!.id).toBe(mainV2.id);
  });
});

describe("tags and collections", () => {
  it("adds/removes tags and reports usage counts", () => {
    const p1 = lib.createPrompt({ title: "P1", content: "x" });
    const p2 = lib.createPrompt({ title: "P2", content: "y" });
    const tag = lib.createTag({ name: "coding", color: "#f00" });
    const other = lib.createTag({ name: "writing" });

    lib.addTagToPrompt(p1.id, tag.id);
    lib.addTagToPrompt(p2.id, tag.id);
    lib.addTagToPrompt(p1.id, tag.id); // idempotent

    let tags = lib.listTags();
    expect(tags.find((t) => t.id === tag.id)!.usage_count).toBe(2);
    expect(tags.find((t) => t.id === other.id)!.usage_count).toBe(0);

    lib.setPromptTags(p2.id, [other.id]);
    tags = lib.listTags();
    expect(tags.find((t) => t.id === tag.id)!.usage_count).toBe(1);
    expect(tags.find((t) => t.id === other.id)!.usage_count).toBe(1);

    lib.removeTagFromPrompt(p1.id, tag.id);
    expect(lib.listTags().find((t) => t.id === tag.id)!.usage_count).toBe(0);
    expect(lib.listPrompts({ tagIds: [other.id] }).map((p) => p.id)).toEqual([p2.id]);
  });

  it("manages collection membership and counts", () => {
    const p1 = lib.createPrompt({ title: "P1", content: "x" });
    const p2 = lib.createPrompt({ title: "P2", content: "y" });
    const collection = lib.createCollection({ name: "Favorites" });

    lib.addPromptToCollection(collection.id, p1.id);
    lib.addPromptToCollection(collection.id, p2.id);
    lib.addPromptToCollection(collection.id, p1.id); // idempotent

    expect(lib.listCollections()[0]!.prompt_count).toBe(2);
    expect(lib.listPrompts({ collectionId: collection.id })).toHaveLength(2);

    lib.removePromptFromCollection(collection.id, p1.id);
    expect(lib.listCollections()[0]!.prompt_count).toBe(1);
  });

  it("creates a prompt directly inside a collection", () => {
    const collection = lib.createCollection({ name: "Favorites" });

    const prompt = lib.createPrompt({
      title: "Collected prompt",
      content: "x",
      collectionId: collection.id,
    });

    expect(lib.listCollectionIdsForPrompt(prompt.id)).toEqual([collection.id]);
    expect(lib.listPrompts({ collectionId: collection.id }).map((row) => row.id)).toEqual([
      prompt.id,
    ]);
  });

  it("rolls back prompt creation when its collection does not exist", () => {
    expect(() =>
      lib.createPrompt({ title: "Orphan", content: "x", collectionId: "missing" }),
    ).toThrow();

    expect(lib.listPrompts()).toEqual([]);
  });

  it("builds a recursive tree with prompt counts across nested folders", () => {
    const root = lib.createCollection({ name: "Root" });
    const child1 = lib.createCollection({ name: "Child 1", parentCollectionId: root.id });
    const child2 = lib.createCollection({ name: "Child 2", parentCollectionId: root.id });
    const grandchild = lib.createCollection({ name: "Grandchild", parentCollectionId: child1.id });

    const p1 = lib.createPrompt({ title: "P1", content: "a" });
    const p2 = lib.createPrompt({ title: "P2", content: "b" });
    const p3 = lib.createPrompt({ title: "P3", content: "c" });
    lib.addPromptToCollection(root.id, p1.id);
    lib.addPromptToCollection(child1.id, p2.id);
    lib.addPromptToCollection(grandchild.id, p3.id);

    const tree = lib.getCollectionTree();
    expect(tree.id).toBe("root");
    expect(tree.name).toBe("");
    expect(tree.promptCount).toBe(3);
    expect(tree.children).toHaveLength(1);

    const rootNode = tree.children[0]!;
    expect(rootNode.id).toBe(root.id);
    expect(rootNode.name).toBe("Root");
    expect(rootNode.promptCount).toBe(3);
    expect(rootNode.children).toHaveLength(2);

    // Child 1 should have 2 prompts (own + grandchild's)
    const child1Node = rootNode.children.find((c) => c.id === child1.id)!;
    expect(child1Node.promptCount).toBe(2);
    expect(child1Node.children).toHaveLength(1);
    expect(child1Node.children[0]!.promptCount).toBe(1);

    // Child 2 should have 0 prompts
    const child2Node = rootNode.children.find((c) => c.id === child2.id)!;
    expect(child2Node.promptCount).toBe(0);
  });

  it("recursive listPrompts includes descendant collections", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: parent.id });

    const p1 = lib.createPrompt({ title: "Parent prompt", content: "x" });
    const p2 = lib.createPrompt({ title: "Child prompt", content: "y" });
    lib.addPromptToCollection(parent.id, p1.id);
    lib.addPromptToCollection(child.id, p2.id);

    // Querying parent should return both prompts
    expect(lib.listPrompts({ collectionId: parent.id })).toHaveLength(2);
    // Querying child should return only child's prompt
    expect(lib.listPrompts({ collectionId: child.id })).toHaveLength(1);
  });

  it("recursive search includes descendant collections", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: parent.id });

    const p1 = lib.createPrompt({ title: "Shared prompt", content: "x" });
    const p2 = lib.createPrompt({ title: "Other prompt", content: "shared content" });
    lib.addPromptToCollection(parent.id, p1.id);
    lib.addPromptToCollection(child.id, p2.id);

    // Search for "shared" — matches both prompts; collection filter should include descendants.
    const results = lib.search("shared", { collectionId: parent.id });
    expect(results.map((r) => r.promptId)).toContain(p1.id);
    expect(results.map((r) => r.promptId)).toContain(p2.id);
  });

  it("updateCollection changes parent with cycle guard", () => {
    const a = lib.createCollection({ name: "A" });
    const b = lib.createCollection({ name: "B", parentCollectionId: a.id });
    const c = lib.createCollection({ name: "C", parentCollectionId: b.id });

    // Moving C under A should succeed (A is ancestor of C's current parent)
    lib.updateCollection(c.id, { parentCollectionId: a.id });
    const collections = lib.listCollections();
    const updatedC = collections.find((col) => col.id === c.id);
    expect(updatedC?.parent_collection_id).toBe(a.id);

    // Moving A under C should fail (cycle: A is ancestor of C)
    expect(() => lib.updateCollection(a.id, { parentCollectionId: c.id })).toThrow(
      "A collection cannot be moved under one of its descendants",
    );
  });

  it("deleteCollection cascades to descendants and removes prompt membership", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: parent.id });

    const p1 = lib.createPrompt({ title: "P1", content: "x" });
    const p2 = lib.createPrompt({ title: "P2", content: "y" });
    lib.addPromptToCollection(parent.id, p1.id);
    lib.addPromptToCollection(child.id, p2.id);

    lib.deleteCollection(parent.id);

    // Both collections should be gone
    const remaining = lib.listCollections();
    expect(remaining.some((c) => c.id === parent.id)).toBe(false);
    expect(remaining.some((c) => c.id === child.id)).toBe(false);

    // Prompts should still exist but lose collection membership
    expect(lib.getPrompt(p1.id)).toBeDefined();
    expect(lib.getPrompt(p2.id)).toBeDefined();
    expect(lib.listCollectionIdsForPrompt(p1.id)).toEqual([]);
    expect(lib.listCollectionIdsForPrompt(p2.id)).toEqual([]);
  });

  it("getCollectionPath returns full breadcrumb from root to collection", () => {
    const root = lib.createCollection({ name: "Root" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: root.id });
    const grandchild = lib.createCollection({ name: "Grandchild", parentCollectionId: child.id });

    // Root collection path
    const rootPath = lib.getCollectionPath(root.id);
    expect(rootPath).toEqual([{ id: root.id, name: "Root", parent_collection_id: null }]);

    // Child collection path
    const childPath = lib.getCollectionPath(child.id);
    expect(childPath).toEqual([
      { id: root.id, name: "Root", parent_collection_id: null },
      { id: child.id, name: "Child", parent_collection_id: root.id },
    ]);

    // Grandchild collection path
    const grandchildPath = lib.getCollectionPath(grandchild.id);
    expect(grandchildPath).toEqual([
      { id: root.id, name: "Root", parent_collection_id: null },
      { id: child.id, name: "Child", parent_collection_id: root.id },
      { id: grandchild.id, name: "Grandchild", parent_collection_id: child.id },
    ]);
  });

  it("getCollectionPath throws for non-existent collection", () => {
    expect(() => lib.getCollectionPath("non-existent-id")).toThrow("Collection not found");
  });

  it("getCollectionPath handles siblings with same name under different parents", () => {
    const parentA = lib.createCollection({ name: "Section" });
    const parentB = lib.createCollection({ name: "Section" });

    const childA = lib.createCollection({ name: "Page", parentCollectionId: parentA.id });
    const childB = lib.createCollection({ name: "Page", parentCollectionId: parentB.id });

    const pathA = lib.getCollectionPath(childA.id);
    expect(pathA).toEqual([
      { id: parentA.id, name: "Section", parent_collection_id: null },
      { id: childA.id, name: "Page", parent_collection_id: parentA.id },
    ]);

    const pathB = lib.getCollectionPath(childB.id);
    expect(pathB).toEqual([
      { id: parentB.id, name: "Section", parent_collection_id: null },
      { id: childB.id, name: "Page", parent_collection_id: parentB.id },
    ]);
  });

  it("reorders top-level collections with dense sort orders", () => {
    const a = lib.createCollection({ name: "A" });
    const b = lib.createCollection({ name: "B" });
    const c = lib.createCollection({ name: "C" });

    lib.moveCollection({ id: c.id, parentCollectionId: null, targetIndex: 0 });

    const ordered = lib.listCollectionsByParent(null);
    expect(ordered.map((row) => row.name)).toEqual(["C", "A", "B"]);
    expect(ordered.map((row) => row.sort_order)).toEqual([0, 1, 2]);
    expect(lib.getCollectionTree().children.map((node) => node.name)).toEqual(["C", "A", "B"]);
  });

  it("moves a collection into another folder at a chosen index", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const first = lib.createCollection({ name: "First", parentCollectionId: parent.id });
    const second = lib.createCollection({ name: "Second", parentCollectionId: parent.id });
    const moving = lib.createCollection({ name: "Moving" });

    lib.moveCollection({ id: moving.id, parentCollectionId: parent.id, targetIndex: 1 });

    expect(lib.listCollectionsByParent(parent.id).map((row) => row.name)).toEqual([
      "First",
      "Moving",
      "Second",
    ]);
    expect(lib.listCollectionsByParent(null).map((row) => row.name)).toEqual(["Parent"]);
    expect(lib.getCollectionPath(moving.id).map((row) => row.name)).toEqual(["Parent", "Moving"]);
    // Existing children keep their relative order.
    expect(lib.listCollectionsByParent(parent.id).find((row) => row.id === first.id)!.sort_order).toBe(0);
    expect(lib.listCollectionsByParent(parent.id).find((row) => row.id === second.id)!.sort_order).toBe(2);
  });

  it("returns a nested collection to the top level at the requested index", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: parent.id });
    const sibling = lib.createCollection({ name: "Sibling" });

    lib.moveCollection({ id: child.id, parentCollectionId: null, targetIndex: 0 });

    expect(lib.listCollectionsByParent(null).map((row) => row.name)).toEqual(["Child", "Parent", "Sibling"]);
    expect(lib.listCollectionsByParent(parent.id)).toEqual([]);
    expect(lib.getCollectionPath(child.id)).toEqual([
      { id: child.id, name: "Child", parent_collection_id: null },
    ]);
    expect(sibling.parent_collection_id).toBeNull();
  });

  it("clamps a target index past the end of the sibling list", () => {
    const a = lib.createCollection({ name: "A" });
    lib.createCollection({ name: "B" });

    lib.moveCollection({ id: a.id, parentCollectionId: null, targetIndex: 99 });

    expect(lib.listCollectionsByParent(null).map((row) => row.name)).toEqual(["B", "A"]);
  });

  it("rejects moving a collection into itself or a descendant", () => {
    const parent = lib.createCollection({ name: "Parent" });
    const child = lib.createCollection({ name: "Child", parentCollectionId: parent.id });
    const grandchild = lib.createCollection({ name: "Grandchild", parentCollectionId: child.id });

    expect(() => lib.moveCollection({ id: parent.id, parentCollectionId: parent.id, targetIndex: 0 }))
      .toThrow("A collection cannot be moved under one of its descendants");
    expect(() => lib.moveCollection({ id: parent.id, parentCollectionId: grandchild.id, targetIndex: 0 }))
      .toThrow("A collection cannot be moved under one of its descendants");
  });

  it("rejects moving under a missing parent", () => {
    const collection = lib.createCollection({ name: "Lonely" });

    expect(() =>
      lib.moveCollection({ id: collection.id, parentCollectionId: "missing", targetIndex: 0 }),
    ).toThrow("Collection not found");
  });

  it("appends newly created collections after their siblings", () => {
    const first = lib.createCollection({ name: "Zeta" });
    const second = lib.createCollection({ name: "Alpha" });
    const child = lib.createCollection({ name: "Nested", parentCollectionId: first.id });

    expect(second.sort_order).toBe(1);
    expect(child.sort_order).toBe(0);
    expect(lib.listCollectionsByParent(null).map((row) => row.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("does not rewrite sort orders for a no-op move", () => {
    const a = lib.createCollection({ name: "A" });
    const b = lib.createCollection({ name: "B" });
    const before = lib.listCollectionsByParent(null).map((row) => [row.id, row.sort_order]);

    lib.moveCollection({ id: b.id, parentCollectionId: null, targetIndex: 1 });

    expect(lib.listCollectionsByParent(null).map((row) => [row.id, row.sort_order])).toEqual(before);
    expect(lib.listCollectionsByParent(null).map((row) => row.id)).toEqual([a.id, b.id]);
  });
});

describe("ratings", () => {
  it("rejects out-of-range and empty scores", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    expect(() =>
      lib.addRating({ targetType: "prompt", targetId: prompt.id, effectiveness: 6 }),
    ).toThrow(/between 1 and 5/);
    expect(() =>
      lib.addRating({ targetType: "prompt", targetId: prompt.id, clarity: 0 }),
    ).toThrow(/between 1 and 5/);
    expect(() => lib.addRating({ targetType: "prompt", targetId: prompt.id })).toThrow(
      /at least one dimension/,
    );
  });

  it("returns latest rating and per-dimension averages", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    lib.addRating({ targetType: "prompt", targetId: prompt.id, effectiveness: 4, clarity: 2 });
    const second = lib.addRating({
      targetType: "prompt",
      targetId: prompt.id,
      effectiveness: 2,
      completeness: 5,
    });

    const latest = lib.getLatestRating("prompt", prompt.id);
    expect(latest!.id).toBe(second.id);

    const avg = lib.getAverageRatings("prompt", prompt.id);
    expect(avg.count).toBe(2);
    expect(avg.effectiveness).toBeCloseTo(3);
    expect(avg.clarity).toBeCloseTo(2);
    expect(avg.completeness).toBeCloseTo(5);
    expect(avg.actionability).toBeNull();
    expect(avg.overall).toBeCloseTo((4 + 2 + 2 + 5) / 4);
  });

  it("rates versions too", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    lib.addRating({ targetType: "version", targetId: versionId, actionability: 5 });
    expect(lib.getLatestRating("version", versionId)!.actionability).toBe(5);
  });

  it("summarizes version ratings per prompt", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const main = lib.listBranches(prompt.id)[0]!;
    const v1Id = prompt.current_version_id!;
    const v2 = lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v2" });
    const unrated = lib.createVersion({
      promptId: prompt.id,
      branchId: main.id,
      content: "unrated",
    });

    lib.addRating({ targetType: "version", targetId: v1Id, effectiveness: 4, clarity: 2 });
    lib.addRating({ targetType: "version", targetId: v1Id, effectiveness: 2 });
    lib.addRating({ targetType: "version", targetId: v2.id, completeness: 5 });
    const other = lib.createPrompt({ title: "Q", content: "y" });
    lib.addRating({ targetType: "version", targetId: other.current_version_id!, clarity: 1 });

    const summaries = lib.getVersionRatingSummaries(prompt.id);
    expect(summaries).toHaveLength(2);
    const s1 = summaries.find((s) => s.version_id === v1Id)!;
    expect(s1.count).toBe(2);
    expect(s1.effectiveness).toBeCloseTo(3);
    expect(s1.clarity).toBeCloseTo(2);
    expect(s1.completeness).toBeNull();
    expect(s1.actionability).toBeNull();
    expect(s1.overall).toBeCloseTo((4 + 2 + 2) / 3);
    const s2 = summaries.find((s) => s.version_id === v2.id)!;
    expect(s2.effectiveness).toBeNull();
    expect(s2.clarity).toBeNull();
    expect(s2.completeness).toBeCloseTo(5);
    expect(s2.actionability).toBeNull();
    expect(s2.overall).toBeCloseTo(5);
    expect(summaries.find((s) => s.version_id === unrated.id)).toBeUndefined();
    expect(summaries.find((s) => s.version_id === other.current_version_id)).toBeUndefined();
  });

  it("summarizes every rated version with one select", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const main = lib.listBranches(prompt.id)[0]!;
    const versionIds = [
      prompt.current_version_id!,
      lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v2" }).id,
      lib.createVersion({ promptId: prompt.id, branchId: main.id, content: "v3" }).id,
    ];
    for (const [index, versionId] of versionIds.entries()) {
      lib.addRating({ targetType: "version", targetId: versionId, effectiveness: index + 1 });
    }

    const prepare = db.prepare.bind(db);
    const selects: string[] = [];
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (/^\s*SELECT\b/i.test(sql)) selects.push(sql);
      return prepare(sql);
    });
    try {
      expect(lib.getVersionRatingSummaries(prompt.id)).toHaveLength(versionIds.length);
      expect(selects).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("sorts and filters prompts by average prompt-level rating", () => {
    const low = lib.createPrompt({ title: "Low", content: "x" });
    const high = lib.createPrompt({ title: "High", content: "y" });
    const unrated = lib.createPrompt({ title: "Unrated", content: "z" });

    lib.addRating({ targetType: "prompt", targetId: low.id, effectiveness: 2 });
    lib.addRating({ targetType: "prompt", targetId: high.id, effectiveness: 5, clarity: 4 });

    const sorted = lib.listPrompts({ sort: "rating" });
    expect(sorted.map((p) => p.title)).toEqual(["High", "Low", "Unrated"]);

    expect(lib.listPrompts({ minRating: 4 }).map((p) => p.title)).toEqual(["High"]);
    expect(lib.listPrompts({ minRating: 2 }).map((p) => p.title).sort()).toEqual(["High", "Low"]);
    expect(lib.listPrompts({ sort: "rating", minRating: 4 }).map((p) => p.title)).toEqual(["High"]);

    // Version-targeted ratings must not affect prompt-level filtering.
    lib.addRating({ targetType: "version", targetId: unrated.current_version_id!, effectiveness: 5 });
    expect(lib.listPrompts({ minRating: 4 }).map((p) => p.title)).toEqual(["High"]);
  });

  it("lists large rated libraries without per-prompt rating scans", () => {
    const insertPrompt = db.prepare(
      `INSERT INTO prompts (id, title, created_at, updated_at)
       VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    const insertRating = db.prepare(
      `INSERT INTO ratings (
         id, target_type, target_id, effectiveness, clarity,
         completeness, actionability, created_at
       ) VALUES (?, 'prompt', ?, 5, 4, 3, 2, '2026-01-01T00:00:00.000Z')`,
    );
    db.transaction(() => {
      for (let promptIndex = 0; promptIndex < 2_000; promptIndex++) {
        const promptId = `perf-prompt-${promptIndex}`;
        insertPrompt.run(promptId, `Prompt ${promptIndex}`);
        for (let ratingIndex = 0; ratingIndex < 4; ratingIndex++) {
          insertRating.run(`perf-rating-${promptIndex}-${ratingIndex}`, promptId);
        }
      }
    })();

    const plainStarted = performance.now();
    expect(lib.listPrompts()).toHaveLength(2_000);
    const plainElapsed = performance.now() - plainStarted;

    const ratedStarted = performance.now();
    expect(lib.listPrompts({ sort: "rating" })).toHaveLength(2_000);
    const ratedElapsed = performance.now() - ratedStarted;

    expect(plainElapsed).toBeLessThan(500);
    expect(ratedElapsed).toBeLessThan(500);
  });
});

describe("runs", () => {
  it("records and lists runs with metrics", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;

    const run = lib.addRun({
      promptId: prompt.id,
      versionId,
      tool: "chatgpt",
      model: "gpt-5",
      outcomeRating: 4,
      resultSummary: "worked well",
      metrics: { latencyMs: 820, tokens: 342 },
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(run.tool).toBe("chatgpt");
    expect(JSON.parse(run.metrics_json!)).toEqual({ latencyMs: 820, tokens: 342 });

    lib.addRun({ promptId: prompt.id, versionId });
    const runs = lib.listRuns(prompt.id);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.tool).toBe("manual"); // newest first

    expect(() => lib.addRun({ promptId: prompt.id, versionId, outcomeRating: 9 })).toThrow();
  });

  it("deletes runs", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    const run = lib.addRun({ promptId: prompt.id, versionId, tool: "manual" });
    const keep = lib.addRun({ promptId: prompt.id, versionId, tool: "kimi-cli" });

    lib.deleteRun(run.id);
    expect(lib.listRuns(prompt.id).map((r) => r.id)).toEqual([keep.id]);
    expect(() => lib.deleteRun(run.id)).toThrow(/Run not found/);
  });

  it("merges metrics patches without clobbering existing keys", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    const run = lib.addRun({
      promptId: prompt.id,
      versionId,
      metrics: { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001 },
    });

    const updated = lib.updateRunMetrics(run.id, { judgeRationale: "solid answer" });
    expect(JSON.parse(updated.metrics_json!)).toEqual({
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.001,
      judgeRationale: "solid answer",
    });

    // A run without metrics starts from an empty object; unknown ids throw.
    const bare = lib.addRun({ promptId: prompt.id, versionId });
    expect(JSON.parse(lib.updateRunMetrics(bare.id, { a: 1 }).metrics_json!)).toEqual({ a: 1 });
    expect(() => lib.updateRunMetrics("nope", { a: 1 })).toThrow(/Run not found/);
  });

  it("rejects metrics patches touching reserved execution keys", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    const run = lib.addRun({
      promptId: prompt.id,
      versionId,
      metrics: { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001 },
    });

    expect(() => lib.updateRunMetrics(run.id, { usage: { inputTokens: 1, outputTokens: 1 } })).toThrow(
      /reserved/,
    );
    expect(() => lib.updateRunMetrics(run.id, { costUsd: 0 })).toThrow(/reserved/);
    // A patch mixing a reserved key with a legal one is rejected as a whole.
    expect(() => lib.updateRunMetrics(run.id, { judgeRationale: "ok", costUsd: 9 })).toThrow(/reserved/);
    // The rejection is atomic — the stored blob is untouched.
    const stored = lib.listRuns(prompt.id).find((r) => r.id === run.id)!;
    expect(JSON.parse(stored.metrics_json!)).toEqual({
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.001,
    });
  });

  it("lists the runs of one run group in creation order", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    const first = lib.recordModelRun({
      promptId: prompt.id,
      versionId,
      provider: "prov",
      model: "m1",
      status: "completed",
      output: "one",
      runGroupId: "rg-1",
    });
    const second = lib.recordModelRun({
      promptId: prompt.id,
      versionId,
      provider: "prov",
      model: "m2",
      status: "error",
      error: "boom",
      runGroupId: "rg-1",
    });
    lib.addRun({ promptId: prompt.id, versionId, tool: "manual" }); // no group

    expect(lib.listRunGroupRuns("rg-1").map((r) => r.id)).toEqual([first.id, second.id]);
    expect(lib.listRunGroupRuns("rg-unknown")).toEqual([]);
  });
});

describe("notes", () => {
  it("adds and lists notes, optionally scoped to a version", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const versionId = prompt.current_version_id!;
    lib.addNote({ promptId: prompt.id, body: "general note" });
    lib.addNote({ promptId: prompt.id, versionId, body: "version note" });

    expect(lib.listNotes(prompt.id)).toHaveLength(2);
    expect(lib.listNotes(prompt.id, versionId)).toHaveLength(1);
    expect(lib.listNotes(prompt.id, versionId)[0]!.body).toBe("version note");
  });
});
