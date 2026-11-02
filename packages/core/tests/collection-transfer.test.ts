import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLivePromptIndex,
  CollectionImportValidationError,
  MAX_COLLECTION_DEPTH,
  openMemoryDatabase,
  PromptLibrary,
  resolveMemberRef,
  type CollectionNode,
  type CollectionTransferFile,
  type Database,
} from "../src/index.js";

let db: Database;
let lib: PromptLibrary;

beforeEach(() => {
  db = openMemoryDatabase();
  lib = new PromptLibrary(db);
});

function file(collection: CollectionNode, meta: Partial<CollectionTransferFile["meta"]> = {}): CollectionTransferFile {
  return { meta: { kind: "collection", schemaVersion: 1, exportedAt: "2026-11-02T10:00:00.000Z", ...meta }, collection };
}

function node(name: string, overrides: Partial<Omit<CollectionNode, "name">> = {}): CollectionNode {
  return { name, sortOrder: 0, members: [], children: [], ...overrides };
}

/** Root "Design" with one child and two members — the canonical fixture. */
function designFile(memberPromptIds: string[]): CollectionTransferFile {
  return file(
    node("Design", {
      sortOrder: 3,
      members: [
        { promptId: memberPromptIds[0] ?? "p1", title: "Audit", sortOrder: 0 },
        { promptId: memberPromptIds[1] ?? "p2", title: "Critique", sortOrder: 1 },
      ],
      children: [node("Heuristics", { sortOrder: 1, members: [{ promptId: "p3", title: "Walkthrough", sortOrder: 0 }] })],
    }),
  );
}

function rootIds(): string[] {
  return lib.listCollectionsByParent(null).map((row) => row.id);
}

function memberIds(database: Database, collectionId: string): string[] {
  return (
    database.prepare("SELECT prompt_id FROM collection_prompts WHERE collection_id = ? ORDER BY sort_order ASC").all(collectionId) as Array<{
      prompt_id: string;
    }>
  ).map((row) => row.prompt_id);
}

describe("exportCollection", () => {
  it("serializes the subtree with nested children, ordered members, and v1 meta", () => {
    const prompt = lib.createPrompt({ title: "Audit", content: "audit" });
    const root = lib.createCollection({ name: "Design", sortOrder: 2 });
    const child = lib.createCollection({ name: "Heuristics", sortOrder: 0, parentCollectionId: root.id });
    lib.addPromptToCollection(root.id, prompt.id, 1);
    lib.addPromptToCollection(child.id, prompt.id, 4);

    const exported = lib.exportCollection(root.id);

    expect(exported.meta).toMatchObject({ kind: "collection", schemaVersion: 1 });
    expect(typeof exported.meta.exportedAt).toBe("string");
    expect(exported.collection.name).toBe("Design");
    expect(exported.collection.sortOrder).toBe(2);
    expect(exported.collection.members).toEqual([{ promptId: prompt.id, title: "Audit", sortOrder: 1 }]);
    expect(exported.collection.children).toHaveLength(1);
    expect(exported.collection.children[0]).toMatchObject({ name: "Heuristics", sortOrder: 0 });
    expect(exported.collection.children[0]!.members).toEqual([{ promptId: prompt.id, title: "Audit", sortOrder: 4 }]);
  });

  it("throws for an unknown collection id", () => {
    expect(() => lib.exportCollection("nope")).toThrow("Collection not found");
  });
});

describe("previewCollectionImport", () => {
  it("reports match classes and collision without writing anything", () => {
    const byId = lib.createPrompt({ title: "Audit", content: "a" });
    lib.createPrompt({ title: "Critique", content: "c" });
    lib.createCollection({ name: "Design" });
    const before = lib.listCollections().length;

    const preview = lib.previewCollectionImport(
      file(
        node("Design", {
          members: [
            { promptId: byId.id, title: "Audit", sortOrder: 0 },
            { promptId: "ghost", title: "Critique", sortOrder: 1 },
            { promptId: "ghost2", title: "No such prompt at all", sortOrder: 2 },
          ],
        }),
      ),
    );

    expect(preview).toEqual({
      rootName: "Design",
      rootCollision: true,
      existingRootId: expect.any(String),
      subcollectionCount: 0,
      memberCount: 3,
      matchedById: 1,
      matchedByTitle: 1,
      unmatchedTitles: ["No such prompt at all"],
    });
    expect(lib.listCollections().length).toBe(before);
  });
});

