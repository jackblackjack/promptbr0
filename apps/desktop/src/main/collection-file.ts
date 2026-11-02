import fs from "node:fs";
import { preflightCollectionImport, type CollectionTransferFile } from "@promptbr0/core";
import { unzipSync, zipSync, type UnzipFileFilter } from "fflate";

/**
 * The `.pbrcol` container: a ZIP archive with one required `collection.json`
 * entry. This module is the only place that knows the on-disk packaging —
 * `packages/core` consumes/produces the logical payload object and stays
 * zip-free. Design doc: docs-internal/specs/2026-11-01-collection-import-design.md.
 */

export const COLLECTION_FILE_EXTENSION = "pbrcol";
export const COLLECTION_FILE_FILTER = { name: "PromptBr0 collection", extensions: [COLLECTION_FILE_EXTENSION] };
const ENTRY_NAME = "collection.json";
/** Zip-bomb guard: collections are tiny; 8 MiB of JSON is already absurd. */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** One user-facing failure class for every container-level problem. */
export class CollectionFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionFileError";
  }
}

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Serializes the payload — re-validating it so the exporter→container
 * contract is enforced, not assumed — injects the app version into the
 * metadata, and writes the ZIP to `filePath`.
 */
export function writeCollectionFile(filePath: string, payload: unknown, appVersion: string): void {
  const file = withAppVersion(preflightCollectionImport(payload), appVersion);
  const collectionJson = JSON.stringify(file, null, 2);
  const zipped = zipSync({ [ENTRY_NAME]: toBytes(collectionJson) }, { level: 6, mtime: new Date() });
  fs.writeFileSync(filePath, zipped, "utf8");
}

function withAppVersion(payload: CollectionTransferFile, appVersion: string): CollectionTransferFile {
  return { ...payload, meta: { ...payload.meta, appVersion } };
}

/**
 * Reads and unpacks a `.pbrcol` file into the logical payload. Every
 * container-level failure — missing magic bytes, corrupt archive, absent or
 * oversized entry — surfaces as the same user-facing error; payload-level
 * problems (wrong kind, future schema) are left to the core preflight.
 */
export function readCollectionFile(filePath: string): unknown {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    throw new CollectionFileError("Not a valid PromptBr0 collection file");
  }
  const magic = bytes.subarray(0, 4);
  const isZip =
    (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04) ||
    (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x05 && magic[3] === 0x06) ||
    (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x07 && magic[3] === 0x08);
  if (!isZip) throw new CollectionFileError("Not a valid PromptBr0 collection file");

  // Only the one expected entry is ever inflated; anything else in the
  // archive is ignored (reserved for future payload growth).
  const filter: UnzipFileFilter = (file) => file.name === ENTRY_NAME && file.originalSize <= MAX_ENTRY_BYTES;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter });
  } catch {
    throw new CollectionFileError("Not a valid PromptBr0 collection file");
  }
  const entry = entries[ENTRY_NAME];
  // Distinguish "entry missing" (filter dropped an oversized one too) from
  // corrupt JSON — same user-facing message either way.
  if (!entry) throw new CollectionFileError("Not a valid PromptBr0 collection file");

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBytes(entry));
  } catch {
    throw new CollectionFileError("Not a valid PromptBr0 collection file");
  }
  return parsed;
}
