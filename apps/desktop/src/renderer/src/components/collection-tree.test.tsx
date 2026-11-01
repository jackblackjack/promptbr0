// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionTreeDto } from "../../../shared/ipc.js";
import { AUTO_EXPAND_DELAY_MS } from "../lib/collection-dnd";
import { renderApp } from "../test/render";
import { CollectionTree, type CollectionTreeProps } from "./CollectionTree";

function node(
  id: string,
  name: string,
  parentId: string | null,
  children: CollectionTreeDto[] = [],
): CollectionTreeDto {
  return { id, name, parentId, sortOrder: 0, promptCount: children.length, children };
}

const work = node("w", "Work", null, [node("d", "Deep", "w")]);
const home = node("h", "Home", null);
const archive = node("a", "Archive", null);
const tree: CollectionTreeDto = {
  ...node("root", "", null, [work, home, archive]),
};

function setup(overrides: Partial<CollectionTreeProps> = {}) {
  const props = {
    tree,
    expandedIds: new Set<string>(),
    activeId: null,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onExpand: vi.fn(),
    onContextMenu: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  renderApp(<CollectionTree {...props} />);
  return props;
}

function stubRowRect(element: HTMLElement) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 100,
    top: 100,
    left: 0,
    right: 200,
    bottom: 120,
    width: 200,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CollectionTree", () => {
  it("selects a collection, toggles folders and opens the context menu", () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: /Work/ }));
    expect(props.onSelect).toHaveBeenCalledWith(work);

    fireEvent.click(screen.getByRole("button", { name: "Expand folder" }));
    expect(props.onToggle).toHaveBeenCalledWith("w");

    fireEvent.contextMenu(screen.getByRole("button", { name: /Home/ }), {
      clientX: 42,
      clientY: 84,
    });
    expect(props.onContextMenu).toHaveBeenCalledWith(home, 42, 84);
  });

  it("reorders by dropping on the top or bottom edge of a sibling", () => {
    const props = setup();
    const archiveRow = screen.getByRole("button", { name: /Archive/ });
    const homeRow = screen.getByRole("button", { name: /Home/ });
    stubRowRect(homeRow);

    fireEvent.dragStart(archiveRow);
    fireEvent.dragOver(homeRow, { clientY: 105 });
    fireEvent.drop(homeRow, { clientY: 105 });

    expect(props.onMove).toHaveBeenCalledWith({
      id: "a",
      parentCollectionId: null,
      targetIndex: 1,
    });

    fireEvent.dragStart(archiveRow);
    fireEvent.dragOver(homeRow, { clientY: 115 });
    fireEvent.drop(homeRow, { clientY: 115 });

    expect(props.onMove).toHaveBeenLastCalledWith({
      id: "a",
      parentCollectionId: null,
      targetIndex: 2,
    });
  });

  it("spring-loads a collapsed folder and drops the collection inside it", () => {
    const props = setup();
    const archiveRow = screen.getByRole("button", { name: /Archive/ });
    const workRow = screen.getByRole("button", { name: /Work/ });

    vi.useFakeTimers();
    fireEvent.dragStart(archiveRow);
    fireEvent.dragOver(workRow, { clientY: 110 });
    expect(props.onExpand).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(AUTO_EXPAND_DELAY_MS);
    });
    expect(props.onExpand).toHaveBeenCalledWith("w");

    fireEvent.drop(workRow, { clientY: 110 });
    expect(props.onMove).toHaveBeenCalledWith({
      id: "a",
      parentCollectionId: "w",
      targetIndex: 1,
    });
  });

  it("ignores a drop into the dragged collection's own descendant", () => {
    const props = setup({ expandedIds: new Set(["w"]) });
    const workRow = screen.getByRole("button", { name: /Work/ });
    const deepRow = screen.getByRole("button", { name: /Deep/ });

    fireEvent.dragStart(workRow);
    fireEvent.dragOver(deepRow, { clientY: 110 });
    fireEvent.drop(deepRow, { clientY: 110 });

    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("clears the insertion marker on drag end", () => {
    setup({ expandedIds: new Set(["w"]) });
    const archiveRow = screen.getByRole("button", { name: /Archive/ });
    const homeRow = screen.getByRole("button", { name: /Home/ });
    stubRowRect(homeRow);

    fireEvent.dragStart(archiveRow);
    fireEvent.dragOver(homeRow, { clientY: 105 });
    expect(homeRow.parentElement!.querySelector("span.pointer-events-none")).not.toBeNull();

    fireEvent.dragEnd(homeRow);
    expect(homeRow.parentElement!.querySelector("span.pointer-events-none")).toBeNull();
  });
});
