// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptDetail, VersionContentDto, VersionDto } from "../../../shared/ipc.js";
import { installMockBridge, type MockBridge } from "../test/mock-bridge";
import { createTestQueryClient, renderApp } from "../test/render";
import { EditorTab } from "./EditorTab";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label="Prompt editor"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const baseBlocks: PromptDetail["blocks"] = [
  { id: "block-1", description: "Tone", content: "Stay terse.", isActive: true },
  { id: "block-2", description: "Extra", content: "Footnote.", isActive: false },
];

const promptA: PromptDetail = {
  id: "prompt-a",
  title: "Prompt A",
  description: null,
  icon: null,
  isStarred: false,
  versionLabel: "v1",
  tags: [],
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
  deletedAt: null,
  currentVersionId: "version-a",
  draftContent: null,
  draftBaseVersionId: null,
  blocks: baseBlocks,
  collectionIds: [],
};

const versionA: VersionContentDto = {
  id: "version-a",
  promptId: "prompt-a",
  branchId: "branch-a",
  branchName: "main",
  parentVersionId: null,
  number: 1,
  label: null,
  displayLabel: "v1",
  changeNote: null,
  author: "user",
  createdAt: "2026-08-01T09:00:00Z",
  isCurrent: true,
  content: "Persisted A version",
  contentFormat: "markdown",
};

const bakedVersion: VersionDto = {
  id: "version-baked",
  promptId: "prompt-a",
  branchId: "branch-a",
  branchName: "main",
  parentVersionId: "version-a",
  number: 2,
  label: null,
  displayLabel: "v2",
  changeNote: null,
  author: "user",
  createdAt: "2026-08-01T09:05:00Z",
  isCurrent: true,
};

let bridge: MockBridge;

beforeEach(() => {
  localStorage.clear();
  bridge = installMockBridge();
});

function renderEditorTab(prompt: PromptDetail = promptA, onVersionCreated?: (v: VersionDto) => void) {
  return renderApp(
    <EditorTab prompt={prompt} version={versionA} isCurrent onVersionCreated={onVersionCreated} />,
    { queryClient: createTestQueryClient() },
  );
}

describe("EditorTab optional blocks", () => {
  it("persists a default-state toggle through prompts.setBlocks", async () => {
    const user = userEvent.setup();
    const flipped = { ...promptA, blocks: [{ ...baseBlocks[0]!, isActive: false }, baseBlocks[1]!] };
    bridge.prompts.setBlocks.mockResolvedValue(flipped);
    bridge.prompts.get.mockResolvedValue(flipped);
    renderEditorTab();

    // Blocks exist, so the panel starts expanded.
    const toggle = screen.getByRole("switch", { name: "Block 1 active by default" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);

    await waitFor(() =>
      expect(bridge.prompts.setBlocks).toHaveBeenCalledWith("prompt-a", [
        { id: "block-1", description: "Tone", content: "Stay terse.", isActive: false },
        { id: "block-2", description: "Extra", content: "Footnote.", isActive: false },
      ]),
    );
  });

  it("bakes active blocks into a new version with the editor content and re-bases the draft", async () => {
    const user = userEvent.setup();
    const onVersionCreated = vi.fn();
    bridge.prompts.get.mockResolvedValue(promptA);
    bridge.prompts.bakeBlocks.mockResolvedValue({ version: bakedVersion, blocks: [baseBlocks[1]!] });
    renderEditorTab(promptA, onVersionCreated);

    await user.click(screen.getByRole("button", { name: /bake into new version/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/bake active blocks into v2/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/removed from the block list/i)).toBeInTheDocument();
    expect(bridge.prompts.setBlocks).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /save version/i }));

    await waitFor(() =>
      expect(bridge.prompts.bakeBlocks).toHaveBeenCalledWith({
        promptId: "prompt-a",
        branchId: "branch-a",
        baseVersionId: "version-a",
        content: "Persisted A version",
      }),
    );
    await waitFor(() =>
      expect(bridge.drafts.set).toHaveBeenCalledWith("prompt-a", "Persisted A version", "version-baked"),
    );
    expect(onVersionCreated).toHaveBeenCalledWith(bakedVersion);
  });

  it("bakes the edited editor text, including unsaved changes", async () => {
    const user = userEvent.setup();
    bridge.prompts.get.mockResolvedValue(promptA);
    bridge.prompts.bakeBlocks.mockResolvedValue({ version: bakedVersion, blocks: [baseBlocks[1]!] });
    renderEditorTab();

    await user.type(screen.getByRole("textbox", { name: "Prompt editor" }), "Edited");
    await user.click(screen.getByRole("button", { name: /bake into new version/i }));
    await user.click(screen.getByRole("button", { name: /save version/i }));

    await waitFor(() =>
      expect(bridge.prompts.bakeBlocks).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Persisted A versionEdited" }),
      ),
    );
  });

  it("disables baking while no persistable block is active", async () => {
    const inactiveOnly = {
      ...promptA,
      blocks: [{ id: "block-1", description: "", content: "Off by default.", isActive: false }],
    };
    renderEditorTab(inactiveOnly);

    expect(screen.getByRole("button", { name: /bake into new version/i })).toBeDisabled();
  });
});
