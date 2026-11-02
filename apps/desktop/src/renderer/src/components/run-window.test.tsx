// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptBlockDto } from "../../../shared/ipc.js";
import { installMockBridge } from "../test/mock-bridge";
import { createTestQueryClient, renderApp } from "../test/render";
import { RunWindow } from "./run-controls";

const blocks: PromptBlockDto[] = [
  { id: "b1", description: "Tone", content: "Stay terse.", isActive: true },
  { id: "b2", description: "Extra", content: "Footnote.", isActive: false },
];

let bridge: ReturnType<typeof installMockBridge>;
const onRun = vi.fn();
const onOpenChange = vi.fn();
const onSelectionChange = vi.fn();

function renderWindow() {
  renderApp(
    <RunWindow
      open
      onOpenChange={onOpenChange}
      baseContent="Base"
      blocks={blocks}
      selection={[{ providerId: "prov", modelId: "model" }]}
      onSelectionChange={onSelectionChange}
      recents={[]}
      running={false}
      runLabel="Run"
      onRun={onRun}
    />,
    { queryClient: createTestQueryClient() },
  );
}

beforeEach(() => {
  bridge = installMockBridge();
  bridge.ai.providers.list.mockResolvedValue([]);
  onRun.mockClear();
  onOpenChange.mockClear();
  onSelectionChange.mockClear();
});

describe("RunWindow", () => {
  it("assembles the text from default block states and re-assembles on toggles", async () => {
    const user = userEvent.setup();
    renderWindow();

    const textarea = within(screen.getByRole("dialog", { name: "Generated prompt" })).getByRole("textbox");
    expect(textarea).toHaveValue("Base\nStay terse.");

    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));
    await waitFor(() => expect(textarea).toHaveValue("Base\nStay terse.\nFootnote."));
  });

  it("asks before re-assembly over manual edits and discards them on confirm", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Generated prompt" })).getByRole("textbox");

    await user.type(textarea, " EDITED");
    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/rebuild the prompt/i)).toBeInTheDocument();

    // Declining leaves both text and toggle untouched.
    await user.click(within(confirm).getByRole("button", { name: /cancel/i }));
    expect(textarea).toHaveValue("Base\nStay terse. EDITED");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));
    await user.click(await screen.findByRole("button", { name: /rebuild/i }));
    await waitFor(() => expect(textarea).toHaveValue("Base\nStay terse.\nFootnote."));
  });

  it("asks before closing over manual edits and only closes on confirm", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Generated prompt" })).getByRole("textbox");

    await user.type(textarea, " EDITED");
    // Both the X and the footer button route through the dirty-close guard.
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/close without running/i)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await user.click(await screen.findByRole("button", { name: /close without saving/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("runs the edited text as typed and closes the window", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Generated prompt" })).getByRole("textbox");

    await user.type(textarea, " EDITED");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(onRun).toHaveBeenCalledWith("Base\nStay terse. EDITED");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("copies the current text via Copy & Close", async () => {
    const user = userEvent.setup();
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    renderWindow();

    await user.click(screen.getByRole("button", { name: /copy & close/i }));

    expect(clipboardWriteText).toHaveBeenCalledWith("Base\nStay terse.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