describe("importCollection — strategies on root collision", () => {
  let existingRootId: string;
  let existingChildId: string;

  beforeEach(() => {
    const root = lib.createCollection({ name: "Design", sortOrder: 5 });
    existingChildId = lib.createCollection({ name: "Heuristics", sortOrder: 0, parentCollectionId: root.id }).id;
    existingRootId = root.id;
  });

  it("skip leaves the existing collection untouched", () => {
    const result = lib.importCollection(designFile([]), { strategy: "skip" });
    expect(result.outcome).toBe("skipped");
    expect(result.collectionsInserted).toBe(0);
    expect(lib.listCollectionsByParent(null)).toHaveLength(1);
    expect(lib.getCollectionTree().children[0]!.children[0]!.id).toBe(existingChildId);
    expect(existingRootId).toBe(lib.getCollectionTree().children[0]!.id);
  });

  it("overwrite removes the old subtree, keeps prompts, and keeps the old position", () => {
    const inOldChild = lib.createPrompt({ title: "Old walkthrough", content: "x" });
    lib.addPromptToCollection(existingChildId, inOldChild.id, 0);

    const result = lib.importCollection(designFile([]), { strategy: "overwrite" });

    expect(result.outcome).toBe("replaced");
    expect(result.collectionsInserted).toBe(2);
    // The old child is gone; the imported subtree exists with fresh ids.
    expect(lib.listCollections().some((row) => row.id === existingChildId)).toBe(false);
    expect(rootIds()).toHaveLength(1);
    // The replaced root kept its old position.
    expect(lib.listCollectionsByParent(null)[0]!.sort_order).toBe(5);
    // Prompts survive untouched even though their old memberships died. The
    // imported "Walkthrough" member links to "Old walkthrough" via the unique
    // substring tier; the file's Audit/Critique members stay unmatched.
    const prompts = lib.listPrompts();
    expect(prompts.map((row) => row.title)).toEqual(["Old walkthrough"]);
    expect(memberIds(db, rootIds()[0]!)).toHaveLength(0);
    expect(memberIds(db, lib.getCollectionTree().children[0]!.children[0]!.id)).toEqual([inOldChild.id]);
    expect(result.membersLinked).toBe(1);
    expect(result.membersUnmatched).toBe(2);
  });

  it("duplicate imports under the first free name (N) suffix", () => {
    const first = lib.importCollection(designFile([]), { strategy: "duplicate" });
    expect(first.outcome).toBe("added");
    expect(first.rootName).toBe("Design (2)");

    const second = lib.importCollection(designFile([]), { strategy: "duplicate" });
    expect(second.rootName).toBe("Design (3)");

    const names = lib.listCollectionsByParent(null).map((row) => row.name);
    expect(names).toEqual(["Design", "Design (2)", "Design (3)"]);
  });

  it("duplicate keeps the suffixed name within the 200-char cap", () => {
    const longName = "y".repeat(200);
    lib.importCollection(file(node(longName)), { strategy: "duplicate" });
    const result = lib.importCollection(file(node(longName)), { strategy: "duplicate" });
    expect(result.rootName.length).toBeLessThanOrEqual(200);
    expect(result.rootName.endsWith(" (2)")).toBe(true);
  });
});

