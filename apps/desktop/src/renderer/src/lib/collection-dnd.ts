/**
 * Pure geometry-free helpers for dragging collections in the left rail.
 *
 * The drop target is expressed in the same coordinate space the core's
 * `moveCollection` expects: an insertion index among the target folder's
 * children with the dragged collection excluded. Keeping that translation in
 * one tested function means the component only deals with pointer events.
 */
import type { CollectionTreeDto } from "../../../shared/ipc.js";

/** How long the pointer must rest on a collapsed folder before it opens. */
export const AUTO_EXPAND_DELAY_MS = 600;

export type CollectionDropPosition = "before" | "after" | "inside";

export interface CollectionDropPlan {
  /** Folder the dragged collection would land in; null for the top level. */
  parentId: string | null;
  /** Insertion index among that folder's children without the dragged row. */
  targetIndex: number;
  /** False for drops onto the dragged row itself or one of its descendants. */
  valid: boolean;
}

export function findCollectionNode(
  tree: CollectionTreeDto,
  id: string,
): CollectionTreeDto | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findCollectionNode(child, id);
    if (found) return found;
  }
  return null;
}

/** True when `candidateId` is `ancestorId` itself or sits below it. */
export function isCollectionDescendant(
  tree: CollectionTreeDto,
  ancestorId: string,
  candidateId: string,
): boolean {
  const ancestor = findCollectionNode(tree, ancestorId);
  if (!ancestor) return false;
  return findCollectionNode(ancestor, candidateId) !== null;
}

/**
 * Resolve where a hovered row drops. `position` is what the pointer region
 * says: `inside` nests into the hovered folder, `before`/`after` puts the
 * dragged collection next to it in the hovered row's parent.
 */
export function planCollectionDrop(
  tree: CollectionTreeDto,
  draggedId: string,
  overId: string,
  position: CollectionDropPosition,
): CollectionDropPlan | null {
  const over = findCollectionNode(tree, overId);
  if (!over || !findCollectionNode(tree, draggedId)) return null;

  let parentId: string | null;
  let siblings: CollectionTreeDto[];
  let rawIndex: number;

  if (position === "inside") {
    parentId = over.id;
    siblings = over.children;
    rawIndex = siblings.length;
  } else {
    parentId = over.parentId;
    siblings =
      parentId === null ? tree.children : (findCollectionNode(tree, parentId)?.children ?? []);
    const at = siblings.findIndex((child) => child.id === overId);
    if (at < 0) return null;
    rawIndex = at + (position === "after" ? 1 : 0);
  }

  // Convert the index from the hovered list to the list without the dragged
  // row. Only entries before the insertion point matter.
  const targetIndex = siblings.slice(0, rawIndex).filter((child) => child.id !== draggedId).length;
  const valid =
    overId !== draggedId &&
    (parentId === null || !isCollectionDescendant(tree, draggedId, parentId));

  return { parentId, targetIndex, valid };
}
