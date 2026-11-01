import { describe, expect, it } from "vitest";
import type { CollectionTreeDto } from "../../../shared/ipc.js";
import {
  findCollectionNode,
  isCollectionDescendant,
  planCollectionDrop,
} from "./collection-dnd";

function node(
  id: string,
  parentId: string | null,
  children: CollectionTreeDto[] = [],
): CollectionTreeDto {
  return { id, name: id, sortOrder: 0, parentId, promptCount: 0, children };
}

const tree: CollectionTreeDto = {
  ...node("root", null, [
    node("a", null, [node("a1", "a", [node("a1a", "a1")]), node("a2", "a")]),
    node("b", null),
    node("c", null),
  ]),
  name: "",
};

describe("collection tree lookups", () => {
  it("finds nested nodes and the root", () => {
    expect(findCollectionNode(tree, "a1a")?.id).toBe("a1a");
    expect(findCollectionNode(tree, "root")?.id).toBe("root");
    expect(findCollectionNode(tree, "missing")).toBeNull();
  });

  it("recognises descendants, including the node itself", () => {
    expect(isCollectionDescendant(tree, "a", "a1a")).toBe(true);
    expect(isCollectionDescendant(tree, "a", "a")).toBe(true);
    expect(isCollectionDescendant(tree, "a", "b")).toBe(false);
    expect(isCollectionDescendant(tree, "missing", "a")).toBe(false);
  });
});

describe("planCollectionDrop", () => {
  it("computes before/after positions among top-level siblings", () => {
    expect(planCollectionDrop(tree, "c", "b", "before")).toEqual({
      parentId: null,
      targetIndex: 1,
      valid: true,
    });
    expect(planCollectionDrop(tree, "c", "b", "after")).toEqual({
      parentId: null,
      targetIndex: 2,
      valid: true,
    });
  });

  it("adjusts the index when the dragged row sits before the target", () => {
    expect(planCollectionDrop(tree, "a", "c", "after")).toEqual({
      parentId: null,
      targetIndex: 2,
      valid: true,
    });
    expect(planCollectionDrop(tree, "a", "b", "before")).toEqual({
      parentId: null,
      targetIndex: 0,
      valid: true,
    });
  });

  it("appends to the end when dropping inside a folder", () => {
    expect(planCollectionDrop(tree, "b", "a", "inside")).toEqual({
      parentId: "a",
      targetIndex: 2,
      valid: true,
    });
    expect(planCollectionDrop(tree, "a", "b", "inside")).toEqual({
      parentId: "b",
      targetIndex: 0,
      valid: true,
    });
  });

  it("computes nested before/after positions inside a parent", () => {
    expect(planCollectionDrop(tree, "b", "a1", "after")).toEqual({
      parentId: "a",
      targetIndex: 1,
      valid: true,
    });
  });

  it("rejects the dragged row itself and its descendants", () => {
    expect(planCollectionDrop(tree, "a", "a", "inside")?.valid).toBe(false);
    expect(planCollectionDrop(tree, "a", "a", "before")?.valid).toBe(false);
    expect(planCollectionDrop(tree, "a", "a1", "inside")?.valid).toBe(false);
    expect(planCollectionDrop(tree, "a", "a1", "after")?.valid).toBe(false);
    expect(planCollectionDrop(tree, "a", "a1a", "before")?.valid).toBe(false);
  });

  it("returns null when either row is unknown", () => {
    expect(planCollectionDrop(tree, "missing", "a", "inside")).toBeNull();
    expect(planCollectionDrop(tree, "a", "missing", "inside")).toBeNull();
  });
});