describe("importCollection — add semantics", () => {
  it("imports a fresh subtree at the root, appended last, preserving internal order", () => {
    lib.createCollection({ name: "First", sortOrder: 0 });
    const target = lib.createPrompt({ title: "Audit", content: "a" });

    const result = lib.importCollection(designFile([target.id, "ghost"]), { strategy: "overwrite" });

    expect(result.outcome).toBe("added");
    expect(result.membersLinked).toBe(1);
    expect(result.membersUnmatched).toBe(2); // "Critique" at the root plus "Walkthrough" in the child
    expect(result.unmatchedTitles).toEqual(["Critique", "Walkthrough"]);
    expect(result.collectionsInserted).toBe(2);

    const roots = lib.listCollectionsByParent(null);
    expect(roots.map((row) => row.name)).toEqual(["First", "Design"]);
    expect(roots[1]!.sort_order).toBe(1);
    const design = lib.getCollectionTree().children[1]!;
    expect(design.children[0]!.name).toBe("Heuristics");
    expect(memberIds(db, design.id)).toEqual([target.id]);
  });

  it("resolves members by id, exact title, case-insensitive title, and unique substring", () => {
    const byId = lib.createPrompt({ title: "Totally different", content: "1" });
    const byExact = lib.createPrompt({ title: "Audit", content: "2" });
    const byCi = lib.createPrompt({ title: "CRITIQUE", content: "3" });
    const bySubstring = lib.createPrompt({ title: "Weekly design walkthrough agenda", content: "4" });

    const result = lib.importCollection(
      file(
        node("Ladder", {
          members: [
            { promptId: byId.id, title: "unrelated title", sortOrder: 0 },
            { promptId: "ghost-a", title: "Audit", sortOrder: 1 },
            { promptId: "ghost-b", title: "critique", sortOrder: 2 },
            { promptId: "ghost-c", title: "walkthrough", sortOrder: 3 },
          ],
        }),
      ),
      { strategy: "skip" }, // no collision: skip behaves like add
    );

    expect(result.membersUnmatched).toBe(0);
    expect(memberIds(db, rootIds()[0]!)).toEqual([byId.id, byExact.id, byCi.id, bySubstring.id]);
  });

  it("treats ambiguous titles as unmatched", () => {
    lib.createPrompt({ title: "Audit", content: "1" });
    lib.createPrompt({ title: "Audit", content: "2" });

    const result = lib.importCollection(file(node("Ambiguous", { members: [{ promptId: "ghost", title: "Audit", sortOrder: 0 }] })), { strategy: "overwrite" });

    expect(result.membersUnmatched).toBe(1);
    expect(result.unmatchedTitles).toEqual(["Audit"]);
    expect(memberIds(db, rootIds()[0]!)).toHaveLength(0);
  });

  it("excludes soft-deleted prompts from resolution", () => {
    const trashed = lib.createPrompt({ title: "Audit", content: "1" });
    lib.softDeletePrompt(trashed.id);

    const result = lib.importCollection(file(node("Trashy", { members: [{ promptId: trashed.id, title: "Audit", sortOrder: 0 }] })), { strategy: "overwrite" });

    expect(result.membersUnmatched).toBe(1);
    expect(memberIds(db, rootIds()[0]!)).toHaveLength(0);
  });

  it("merges members that resolve to the same prompt into one membership", () => {
    const prompt = lib.createPrompt({ title: "Audit", content: "1" });

    const result = lib.importCollection(
      file(
        node("Dedup", {
          members: [
            { promptId: prompt.id, title: "Audit", sortOrder: 0 },
            { promptId: "ghost", title: "Audit", sortOrder: 1 },
          ],
        }),
      ),
      { strategy: "overwrite" },
    );

    expect(result.membersLinked).toBe(1);
    expect(result.membersMerged).toBe(1);
    expect(memberIds(db, rootIds()[0]!)).toEqual([prompt.id]);
  });

  it("imports empty collections", () => {
    const result = lib.importCollection(file(node("Empty")), { strategy: "overwrite" });
    expect(result).toMatchObject({ outcome: "added", collectionsInserted: 1, membersLinked: 0 });
    expect(lib.listCollectionsByParent(null)[0]!.name).toBe("Empty");
  });
});

