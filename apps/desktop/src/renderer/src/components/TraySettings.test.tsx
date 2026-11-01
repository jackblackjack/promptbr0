// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayStateDto } from "../../../shared/ipc.js";
import { installMockBridge, type MockBridge } from "../test/mock-bridge";
import { renderApp } from "../test/render";
import { TraySettings } from "./TraySettings";

const DISABLED: TrayStateDto = { enabled: false, available: true, error: null };

let bridge: MockBridge;

beforeEach(() => {
  vi.restoreAllMocks();
  bridge = installMockBridge();
  bridge.tray.getState.mockResolvedValue(DISABLED);
});

describe("TraySettings", () => {
  it("reflects the saved device-local preference", async () => {
    bridge.tray.getState.mockResolvedValue({ ...DISABLED, enabled: true });

    renderApp(<TraySettings />);

    expect(await screen.findByRole("switch", { name: "Keep running in the system tray" })).toBeChecked();
    expect(screen.getByText(/Closing the window hides it/)).toBeInTheDocument();
  });

  it("turns the tray on through the main process", async () => {
    const user = userEvent.setup();
    bridge.tray.setEnabled.mockResolvedValue({ ...DISABLED, enabled: true });

    renderApp(<TraySettings />);
    await user.click(await screen.findByRole("switch", { name: "Keep running in the system tray" }));

    expect(bridge.tray.setEnabled).toHaveBeenCalledWith({ enabled: true });
    expect(await screen.findByRole("switch")).toBeChecked();
  });

  it("explains when the desktop exposes no tray and keeps the switch disabled", async () => {
    bridge.tray.getState.mockResolvedValue({ enabled: false, available: false, error: "no tray" });

    renderApp(<TraySettings />);

    expect(
      await screen.findByText("The system tray is not available on this desktop."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("reports a failed save without losing the current state", async () => {
    const user = userEvent.setup();
    bridge.tray.setEnabled.mockRejectedValue(new Error("ipc failed"));

    renderApp(<TraySettings />);
    await user.click(await screen.findByRole("switch", { name: "Keep running in the system tray" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change this setting.");
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("surfaces a main-process failure that keeps the switch off", async () => {
    const user = userEvent.setup();
    bridge.tray.setEnabled.mockResolvedValue({
      enabled: false,
      available: true,
      error: "Tray settings could not be saved.",
    });

    renderApp(<TraySettings />);
    await user.click(await screen.findByRole("switch", { name: "Keep running in the system tray" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tray settings could not be saved.",
    );
    expect(screen.getByRole("switch")).not.toBeChecked();
  });
});
