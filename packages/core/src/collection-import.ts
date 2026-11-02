import type { LibraryImportIssue } from "./import-validation.js";

/**
 * The single-file collection transfer payload (the logical `collection.json`
 * inside a `.pbrcol` ZIP container — the desktop app owns the container, this
 * module owns the shape). Design doc: docs-internal/specs/2026-11-01-collection-import-design.md.
 *
 * Layering rule: this module is pure data — no zip, no Electron, no database.
 * `PromptLibrary` consumes/produces these objects the same way it consumes
 * whole-library exports via `importLibrary(input: unknown)`.
 */

/** One member reference: a pointer to a prompt, never a copy of one. */
export interface CollectionMemberRef {
  /** Internal id; matches exactly between synced devices (sync preserves ids). */
  promptId: string;
  /** Portable fallback identity; the import resolution ladder tries title after id. */
  title: string;
  sortOrder: number;
}

export interface CollectionNode {
  name: string;
  sortOrder: number;
  members: CollectionMemberRef[];
  children: CollectionNode[];
}

export interface CollectionTransferFile {
  meta: {
    kind: "collection";
    schemaVersion: 1;
    exportedAt: string;
    /** Written by the desktop exporter just before zipping; optional by design. */
    appVersion?: string;
  };
  collection: CollectionNode;
}

export type CollectionImportStrategy = "skip" | "overwrite" | "duplicate";

export interface CollectionImportPreview {
  rootName: string;
  /** An existing top-level collection already carries this name. */
  rootCollision: boolean;
  existingRootId: string | null;
  /** Child collections in the imported subtree (excluding the root itself). */
  subcollectionCount: number;
  memberCount: number;
  matchedById: number;
  matchedByTitle: number;
  /** Titles the ladder could not bind; import will skip these members. */
  unmatchedTitles: string[];
}

export interface CollectionImportResult {
  outcome: "added" | "replaced" | "skipped";
  /** Final root name — may differ from the file after a ` (N)` suffix. */
  rootName: string;
  collectionsInserted: number;
  membersLinked: number;
  /** Members that resolved to a prompt already linked in the same collection. */
  membersMerged: number;
  membersUnmatched: number;
  unmatchedTitles: string[];
}

/**
 * Bounds JSON nesting so a hostile file cannot exhaust the stack during
 * validation. Nested children cannot form cycles by construction, so depth
 * is the only structural risk left.
 */
export const MAX_COLLECTION_DEPTH = 64;
const MAX_NAME_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;

export class CollectionImportValidationError extends Error {
  readonly issues: LibraryImportIssue[];