describe("round-trip between two libraries", () => {
  it("reproduces the subtree structurally with fresh ids and linked members", () => {
    const p1 = lib.createPrompt({ title: "Audit", content: "a" });
    const p2 = lib.createPrompt({ title: "Critique", content: "c" });
    const root = lib.createCollection({ name: "Design", sortOrder: 2 });
    const child = lib.createCollection({ name: "Heuristics", sortOrder: 1, parentCollectionId: root.id });
    const child2 = lib.createCollection({ name: "Reports", sortOrder: 2, parentCollectionId: root.id });
    lib.addPromptToCollection(root.id, p1.id, 0);
    lib.addPromptToCollection(child.id, p1.id, 3);
    lib.addPromptToCollection(child2.id, p2.id, 1);

    const exported = lib.exportCollection(root.id);

    const otherDb = openMemoryDatabase();
    const other = new PromptLibrary(otherDb);
    const foreign = other.createPrompt({ title: "Audit", content: "a" });
    const result = other.importCollection(JSON.parse(JSON.stringify(exported)), { strategy: "overwrite" });

    expect(result.outcome).toBe("added");
    expect(result.membersLinked).toBe(2); // both "Audit" members resolve in the other library; "Critique" does not
    expect(result.membersUnmatched).toBe(1);
    const roundTripped = other.getCollectionTree().children[0]!;
    expect(roundTripped.name).toBe("Design");
    expect(roundTripped.children.map((row) => row.name)).toEqual(["Heuristics", "Reports"]);
    expect(roundTripped.children[0]!.sort_order).toBe(1);
    expect(roundTripped.children[1]!.sort_order).toBe(2);
    expect(roundTripped.id).not.toBe(root.id);
    expect(memberIds(otherDb, roundTripped.id)).toEqual([foreign.id]);
    expect(memberIds(otherDb, roundTripped.children[0]!.id)).toEqual([foreign.id]);
    expect(memberIds(otherDb, roundTripped.children[1]!.id)).toHaveLength(0);
  });
});

