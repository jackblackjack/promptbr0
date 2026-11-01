// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CollectionTreeDto } from "../../../shared/ipc.js";
import { renderApp } from "../test/render";
import { CreateCollectionDialog, RenameCollectionDialog } from "./dialogs";

function node(
  id: string,
  name: string,
  parentId: string | null,
  children: CollectionTreeDto[] = [],
): CollectionTreeDto {
  return { id, name, parentId, sortOrder: 0, promptCount: 0, children };
}

const tree: CollectionTreeDto = node("root", "", null, [
  node("work", "Work", null, [node("deep", "Deep", "work")]),
  node("home", "Home", null),
]);

describe("CreateCollectionDialog", () => {
  it("lists top-level collections without the empty root sentinel", () => {
    renderApp(
      <CreateCollectionDialog
        open
        onOpenChange={vi.fn()}
        allCollections={tree}
        onSubmit={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /parent folder/i });
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];

    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "None (top-level)",
      "Work",
      "└ Deep",
      "Home",
    ]);
    expect(options.some((option) => option.value === "root")).toBe(false);
    expect(options.slice(1).every((option) => option.textContent?.trim() !== "")).toBe(true);
  });

  it("renames without a blank root option and keeps forbidden folders out", () => {
    renderApp(
      <RenameCollectionDialog
        open
        onOpenChange={vi.fn()}
        collection={{ id: "work", name: "Work", parentId: null }}
        allCollections={tree}
        onSubmit={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /parent folder/i });
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];

    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "None (top-level)",
      "Home",
    ]);
    expect(options.some((option) => option.value === "root")).toBe(false);
  });
});
