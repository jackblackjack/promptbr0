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

function renderWindow(baseContent = "Base") {
  renderApp(
    <RunWindow
      open
      onOpenChange={onOpenChange}
      baseContent={baseContent}
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

    const textarea = within(screen.getByRole("dialog", { name: "Prompt preparation" })).getByRole("textbox");
    expect(textarea).toHaveValue("Base\nStay terse.");

    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));
    await waitFor(() => expect(textarea).toHaveValue("Base\nStay terse.\nFootnote."));
  });

  it("keeps the text read-only until editing is toggled on", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Prompt preparation" })).getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    await user.type(textarea, " EDITED");
    expect(textarea).toHaveValue("Base\nStay terse.");

    // Block toggles work read-only and re-assemble without a confirm.
    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));
    await waitFor(() => expect(textarea).toHaveValue("Base\nStay terse.\nFootnote."));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Editing is opt-in via the header toggle.
    await user.click(screen.getByRole("button", { name: "Edit mode" }));
    expect(textarea.readOnly).toBe(false);
    await user.type(textarea, " EDITED");
    expect(textarea).toHaveValue("Base\nStay terse.\nFootnote. EDITED");
    await user.click(screen.getByRole("button", { name: "Edit mode" }));
    expect(textarea.readOnly).toBe(true);
  });

  it("asks before re-assembly over manual edits and discards them on confirm", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Prompt preparation" })).getByRole("textbox");

    await user.click(screen.getByRole("button", { name: "Edit mode" }));
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
    const textarea = within(screen.getByRole("dialog", { name: "Prompt preparation" })).getByRole("textbox");

    await user.click(screen.getByRole("button", { name: "Edit mode" }));
    await user.type(textarea, " EDITED");
    // Both the X and the footer button route through the dirty-close guard.
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/close without running/i)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    const closeConfirm = await screen.findByRole("alertdialog");
    await user.click(within(closeConfirm).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("runs the edited text as typed and closes the window", async () => {
    const user = userEvent.setup();
    renderWindow();
    const textarea = within(screen.getByRole("dialog", { name: "Prompt preparation" })).getByRole("textbox");

    await user.click(screen.getByRole("button", { name: "Edit mode" }));
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

  it("fills variables live from the panel and keeps every field visible", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}}, bye {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });
    const dialog = within(dialogEl);
    const textarea = dialogEl.querySelector("textarea")!;

    const nameInput = dialog.getByRole("textbox", { name: "Value for name" });
    await user.type(nameInput, "Иван");
    // Every occurrence substituted at once; the input survives mid-word so
    // the remaining keystrokes land in it.
    expect(textarea).toHaveValue("Hi Иван, bye Иван and {{x}}\nStay terse.");
    expect(nameInput).toHaveValue("Иван");

    // Filled fields stay in the panel after blur — values stay visible and
    // correctable; only the unfilled counter drops.
    await user.tab();
    expect(dialog.getByRole("textbox", { name: "Value for name" })).toHaveValue("Иван");
    expect(dialog.getByRole("textbox", { name: "Value for x" })).toHaveValue("");

    // Editing a filled field re-substitutes from the intact template.
    await user.type(nameInput, "!");
    expect(textarea).toHaveValue("Hi Иван!, bye Иван! and {{x}}\nStay terse.");

    // A block toggle re-assembles without touching the fills.
    await user.click(screen.getByRole("switch", { name: "Toggle block Extra" }));
    await waitFor(() =>
      expect(textarea).toHaveValue("Hi Иван!, bye Иван! and {{x}}\nStay terse.\nFootnote."),
    );
    expect(dialog.getByRole("textbox", { name: "Value for name" })).toHaveValue("Иван!");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("restores the placeholder when a value is cleared before leaving", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });
    const dialog = within(dialogEl);
    const textarea = dialogEl.querySelector("textarea")!;

    const nameInput = dialog.getByRole("textbox", { name: "Value for name" });
    await user.type(nameInput, "Иван");
    expect(textarea).toHaveValue("Hi Иван and {{x}}\nStay terse.");

    await user.clear(nameInput);
    expect(textarea).toHaveValue("Hi {{name}} and {{x}}\nStay terse.");
  });

  it("runs the fully substituted text", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });
    const dialog = within(dialogEl);
    const textarea = dialogEl.querySelector("textarea")!;
    expect(textarea).toHaveValue("Hi {{name}} and {{x}}\nStay terse.");

    await user.type(dialog.getByRole("textbox", { name: "Value for name" }), "Иван");
    await user.type(dialog.getByRole("textbox", { name: "Value for x" }), "!");
    // The panel keeps showing both fields with their values while open.
    expect(dialog.getByRole("textbox", { name: "Value for name" })).toHaveValue("Иван");
    expect(dialog.getByRole("textbox", { name: "Value for x" })).toHaveValue("!");

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("Hi Иван and !\nStay terse.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clears unfilled variables on run by default, keeping filled ones", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });
    const textarea = dialogEl.querySelector("textarea")!;

    await user.type(within(dialogEl).getByRole("textbox", { name: "Value for name" }), "Иван");
    // Filled values are already in the visible text; unfilled placeholders
    // stay on screen and only get removed from what is sent.
    expect(textarea).toHaveValue("Hi Иван and {{x}}\nStay terse.");

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("Hi Иван and \nStay terse.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps unfilled placeholders on run when the clear checkbox is off", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });

    await user.click(within(dialogEl).getByRole("checkbox", { name: "Clear unfilled" }));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("Hi {{name}} and {{x}}\nStay terse.");
  });

  it("keeps placeholders inside a supplied value when clearing unfilled", async () => {
    const user = userEvent.setup();
    renderWindow("Hi {{name}} and {{x}}");
    const dialogEl = screen.getByRole("dialog", { name: "Prompt preparation" });

    await user.type(within(dialogEl).getByRole("textbox", { name: "Value for name" }), "Иван");
    // The value itself contains something that looks like a placeholder: it is
    // literal content of a supplied value, not an unfilled variable of the
    // template, so "clear unfilled" must not remove it. (Opening braces are
    // doubled because userEvent.type treats {{ as a literal-brace escape.)
    await user.type(within(dialogEl).getByRole("textbox", { name: "Value for x" }), "see {{{{y}}");

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("Hi Иван and see {{y}}\nStay terse.");
  });

  it("clears unfilled variables on copy by default", async () => {
    const user = userEvent.setup();
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    renderWindow("Hi {{name}} and {{x}}");

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboardWriteText).toHaveBeenCalledWith("Hi  and \nStay terse.");
  });
});
