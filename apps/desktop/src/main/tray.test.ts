import { describe, expect, it, vi } from "vitest";
import {
  createTrayController,
  TRAY_LABELS,
  TRAY_SETTINGS_KEY,
  UI_LANGUAGE_SETTING_KEY,
  type TrayControllerDeps,
  type TrayMenuItem,
  type TrayPort,
} from "./tray.js";

class FakeTray implements TrayPort {
  menu: TrayMenuItem[] = [];
  tooltip: string | null = null;
  destroyed = 0;
  readonly listeners = new Map<string, () => void>();

  setContextMenu(menu: unknown): void {
    this.menu = menu as TrayMenuItem[];
  }

  setToolTip(text: string): void {
    this.tooltip = text;
  }

  on(event: "click", listener: () => void): void {
    this.listeners.set(event, listener);
  }

  destroy(): void {
    this.destroyed += 1;
  }

  click(): void {
    this.listeners.get("click")?.();
  }
}

function createHarness(options: {
  savedSettings?: string | null;
  savedLanguage?: string | null;
  trayCount?: number;
} = {}) {
  const settings = new Map<string, string>();
  if (options.savedSettings !== undefined && options.savedSettings !== null) {
    settings.set(TRAY_SETTINGS_KEY, options.savedSettings);
  }
  if (options.savedLanguage !== undefined && options.savedLanguage !== null) {
    settings.set(UI_LANGUAGE_SETTING_KEY, options.savedLanguage);
  }
  const trays: FakeTray[] = [];
  const trayCount = options.trayCount ?? Number.POSITIVE_INFINITY;
  const showMainWindow = vi.fn();
  const quitApp = vi.fn();
  const reportError = vi.fn();
  const deps: TrayControllerDeps = {
    readSetting: (key) => settings.get(key) ?? null,
    writeSetting: (key, value) => {
      settings.set(key, value);
    },
    createTray: () => {
      if (trays.length >= trayCount) return null;
      const tray = new FakeTray();
      trays.push(tray);
      return tray;
    },
    buildContextMenu: (items) => items,
    showMainWindow,
    quitApp,
    reportError,
  };
  const controller = createTrayController(deps);
  return {
    controller,
    deps,
    quitApp,
    reportError,
    settings,
    showMainWindow,
    trays,
    lastTray: () => trays.at(-1)!,
  };
}

describe("tray controller", () => {
  it("starts disabled and creates no tray icon", () => {
    const harness = createHarness();

    expect(harness.controller.getState()).toEqual({
      enabled: false,
      available: true,
      error: null,
    });
    expect(harness.controller.isEnabled()).toBe(false);
    expect(harness.trays).toHaveLength(0);
  });

  it("builds the English Show/Quit menu and persists the opt-in", () => {
    const harness = createHarness();

    const state = harness.controller.setEnabled(true);

    expect(state).toEqual({ enabled: true, available: true, error: null });
    expect(harness.controller.isEnabled()).toBe(true);
    expect(JSON.parse(harness.settings.get(TRAY_SETTINGS_KEY)!)).toEqual({ enabled: true });
    const tray = harness.lastTray();
    expect(tray.tooltip).toBe("PromptBr0");
    expect(tray.menu.map((item) => item.label)).toEqual(["Show", "Quit"]);
  });

  it("shows the window from the menu and from a tray click, and quits from Quit", () => {
    const harness = createHarness();
    harness.controller.setEnabled(true);
    const tray = harness.lastTray();

    tray.menu[0]!.click();
    tray.click();
    tray.menu[1]!.click();

    expect(harness.showMainWindow).toHaveBeenCalledTimes(2);
    expect(harness.quitApp).toHaveBeenCalledOnce();
  });

  it("follows the interface language without recreating the tray", () => {
    const harness = createHarness();
    harness.controller.setEnabled(true);
    const tray = harness.lastTray();

    harness.controller.setLanguage("ru");

    expect(harness.trays).toHaveLength(1);
    expect(tray.menu.map((item) => item.label)).toEqual(["Показать", "Выход"]);
    expect(harness.settings.get(UI_LANGUAGE_SETTING_KEY)).toBe("ru");
  });

  it("uses the saved language and language-independent tooltip", () => {
    const harness = createHarness({ savedLanguage: "ru" });
    harness.controller.setEnabled(true);

    expect(harness.lastTray().tooltip).toBe(TRAY_LABELS.ru.tooltip);
    expect(harness.lastTray().menu.map((item) => item.label)).toEqual(["Показать", "Выход"]);
  });

  it("recreates the tray on startup when the option was saved as enabled", () => {
    const harness = createHarness({ savedSettings: JSON.stringify({ enabled: true }) });

    expect(harness.controller.getState().enabled).toBe(true);
    expect(harness.controller.isEnabled()).toBe(true);
    expect(harness.trays).toHaveLength(1);
  });

  it("falls back to disabled defaults when the saved settings are corrupt", () => {
    const harness = createHarness({ savedSettings: "{not-json" });

    expect(harness.controller.getState().enabled).toBe(false);
    expect(harness.reportError).toHaveBeenCalled();
    expect(harness.trays).toHaveLength(0);
  });

  it("reports unavailable desktops and keeps the opt-in off", () => {
    const harness = createHarness({ trayCount: 0 });

    const state = harness.controller.setEnabled(true);

    expect(state.enabled).toBe(false);
    expect(state.available).toBe(false);
    expect(state.error).toContain("system tray is unavailable");
    expect(harness.controller.isEnabled()).toBe(false);
    expect(JSON.parse(harness.settings.get(TRAY_SETTINGS_KEY)!)).toEqual({ enabled: false });
  });

  it("survives a throwing tray constructor", () => {
    const harness = createHarness();
    harness.deps.createTray = () => {
      throw new Error("libappindicator missing");
    };

    const state = harness.controller.setEnabled(true);

    expect(state).toMatchObject({ enabled: false, available: false });
    expect(harness.reportError).toHaveBeenCalled();
  });

  it("destroys the tray when the option is turned off", () => {
    const harness = createHarness();
    harness.controller.setEnabled(true);
    const tray = harness.lastTray();

    const state = harness.controller.setEnabled(false);

    expect(state).toEqual({ enabled: false, available: true, error: null });
    expect(tray.destroyed).toBe(1);
    expect(harness.controller.isEnabled()).toBe(false);
  });

  it("keeps the option off and destroys the tray when saving it fails", () => {
    const harness = createHarness();
    harness.deps.writeSetting = () => {
      throw new Error("database is read-only");
    };

    const state = harness.controller.setEnabled(true);

    expect(state.enabled).toBe(false);
    expect(state.error).toBe("Tray settings could not be saved.");
    expect(harness.trays.at(-1)!.destroyed).toBe(1);
  });

  it("disposes idempotently and ignores later updates", () => {
    const harness = createHarness();
    harness.controller.setEnabled(true);
    const tray = harness.lastTray();

    harness.controller.setEnabled(true);
    harness.controller.dispose();
    harness.controller.dispose();
    harness.controller.setLanguage("ru");

    expect(tray.destroyed).toBe(1);
    expect(harness.controller.getState().enabled).toBe(false);
    expect(harness.trays).toHaveLength(1);
  });
});
