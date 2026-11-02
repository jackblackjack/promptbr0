import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { CollectionFileError, collectionFileName, readCollectionFile, writeCollectionFile } from "./collection-file.js";

const payload = {
  meta: { kind: "collection", schemaVersion: 1, exportedAt: "2026-11-02T10:00:00.000Z" },
  collection: { name: "Design", sortOrder: 0, members: [], children: [] },
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbrcol-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const filePath = (name: string): string => path.join(dir, name);

describe("writeCollectionFile", () => {
  it("injects the app version into the metadata", () => {
    const target = filePath("c.pbrcol");
    writeCollectionFile(target, payload, "0.2.0");
    const parsed = readCollectionFile(target);
    expect((parsed as { meta: { appVersion?: string } }).meta.appVersion).toBe("0.2.0");
  });

  it("refuses to write a payload that fails preflight", () => {
    const bad = { meta: { kind: "prompt", schemaVersion: 1, exportedAt: "2026-11-02T10:00:00.000Z" }, collection: payload.collection };
    expect(() => writeCollectionFile(filePath("bad.pbrcol"), bad, "0.2.0")).toThrow(/not a PromptBr0 collection/);
    expect(fs.existsSync(filePath("bad.pbrcol"))).toBe(false);
  });
});

describe("collectionFileName", () => {
  it("keeps plain ASCII names readable", () => {
    expect(collectionFileName("Design system")).toBe("design-system.pbrcol");
  });

  it("keeps non-ASCII letters instead of collapsing them onto one dash", () => {
    // The previous ASCII-only class produced "-" for every Cyrillic name,
    // so any two such exports shared the same "-.pbrcol" default.
    expect(collectionFileName("Дизайн")).toBe("дизайн.pbrcol");
    expect(collectionFileName("API — Промпты v2!")).toBe("api-промпты-v2.pbrcol");
  });

  it("falls back to a stable stem when nothing survives trimming", () => {
    // A leading dot would hide the file on Unix; symbol-only names must not
    // produce "." / "-.pbrcol".
    expect(collectionFileName("🎉")).toBe("collection.pbrcol");
    expect(collectionFileName("...")).toBe("collection.pbrcol");
  });
});

describe("readCollectionFile", () => {
  it("round-trips a written file back to the logical payload", () => {
    const target = filePath("round.pbrcol");
    writeCollectionFile(target, payload, "9.9.9");
    expect(readCollectionFile(target)).toMatchObject({
      meta: { kind: "collection", schemaVersion: 1, appVersion: "9.9.9" },
      collection: { name: "Design" },
    });
  });

  it("rejects non-ZIP bytes", () => {
    const target = filePath("plain.pbrcol");
    fs.writeFileSync(target, JSON.stringify(payload), "utf8");
    expect(() => readCollectionFile(target)).toThrow(CollectionFileError);
  });

  it("rejects an archive without the collection.json entry", () => {
    const target = filePath("wrong-entry.pbrcol");
    fs.writeFileSync(target, zipSync({ "other.txt": new TextEncoder().encode("hi") }), "utf8");
    expect(() => readCollectionFile(target)).toThrow(CollectionFileError);
  });

  it("rejects corrupt JSON inside the entry", () => {
    const target = filePath("corrupt.pbrcol");
    fs.writeFileSync(target, zipSync({ "collection.json": new TextEncoder().encode("{ not json") }), "utf8");
    expect(() => readCollectionFile(target)).toThrow(CollectionFileError);
  });

  it("rejects an entry beyond the 8 MiB size cap", () => {
    const target = filePath("huge.pbrcol");
    const huge = " ".repeat(8 * 1024 * 1024 + 1);
    fs.writeFileSync(target, zipSync({ "collection.json": new TextEncoder().encode(huge) }, { level: 0 }));
    expect(() => readCollectionFile(target)).toThrow(CollectionFileError);
  });

  it("refuses to read an archive beyond the 64 MiB file cap into memory", () => {
    const target = filePath("sparse.pbrcol");
    // Sparse file: claims 64 MiB + 1 at near-zero disk cost. It starts with a
    // ZIP magic so that, if it were ever read, it would pass the magic check
    // and hit the archive parser — the guard must stop it before that.
    const fd = fs.openSync(target, "w");
    fs.writeSync(fd, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1);
    fs.closeSync(fd);
    const readSpy = vi.spyOn(fs, "readFileSync");
    try {
      expect(() => readCollectionFile(target)).toThrow(CollectionFileError);
      // The defect being pinned is the unbounded read itself, not the error:
      // a plain toThrow would pass even if the whole oversized file landed in
      // memory first. The read must never happen.
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });
});