describe("preflightCollectionImport rejects", () => {
  const expectIssues = (input: unknown, pathFragment: string, code: string) => {
    try {
      lib.previewCollectionImport(input);
      expect.unreachable("expected CollectionImportValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(CollectionImportValidationError);
      const issues = (error as CollectionImportValidationError).issues;
      expect(issues.some((issue) => issue.path.includes(pathFragment) && issue.code === code)).toBe(true);
    }
  };

  it("rejects non-objects", () => {
    expectIssues("nope", "$", "invalid_type");
  });

  it("rejects wrong kind", () => {
    expectIssues(
      { meta: { kind: "prompt", schemaVersion: 1, exportedAt: "2026-11-02T10:00:00.000Z" }, collection: node("X") },
      "meta.kind",
      "wrong_kind",
    );
  });

  it("rejects future schema versions with a newer-app message", () => {
    try {
      lib.previewCollectionImport(file(node("X"), { schemaVersion: 2 as unknown as 1 }));
      expect.unreachable();
    } catch (error) {
      const issues = (error as CollectionImportValidationError).issues;
      expect(issues[0]!.code).toBe("unsupported_version");
      expect(issues[0]!.message).toMatch(/newer version/);
    }
  });

  it("rejects a bad exportedAt", () => {
    expectIssues(file(node("X"), { exportedAt: "yesterday" }), "meta.exportedAt", "invalid_value");
  });

  it("rejects empty and oversized names", () => {
    expectIssues(file(node("   ")), "collection.name", "invalid_value");
    expectIssues(file(node("x".repeat(201))), "collection.name", "invalid_value");
  });

  it("rejects duplicate members in one collection but allows shared titles with distinct ids", () => {
    expectIssues(
      file(node("Dup", { members: [
        { promptId: "same", title: "A", sortOrder: 0 },
        { promptId: "same", title: "A", sortOrder: 1 },
      ] })),
      "members[1]",
      "duplicate_member",
    );
    const ok = lib.previewCollectionImport(
      file(node("SharedTitle", { members: [
        { promptId: "id-1", title: "Audit", sortOrder: 0 },
        { promptId: "id-2", title: "Audit", sortOrder: 1 },
      ] })),
    );
    expect(ok.memberCount).toBe(2);
  });

  it("rejects duplicate sibling names", () => {
    expectIssues(file(node("Parent", { children: [node("Twin"), node("Twin")] })), "children[1]", "duplicate_child_name");
  });

  it("rejects nesting beyond the depth cap", () => {
    let deep: CollectionNode = node("leaf");
    for (let i = 0; i < MAX_COLLECTION_DEPTH + 1; i += 1) deep = node(`level-${i}`, { children: [deep] });
    expectIssues(file(deep), "children", "invalid_value");
  });
});

describe("normalization (trim) and name-scope edge cases", () => {
  it("normalizes padded names and titles instead of rejecting them", () => {
    // The CLI stores names verbatim (no trim), so padded names exist in real
    // libraries and must round-trip — normalized the same way the UI would
    // have written them, never breaking the export. Exact-match collision
    // still compares the normalized file name against stored names, so a
    // padded root re-imports as a sibling rather than replacing its source.
    const root = lib.createCollection({ name: "  Padded  " });
    lib.createCollection({ name: "  Padded  ", parentCollectionId: root.id });
    const exported = lib.exportCollection(root.id);

    const preview = lib.previewCollectionImport(exported);
    expect(preview.rootName).toBe("Padded");
    const result = lib.importCollection(exported, { strategy: "overwrite" });
    expect(result.outcome).toBe("added");
    expect(result.rootName).toBe("Padded");
    expect(result.collectionsInserted).toBe(2);
    const imported = lib.listCollectionsByParent(null).find((row) => row.name === "Padded");
    expect(imported).toBeDefined();
    expect(lib.listCollectionsByParent(null).find((row) => row.id === imported!.id)).toBeDefined();
    // The imported subtree's child carries the trimmed name too.
    expect(lib.listCollectionsByParent(imported!.id).map((row) => row.name)).toEqual(["Padded"]);
  });

  it("detects sibling-name duplicates after trimming", () => {
    try {
      lib.previewCollectionImport(file(node("P", { children: [node("Twin "), node("Twin")] })));
      expect.unreachable();
    } catch (error) {
      const issues = (error as CollectionImportValidationError).issues;
      expect(issues.some((issue) => issue.code === "duplicate_child_name")).toBe(true);
    }
  });

  it("matches member titles through surrounding whitespace", () => {
    const prompt = lib.createPrompt({ title: "Audit", content: "a" });
    const result = lib.importCollection(
      file(node("Padded titles", { members: [{ promptId: "ghost", title: "  Audit  ", sortOrder: 0 }] })),
      { strategy: "overwrite" },
    );
    expect(result.membersUnmatched).toBe(0);
    expect(memberIds(db, rootIds()[0]!)).toEqual([prompt.id]);
  });

  it("resolveMemberRef trims the title before the ladder", () => {
    const index = buildLivePromptIndex([{ id: "p1", title: "Audit" }]);
    expect(resolveMemberRef(index, "ghost", "  Audit  ")).toEqual({ status: "title", promptId: "p1" });
  });

  it("treats a same-named nested collection as out of scope for the root collision", () => {
    const parent = lib.createCollection({ name: "Holder" });
    const nestedId = lib.createCollection({ name: "Design", parentCollectionId: parent.id }).id;

    const result = lib.importCollection(designFile([]), { strategy: "overwrite" });

    // No root-level "Design" exists: plain add, and the nested one is untouched.
    expect(result.outcome).toBe("added");
    expect(lib.listCollections().some((row) => row.id === nestedId && row.parent_collection_id === parent.id)).toBe(true);
    expect(lib.listCollectionsByParent(null).map((row) => row.name)).toEqual(["Holder", "Design"]);
  });
});

describe("large subtrees", () => {
  it("imports 1200 sibling collections in one transaction", () => {
    const children = Array.from({ length: 1200 }, (_, i) => node(`c${i}`, { sortOrder: i }));
    const result = lib.importCollection(file(node("Big", { children })), { strategy: "overwrite" });
    expect(result.collectionsInserted).toBe(1201);
    expect(lib.listCollections()).toHaveLength(1201);
  });
});
