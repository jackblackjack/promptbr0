import { beforeEach, describe, expect, it } from "vitest";
import {
  assemblePromptContent,
  BLOCK_LIMITS,
  openMemoryDatabase,
  parseBlocksJson,
  PromptLibrary,
  validateBlocksEnvelope,
  type Database,
  type PromptBlock,
} from "../src/index.js";
import { serializeBlocks } from "../src/blocks.js";

let db: Database;
let lib: PromptLibrary;

const block = (overrides: Partial<PromptBlock> = {}): PromptBlock => ({
  id: overrides.id ?? crypto.randomUUID(),
  description: overrides.description ?? "",
  content: overrides.content ?? "block text",
  isActive: overrides.isActive ?? true,
});

beforeEach(() => {
  db = openMemoryDatabase();
  lib = new PromptLibrary(db);
});

describe("blocks CRUD", () => {
  it("creates a prompt with blocks in the same transaction", () => {
    const prompt = lib.createPrompt({
      title: "Email",
      content: "Write an email",
      blocks: [
        { description: "Formal tone", content: "Use a formal tone.", isActive: true },
        { content: "Mention the deadline.", isActive: false },
      ],
    });
    const parsed = parseBlocksJson(prompt.blocks_json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ description: "Formal tone", isActive: true });
    expect(parsed[1]!.id).toBeTruthy();
    expect(parsed[1]!.isActive).toBe(false);
  });

  it("stores NULL for an empty block list", () => {
    const prompt = lib.createPrompt({ title: "Plain", content: "x", blocks: [] });
    expect(prompt.blocks_json).toBeNull();
    expect(lib.setPromptBlocks(prompt.id, []).blocks_json).toBeNull();
  });

  it("replaces the whole list and bumps updated_at", async () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const before = prompt.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = lib.setPromptBlocks(prompt.id, [{ content: "one", isActive: true }]);
    expect(parseBlocksJson(updated.blocks_json)).toHaveLength(1);
    expect(updated.updated_at >= before).toBe(true);
  });

  it("generates ids for absent ones and rejects duplicates", () => {
    const prompt = lib.createPrompt({
      title: "P",
      content: "x",
      blocks: [{ content: "a", isActive: true }],
    });
    const [first] = parseBlocksJson(prompt.blocks_json);
    expect(() =>
      lib.setPromptBlocks(prompt.id, [
        { id: first!.id, content: "a", isActive: true },
        { id: first!.id, content: "b", isActive: true },
      ]),
    ).toThrow(/Duplicate block id/);
  });

  it("enforces the policy limits", () => {
    const prompt = lib.createPrompt({ title: "P", content: "x" });
    const many = Array.from({ length: BLOCK_LIMITS.maxBlocks + 1 }, () => ({
      content: "x",
      isActive: true,
    }));
    expect(() => lib.setPromptBlocks(prompt.id, many)).toThrow(/Too many blocks/);
    expect(() =>
      lib.setPromptBlocks(prompt.id, [{ content: " ".repeat(10), isActive: true }]),
    ).toThrow(/must not be empty/);
    expect(() =>
      lib.setPromptBlocks(prompt.id, [{ content: "x".repeat(BLOCK_LIMITS.maxBlockContentLength + 1), isActive: true }]),
    ).toThrow(/exceeds/);
    expect(() =>
      lib.setPromptBlocks(prompt.id, [
        ...Array.from({ length: 5 }, (_, i) => ({
          content: String(i).repeat(45_000),
          isActive: true,
        })),
      ]),
    ).toThrow(/Total block content/);
    expect(() =>
      lib.setPromptBlocks(prompt.id, [{ content: "x", isActive: "yes" as unknown as boolean }]),
    ).toThrow(/isActive must be a boolean/);
    // The prompt row must be untouched after every failed write above.
    expect(parseBlocksJson(lib.getPrompt(prompt.id)!.blocks_json)).toHaveLength(0);
  });
});

describe("assembly", () => {
  it("appends active blocks as-is, one per line, without normalization", () => {
    const base = "Base prompt";
    const blocks = [
      block({ content: "## Section\n\n- one\n- two", isActive: true }),
      block({ content: "   kept whitespace   ", isActive: false }),
      block({ content: "third", isActive: true }),
    ];
    expect(assemblePromptContent(base, blocks)).toBe(
      "Base prompt\n## Section\n\n- one\n- two\nthird",
    );
  });

  it("honors per-use overrides and ignores unknown ids", () => {
    const a = block({ content: "A", isActive: false });
    const b = block({ content: "B", isActive: true });
    expect(assemblePromptContent("base", [a, b], { [a.id]: true })).toBe("base\nA\nB");
    expect(assemblePromptContent("base", [a, b], { [b.id]: false })).toBe("base");
    expect(assemblePromptContent("base", [a, b], { "no-such-id": true })).toBe("base\nB");
  });
});