  constructor(issues: LibraryImportIssue[]) {
    super(`Invalid collection file: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "CollectionImportValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Same ISO shape the whole-library importer accepts, kept byte-identical. */
function isIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, leap ? 29 : 28, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    (match[7] === undefined || (Number(match[7]) <= 23 && Number(match[8]) <= 59))
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Validates the file's own consistency before any destination state exists.
 * Strict on purpose: a live library cannot produce a file that fails here
 * (`PK(collection_id, prompt_id)` and `UNIQUE(name, parent_collection_id)`
 * keep exported subtrees internally consistent), so strictness only ever
 * bites tampered, foreign, or future-version files.
 *
 * Two members sharing a title with different ids are legal — live prompts may
 * share titles, and each member resolves independently at import time.
 */
export function preflightCollectionImport(input: unknown): CollectionTransferFile {
  const issues: LibraryImportIssue[] = [];
  const issue = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message });
  };
  const fail = (): never => {
    throw new CollectionImportValidationError(issues);
  };

  if (!isRecord(input)) {
    issue("$", "invalid_type", "Expected a collection file object");
    return fail();
  }

  // -- meta -----------------------------------------------------------------
  if (!isRecord(input.meta)) {
    issue("meta", "invalid_type", "Expected a metadata object");
    return fail();
  }
  const meta = input.meta;
  if (meta.kind === undefined) issue("meta.kind", "invalid_type", "Expected kind");
  else if (meta.kind !== "collection") issue("meta.kind", "wrong_kind", "This file is not a PromptBr0 collection");
  if (meta.schemaVersion === undefined) issue("meta.schemaVersion", "invalid_type", "Expected schemaVersion");
  else if (meta.schemaVersion === 1) {
    // current version — nothing further to check
  } else {
    issue(
      "meta.schemaVersion",
      "unsupported_version",
      typeof meta.schemaVersion === "number" && meta.schemaVersion > 1
        ? "This file was written by a newer version of PromptBr0"
        : "Expected schemaVersion 1",
    );
  }
  if (typeof meta.exportedAt !== "string" || !isIsoTimestamp(meta.exportedAt)) {
    issue("meta.exportedAt", "invalid_value", "Expected an ISO timestamp");
  }
  if (meta.appVersion !== undefined && (typeof meta.appVersion !== "string" || meta.appVersion.length === 0 || meta.appVersion.length > 100)) {
    issue("meta.appVersion", "invalid_value", "Expected a short version string");
  }

  // -- collection tree ------------------------------------------------------
  const walkNode = (node: unknown, path: string, depth: number): CollectionNode | null => {
    if (!isRecord(node)) {
      issue(path, "invalid_type", "Expected a collection object");
      return null;
    }
    if (depth > MAX_COLLECTION_DEPTH) {
      issue(path, "invalid_value", `Nesting deeper than ${MAX_COLLECTION_DEPTH} levels is not supported`);
      return null;
    }
    let valid = true;
    if (typeof node.name !== "string" || node.name.trim().length === 0 || node.name.length > MAX_NAME_LENGTH) {
      issue(`${path}.name`, "invalid_value", `Expected a non-empty name of at most ${MAX_NAME_LENGTH} characters`);
      valid = false;
    }
    if (!isInteger(node.sortOrder)) {
      issue(`${path}.sortOrder`, "invalid_value", "Expected an integer");
      valid = false;
    }
    if (!Array.isArray(node.members)) {
      issue(`${path}.members`, "invalid_type", "Expected an array of member references");
      valid = false;
    }
    if (!Array.isArray(node.children)) {
      issue(`${path}.children`, "invalid_type", "Expected an array of child collections");
      valid = false;
    }
    if (!valid) return null;

    const members: CollectionMemberRef[] = [];
    const seenPromptIds = new Set<string>();
    for (const [index, raw] of (node.members as unknown[]).entries()) {
      const memberPath = `${path}.members[${index}]`;
      if (!isRecord(raw)) {
        issue(memberPath, "invalid_type", "Expected a member reference object");
        continue;
      }
      let memberValid = true;
      if (typeof raw.promptId !== "string" || raw.promptId.trim().length === 0) {
        issue(`${memberPath}.promptId`, "invalid_value", "Expected a non-empty prompt id");
        memberValid = false;
      }
      if (typeof raw.title !== "string" || raw.title.trim().length === 0 || raw.title.length > MAX_TITLE_LENGTH) {
        issue(`${memberPath}.title`, "invalid_value", `Expected a non-empty title of at most ${MAX_TITLE_LENGTH} characters`);
        memberValid = false;
      }
      if (!isInteger(raw.sortOrder)) {
        issue(`${memberPath}.sortOrder`, "invalid_value", "Expected an integer");
        memberValid = false;
      }
      if (!memberValid) continue;
      if (seenPromptIds.has(raw.promptId as string)) {
        issue(memberPath, "duplicate_member", "Same prompt referenced twice in one collection");
        continue;
      }
      seenPromptIds.add(raw.promptId as string);
      members.push({ promptId: raw.promptId as string, title: raw.title as string, sortOrder: raw.sortOrder as number });
    }

    const children: CollectionNode[] = [];
    const seenChildNames = new Set<string>();
    for (const [index, raw] of (node.children as unknown[]).entries()) {
      const childPath = `${path}.children[${index}]`;
      if (isRecord(raw) && typeof raw.name === "string") {
        if (seenChildNames.has(raw.name)) {
          issue(childPath, "duplicate_child_name", "Two sibling collections share one name");
          continue;
        }
        seenChildNames.add(raw.name);
      }
      const child = walkNode(raw, childPath, depth + 1);
      if (child) children.push(child);
    }

    return {
      name: node.name as string,
      sortOrder: node.sortOrder as number,
      members,
      children,
    };
  };

  const collection = walkNode(input.collection, "collection", 1);
  if (issues.length > 0 || !collection) return fail();

  return {
    meta: {
      kind: "collection",
      schemaVersion: 1,
      exportedAt: meta.exportedAt as string,
      ...(typeof meta.appVersion === "string" && meta.appVersion.length > 0 ? { appVersion: meta.appVersion } : {}),
    },
    collection,
  };
}

// ---------------------------------------------------------------- resolution

/**
 * Index of live (non-deleted) prompts for the member resolution ladder.
 * Trash is excluded: memberships survive soft delete, so an exported file can
 * reference a trashed prompt — importing it must not resurrect invisible
 * members, so the member reports as unmatched instead.
 */
export interface LivePromptIndex {
  byId: Map<string, string>;
  exact: Map<string, string[]>;
  caseInsensitive: Map<string, string[]>;
  /** Live titles in lowercase for the substring tier, in stable row order. */
  titles: Array<{ id: string; lowerTitle: string }>;
}

export function buildLivePromptIndex(rows: Array<{ id: string; title: string }>): LivePromptIndex {
  const index: LivePromptIndex = { byId: new Map(), exact: new Map(), caseInsensitive: new Map(), titles: [] };
  for (const row of rows) {
    index.byId.set(row.id, row.id);
    const exact = index.exact.get(row.title) ?? [];
    exact.push(row.id);
    index.exact.set(row.title, exact);
    const lower = row.title.toLowerCase();
    const ci = index.caseInsensitive.get(lower) ?? [];
    ci.push(row.id);
    index.caseInsensitive.set(lower, ci);
    index.titles.push({ id: row.id, lowerTitle: lower });
  }
  return index;
}

export type MemberResolutionStatus = "id" | "title" | "unmatched";

export interface MemberResolution {
  status: MemberResolutionStatus;
  promptId: string | null;
}

/**
 * Mirrors the agent-facing prompt resolution ladder (resolve.ts): id → exact
 * title → case-insensitive title → unique case-insensitive substring. Any
 * tier matching 2+ candidates resolves to unmatched — deterministic, and it
 * can never silently link the wrong prompt (titles are not unique).
 */
export function resolveMemberRef(index: LivePromptIndex, promptId: string, title: string): MemberResolution {
  if (index.byId.has(promptId)) return { status: "id", promptId };

  const exact = index.exact.get(title);
  if (exact && exact.length === 1) return { status: "title", promptId: exact[0]! };
  if (exact && exact.length > 1) return { status: "unmatched", promptId: null };

  const lower = title.toLowerCase();
  const ci = index.caseInsensitive.get(lower);
  if (ci && ci.length === 1) return { status: "title", promptId: ci[0]! };
  if (ci && ci.length > 1) return { status: "unmatched", promptId: null };

  const substring = index.titles.filter((row) => row.lowerTitle.includes(lower));
  if (substring.length === 1) return { status: "title", promptId: substring[0]!.id };
  return { status: "unmatched", promptId: null };
}
