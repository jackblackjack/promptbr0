/**
 * Optional prompt blocks: a flat per-prompt list of toggleable text fragments
 * appended to the prompt content when active. Stored as one JSON column on the
 * prompts row (migration v19); this module is the single place that knows the
 * on-disk envelope, the validation limits and the assembly rule.
 *
 * The database CHECK (`blocks_json IS NULL OR json_valid(blocks_json)`) keeps
 * syntactically invalid JSON out; the shape envelope is what these helpers
 * add on top — `serializeBlocks` on write, `parseBlocksJson` defensively on
 * read, `validateBlocksEnvelope` strictly for import preflight.
 */

import { randomUUID } from "node:crypto";

export interface PromptBlockInput {
  /** Absent/blank ids are generated; ids must be unique within one prompt. */
  id?: string;
  description?: string;
  content: string;
  isActive: boolean;
}

export interface PromptBlock {
  id: string;
  description: string;
  content: string;
  isActive: boolean;
}

/**
 * Policy limits, not schema limits: SQLite holds ~1 GB in one TEXT value, so
 * these exist for the IPC content cap (base ≤1 MB + blocks ≤200k must fit the
 * 1.2 MB run payload), sync op size and editor UX. They change here and in the
 * zod schema — never in a migration.
 */
export const BLOCK_LIMITS = {
  maxBlocks: 50,
  maxDescriptionLength: 200,
  maxBlockContentLength: 50_000,
  maxTotalContentLength: 200_000,
} as const;

const BLOCKS_ENVELOPE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates one block; throws with a user-facing message. */
function normalizeBlock(raw: unknown, index: number, seenIds: Set<string>): PromptBlock {
  if (!isRecord(raw)) throw new Error(`Block ${index} must be an object`);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : randomUUID();
  if (seenIds.has(id)) throw new Error(`Duplicate block id: ${id}`);
  seenIds.add(id);
  if (typeof raw.content !== "string" || !raw.content.trim()) {
    throw new Error(`Block ${index} content must not be empty`);
  }
  if (raw.content.length > BLOCK_LIMITS.maxBlockContentLength) {
    throw new Error(
      `Block ${index} content exceeds ${BLOCK_LIMITS.maxBlockContentLength} characters`,
    );
  }
  let description = "";
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new Error(`Block ${index} description must be a string`);
    description = raw.description;
    if (description.length > BLOCK_LIMITS.maxDescriptionLength) {
      throw new Error(
        `Block ${index} description exceeds ${BLOCK_LIMITS.maxDescriptionLength} characters`,
      );
    }
  }
  if (typeof raw.isActive !== "boolean") throw new Error(`Block ${index} isActive must be a boolean`);
  return { id, description, content: raw.content, isActive: raw.isActive };
}

/** Validates and normalizes a whole list; throws with a user-facing message. */
export function normalizeBlocks(input: unknown): PromptBlock[] {
  if (!Array.isArray(input)) throw new Error("Blocks must be an array");
  if (input.length > BLOCK_LIMITS.maxBlocks) {
    throw new Error(`Too many blocks (max ${BLOCK_LIMITS.maxBlocks})`);
  }
  const seenIds = new Set<string>();
  const blocks: PromptBlock[] = [];
  let total = 0;
  for (const [index, raw] of input.entries()) {
    const block = normalizeBlock(raw, index, seenIds);
    total += block.content.length;
    if (total > BLOCK_LIMITS.maxTotalContentLength) {
      throw new Error(`Total block content exceeds ${BLOCK_LIMITS.maxTotalContentLength} characters`);
    }
    blocks.push(block);
  }
  return blocks;
}

export function serializeBlocks(blocks: PromptBlock[]): string {
  return JSON.stringify({ v: BLOCKS_ENVELOPE_VERSION, blocks });
}

/**
 * Strict check for import preflight: returns an error message, or null when
 * the value is absent or a well-formed envelope. Unlike `parseBlocksJson`
 * (which skips bad entries), every item must be valid here — an import is the
 * one place a caller can still be told exactly what is wrong.
 */
export function validateBlocksEnvelope(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return "Expected a JSON string or null";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "Invalid JSON";
  }
  if (!isRecord(parsed)) return "Expected a JSON object";
  if (parsed.v !== BLOCKS_ENVELOPE_VERSION) return `Expected envelope version ${BLOCKS_ENVELOPE_VERSION}`;
  if (!Array.isArray(parsed.blocks)) return "Expected a blocks array";
  const seenIds = new Set<string>();
  let total = 0;
  for (const [index, item] of parsed.blocks.entries()) {
    try {
      const block = normalizeBlock(item, index, seenIds);
      total += block.content.length;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid block";
    }
  }
  if (total > BLOCK_LIMITS.maxTotalContentLength) {
    return `Total block content exceeds ${BLOCK_LIMITS.maxTotalContentLength} characters`;
  }
  return null;
}

/**
 * Read-boundary parse: never throws, never surfaces partial garbage — anything
 * malformed (or an empty list) collapses to `[]` and the prompt keeps working
 * with no blocks. Invalid individual entries are skipped, valid ones survive.
 */
export function parseBlocksJson(raw: string | null | undefined): PromptBlock[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.v !== BLOCKS_ENVELOPE_VERSION || !Array.isArray(parsed.blocks)) {
    return [];
  }
  const seenIds = new Set<string>();
  const blocks: PromptBlock[] = [];
  let total = 0;
  for (const [index, item] of parsed.blocks.entries()) {
    try {
      const block = normalizeBlock(item, index, seenIds);
      total += block.content.length;
      if (total > BLOCK_LIMITS.maxTotalContentLength) break;
      blocks.push(block);
    } catch {
      // Skip malformed entries; the rest of the list stays usable.
    }
  }
  return blocks;
}

/**
 * The one assembly rule, shared by every render path: base content first, then
 * each effective-active block appended as-is on a new line — no trimming, no
 * normalization; the block's own text owns all formatting. Overrides are keyed
 * by block id (per-use toggles); unknown ids are ignored, ids absent from the
 * map fall back to the block's stored default.
 */
export function assemblePromptContent(
  base: string,
  blocks: readonly PromptBlock[],
  overrides?: Readonly<Record<string, boolean>>,
): string {
  let content = base;
  for (const block of blocks) {
    const active = overrides && Object.hasOwn(overrides, block.id) ? overrides[block.id]! : block.isActive;
    if (active) content += `\n${block.content}`;
  }
  return content;
}
