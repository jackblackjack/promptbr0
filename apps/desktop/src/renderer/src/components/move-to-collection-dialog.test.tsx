// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionTreeDto, PromptDetail } from "../../../shared/ipc.js";
import { installMockBridge, type MockBridge } from "../test/mock-bridge";
import { renderApp } from "../test/render";
import { MoveToCollectionDialog } from "./MoveToCollectionDialog";

const work: CollectionTreeDto = {
  id: "collection-1",
  name: "Work",
  sortOrder: 0,
  parentId: null,
  promptCount: 3,
  children: [
    {
      id: "collection-2",
      name: "Archive",
      sortOrder: 0,
      parentId: "collection-1",
      promptCount: 1,
      children: [],
    },
  ],
};

const personal: CollectionTreeDto = {
  id: "collection-3",
  name: "Personal",
  sortOrder: 1,
  parentId: null,
  promptCount: 2,
  children: [],
};

const prompt: PromptDetail = {
  id: "prompt-1",
  title: "Beta",
  description: null,
  icon: null,
  isStarred: false,
  versionLabel: "v3",
  tags: [],
  collectionIds: [],
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
  deletedAt: null,
  currentVersionId: "version-1",
  draftContent: null,
  draftBaseVersionId: null,
  blocks: [],
};

function renderDialog(promptOverride?: Partial<PromptDetail>) {
  const onOpenChange = vi.fn();
  renderApp(
    <MoveToCollectionDialog
      prompt={{ ...prompt, ...promptOverride }}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

describe("MoveToCollectionDialog", () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = installMockBridge();
    bridge.collections.tree.mockResolvedValue({
      id: "root",
      name: "",
      sortOrder: 0,
      parentId: null,
      promptCount: 0,
      children: [work, personal],
    });
  });

  it("renders the collection hierarchy nested and fully expanded", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Move to collection" });
    expect(await within(dialog).findByRole("checkbox", { name: "Work" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Archive" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Personal" })).toBeInTheDocument();

    // "Archive" lives inside Work's subtree: the row wrapper that owns the
    // Work checkbox also owns the Archive checkbox.
    const workRow = within(dialog).getByRole("checkbox", { name: "Work" }).closest("div")!;
    expect(within(workRow.parentElement!).getByRole("checkbox", { name: "Archive" })).toBeInTheDocument();
  });

  it("collapses and re-expands a folder", async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Move to collection" });
    await within(dialog).findByRole("checkbox", { name: "Work" });
    await user.click(within(dialog).getByRole("button", { name: "Collapse folder" }));
    expect(within(dialog).queryByRole("checkbox", { name: "Archive" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Expand folder" }));
    expect(within(dialog).getByRole("checkbox", { name: "Archive" })).toBeInTheDocument();
  });

  it("saves add and remove diffs against the prompt's memberships", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog({ collectionIds: ["collection-3"] });

    const dialog = await screen.findByRole("dialog", { name: "Move to collection" });
    // Current membership starts checked.
    expect(await within(dialog).findByRole("checkbox", { name: "Personal" })).toBeChecked();

    await user.click(within(dialog).getByRole("checkbox", { name: "Archive" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Personal" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(bridge.collections.addPrompt).toHaveBeenCalledWith("collection-2", prompt.id);
      expect(bridge.collections.removePrompt).toHaveBeenCalledWith("collection-3", prompt.id);
      expect(bridge.collections.addPrompt).not.toHaveBeenCalledWith("collection-3", prompt.id);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes without touching memberships when nothing changed", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog({ collectionIds: ["collection-1"] });

    const dialog = await screen.findByRole("dialog", { name: "Move to collection" });
    expect(await within(dialog).findByRole("checkbox", { name: "Work" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(bridge.collections.addPrompt).not.toHaveBeenCalled();
    expect(bridge.collections.removePrompt).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the empty state when there are no collections", async () => {
    bridge.collections.tree.mockResolvedValue({
      id: "root",
      name: "",
      sortOrder: 0,
      parentId: null,
      promptCount: 0,
      children: [],
    });
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Move to collection" });
    expect(within(dialog).getByText(/No collections yet/)).toBeInTheDocument();
  });
});
