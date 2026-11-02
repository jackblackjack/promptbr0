/** Lightweight optional-block assembly — mirrors @promptbr0/core without pulling in node:crypto. */

export interface AssemblableBlock {
  id: string;
  content: string;
  isActive: boolean;
}

/**
 * Appends every effectively-active block to the base content on its own line,
 * verbatim (no trimming, no blank-line normalization). Per-use `overrides` win
 * over a block's default `isActive`; unknown override ids are ignored.
 */
export function assemblePromptContent(
  base: string,
  blocks: readonly AssemblableBlock[],
  overrides?: Readonly<Record<string, boolean>>,
): string {
  let content = base;
  for (const block of blocks) {
    const active =
      overrides && Object.hasOwn(overrides, block.id) ? overrides[block.id]! : block.isActive;
    if (active) content += `\n${block.content}`;
  }
  return content;
}