describe("bakeBlocksIntoNewVersion", () => {
  it("bakes active blocks into a new version and removes them from the list", () => {
    const prompt = lib.createPrompt({
      title: "P",
      content: "base",
      blocks: [
        { description: "on", content: "active block", isActive: true },
        { description: "off", content: "inactive block", isActive: false },
      ],
    });
    const branch = lib.listBranches(prompt.id)[0]!;
    const v1 = lib.listVersions(prompt.id)[0]!;

    const { version, blocks } = lib.bakeBlocksIntoNewVersion({
      promptId: prompt.id,
      branchId: branch.id,
      baseVersionId: v1.id,
      content: v1.content,
      changeNote: "baked",
    });

    expect(version.number).toBe(2);
    expect(version.content).toBe("base\nactive block");
    expect(blocks.map((b) => b.content)).toEqual(["inactive block"]);
    // Re-assembly from the baked version must not duplicate the block text.
    const remaining = parseBlocksJson(lib.getPrompt(prompt.id)!.blocks_json);
    expect(assemblePromptContent(version.content, remaining)).toBe(version.content);
  });

  it("refuses to bake without active blocks", () => {
    const prompt = lib.createPrompt({
      title: "P",
      content: "base",
      blocks: [{ content: "off", isActive: false }],
    });
    const branch = lib.listBranches(prompt.id)[0]!;
    const v1 = lib.listVersions(prompt.id)[0]!;
    expect(() =>
      lib.bakeBlocksIntoNewVersion({
        promptId: prompt.id,
        branchId: branch.id,
        baseVersionId: v1.id,
        content: v1.content,
      }),
    ).toThrow(/no active blocks/);
  });

  it("initializes the v1 placeholder instead of appending v2 on a title-only prompt", () => {
    const prompt = lib.createPrompt({ title: "Shell", content: "" });
    lib.setPromptBlocks(prompt.id, [{ content: "filled", isActive: true }]);
    const branch = lib.listBranches(prompt.id)[0]!;
    const v1 = lib.listVersions(prompt.id)[0]!;
    const { version } = lib.bakeBlocksIntoNewVersion({
      promptId: prompt.id,
      branchId: branch.id,
      baseVersionId: v1.id,
      content: "",
    });
    expect(version.number).toBe(1);
    expect(version.content).toBe("\nfilled");
    expect(lib.listVersions(prompt.id)).toHaveLength(1);
  });
});

describe("duplicatePrompt carries blocks", () => {
  it("copies the block list to the standalone copy", () => {
    const source = lib.createPrompt({
      title: "Source",
      content: "base",
      blocks: [{ description: "d", content: "kept", isActive: true }],
    });
    const v1 = lib.listVersions(source.id)[0]!;
    const copy = lib.duplicatePrompt({ promptId: source.id, versionId: v1.id, title: "Copy" });
    const copied = parseBlocksJson(copy.blocks_json);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ description: "d", content: "kept", isActive: true });
  });
});

describe("envelope validation for import", () => {
  it("accepts absent, null and well-formed envelopes; rejects the rest", () => {
    expect(validateBlocksEnvelope(null)).toBeNull();
    expect(validateBlocksEnvelope(undefined)).toBeNull();
    expect(validateBlocksEnvelope(serializeBlocks([block()]))).toBeNull();
    expect(validateBlocksEnvelope("{nope")).toMatch(/Invalid JSON/);
    expect(validateBlocksEnvelope("[]")).toMatch(/Expected a JSON object/);
    expect(validateBlocksEnvelope('{"v":2,"blocks":[]}')).toMatch(/envelope version/);
    expect(validateBlocksEnvelope('{"v":1,"blocks":{}}')).toMatch(/blocks array/);
    expect(validateBlocksEnvelope('{"v":1,"blocks":[{"content":""}]}')).toMatch(/must not be empty/);
    expect(validateBlocksEnvelope(5)).toMatch(/JSON string/);
  });

  it("survives corrupt stored JSON via the lenient read", () => {
    expect(parseBlocksJson(null)).toEqual([]);
    expect(parseBlocksJson("")).toEqual([]);
    expect(parseBlocksJson("{broken")).toEqual([]);
    expect(parseBlocksJson('"just a string"')).toEqual([]);
    // Invalid entries are skipped, valid ones survive.
    const raw = serializeBlocks([block({ content: "good" }), { nope: true } as unknown as PromptBlock]);
    expect(parseBlocksJson(raw).map((b) => b.content)).toEqual(["good"]);
  });
});
