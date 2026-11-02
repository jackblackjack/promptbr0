// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CollectionImportPreviewDto } from "../../../shared/ipc.js";
import { renderApp } from "../test/render";
import { CollectionImportDialog } from "./dialogs";

const basePreview: CollectionImportPreviewDto = {
  path: "/tmp/design.pbrcol",
  rootName: "Design",
  rootCollision: false,
  existingRootId: null,
  subcollectionCount: 2,
  memberCount: 5,
  matchedById: 3,
  matchedByTitle: 1,
  unmatchedTitles: ["Ghost prompt"],
};

describe("CollectionImportDialog", () => {
  it("shows the summary and a plain add action when there is no collision", async () => {
    const onApply = vi.fn();
    renderApp(<CollectionImportDialog open preview={basePreview} pending={false} onApply={onApply} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/will be added as a new top-level collection/i)).toBeTruthy();
    expect(screen.getByText(/2 subcollections/)).toBeTruthy();
    expect(screen.getByText(/5 prompts referenced/)).toBeTruthy();
    expect(screen.getByText(/Ghost prompt/)).toBeTruthy();
    // No strategy group when nothing collides.
    expect(screen.queryByRole("radiogroup")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onApply).toHaveBeenCalledWith({ path: basePreview.path, strategy: "skip", expectedRootCollision: false });
  });

  it("offers the three strategies on collision and defaults to overwrite", async () => {
    const onApply = vi.fn();
    renderApp(
      <CollectionImportDialog
        open
        preview={{ ...basePreview, rootCollision: true, existingRootId: "existing" }}
        pending={false}
        onApply={onApply}
        onOpenChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: /conflict resolution/i });
    expect(group).toBeTruthy();
    expect(screen.getByText(/already exists at the top level/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onApply).toHaveBeenCalledWith({ path: basePreview.path, strategy: "overwrite", expectedRootCollision: true });
  });

  it("sends the chosen strategy", async () => {
    const onApply = vi.fn();
    renderApp(
      <CollectionImportDialog
        open
        preview={{ ...basePreview, rootCollision: true, existingRootId: "existing" }}
        pending={false}
        onApply={onApply}
        onOpenChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: /add as copy/i }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onApply).toHaveBeenCalledWith({ path: basePreview.path, strategy: "duplicate", expectedRootCollision: true });

    await userEvent.click(screen.getByRole("radio", { name: /skip import/i }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onApply).toHaveBeenLastCalledWith({ path: basePreview.path, strategy: "skip", expectedRootCollision: true });
  });

  it("disables Import while a apply is pending", () => {
    renderApp(<CollectionImportDialog open preview={basePreview} pending onApply={vi.fn()} onOpenChange={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders nothing without a preview", () => {
    renderApp(<CollectionImportDialog open preview={null} pending={false} onApply={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("mounts at most 200 unmatched titles and reports the rest as a count", () => {
    // A hostile file can carry huge member lists; mounting one <li> per
    // title would freeze the renderer. The label keeps the true count.
    const preview = { ...basePreview, unmatchedTitles: Array.from({ length: 250 }, (_, i) => `Ghost ${i + 1}`) };
    renderApp(<CollectionImportDialog open preview={preview} pending={false} onApply={vi.fn()} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/250 prompts not found/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
    expect(screen.getByText(/and 50 more/)).toBeTruthy();
  });
});
