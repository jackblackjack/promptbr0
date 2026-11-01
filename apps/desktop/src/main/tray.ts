/**
 * System-tray lifecycle and its two-item menu (Show / Quit).
 *
 * The tray is a device-local convenience: the preference lives in the
 * `settings` table (excluded from sync) and the menu follows the renderer's
 * interface language, which the main process receives over
 * `app:set-language`. Menu labels are duplicated here instead of importing the
 * renderer dictionaries: main does not load the code-split locale JSON.
 */
import {
  traySettingsSchema,
  uiLanguageSchema,
  type TrayStateDto,
} from "../shared/ipc.js";

export const TRAY_SETTINGS_KEY = "tray.settings";
export const UI_LANGUAGE_SETTING_KEY = "app.ui-language";

export type TrayLanguage = "en" | "ru";

export const TRAY_LABELS: Record<
  TrayLanguage,
  { show: string; quit: string; tooltip: string }
> = {
  en: { show: "Show", quit: "Quit", tooltip: "PromptBr0" },
  ru: { show: "Показать", quit: "Выход", tooltip: "PromptBr0" },
};

const UNAVAILABLE_MESSAGE =
  "The system tray is unavailable on this desktop. The window keeps its normal close behaviour.";

export interface TrayMenuItem {
  label: string;
  click(): void;
}

/** Minimal Tray surface so the controller stays testable without Electron. */
export interface TrayPort {
  setContextMenu(menu: unknown): void;
  setToolTip(text: string): void;
  on(event: "click", listener: () => void): void;
  destroy(): void;
}

export interface TrayControllerDeps {
  readSetting(key: string): string | null;
  writeSetting(key: string, value: string): void;
  /** Returns null when the desktop exposes no tray; may throw. */
  createTray(): TrayPort | null;
  buildContextMenu(items: TrayMenuItem[]): unknown;
  showMainWindow(): void;
  quitApp(): void;
  reportError(error: unknown): void;
}

export interface TrayController {
  getState(): TrayStateDto;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): TrayStateDto;
  setLanguage(language: TrayLanguage): void;
  dispose(): void;
}

function readInitialEnabled(deps: TrayControllerDeps): boolean {
  const raw = deps.readSetting(TRAY_SETTINGS_KEY);
  if (raw === null) return false;
  try {
    const parsed = traySettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("Saved tray settings are invalid");
    return parsed.data.enabled;
  } catch (error) {
    deps.reportError(error);
    return false;
  }
}

function readInitialLanguage(deps: TrayControllerDeps): TrayLanguage {
  const raw = deps.readSetting(UI_LANGUAGE_SETTING_KEY);
  if (raw === null) return "en";
  const parsed = uiLanguageSchema.safeParse(raw);
  return parsed.success ? parsed.data : "en";
}

export function createTrayController(deps: TrayControllerDeps): TrayController {
  let enabled = readInitialEnabled(deps);
  let language = readInitialLanguage(deps);
  let tray: TrayPort | null = null;
  let available = true;
  let error: string | null = null;
  let disposed = false;

  const persist = (nextEnabled: boolean): boolean => {
    try {
      deps.writeSetting(TRAY_SETTINGS_KEY, JSON.stringify({ enabled: nextEnabled }));
      return true;
    } catch (persistError) {
      deps.reportError(persistError);
      error = "Tray settings could not be saved.";
      return false;
    }
  };

  const menuFor = (): unknown => {
    const labels = TRAY_LABELS[language];
    return deps.buildContextMenu([
      { label: labels.show, click: () => deps.showMainWindow() },
      { label: labels.quit, click: () => deps.quitApp() },
    ]);
  };

  const destroyTray = (): void => {
    const current = tray;
    tray = null;
    if (!current) return;
    try {
      current.destroy();
    } catch (destroyError) {
      deps.reportError(destroyError);
    }
  };

  const createTray = (): boolean => {
    destroyTray();
    let created: TrayPort | null;
    try {
      created = deps.createTray();
    } catch (createError) {
      deps.reportError(createError);
      created = null;
    }
    if (!created) {
      available = false;
      error = UNAVAILABLE_MESSAGE;
      return false;
    }
    tray = created;
    available = true;
    error = null;
    created.setToolTip(TRAY_LABELS[language].tooltip);
    // Windows/Linux: a left click is a convenient "show". On macOS a click
    // opens the context menu (Electron documents that constraint).
    created.on("click", () => deps.showMainWindow());
    created.setContextMenu(menuFor());
    return true;
  };

  const state = (): TrayStateDto => ({
    enabled: enabled && tray !== null,
    available,
    error,
  });

  if (enabled && !createTray()) {
    // A tray that cannot exist must not keep the close-to-tray behaviour.
    enabled = false;
    persist(false);
  }

  return {
    getState: state,

    isEnabled() {
      return enabled && tray !== null;
    },

    setEnabled(nextEnabled) {
      if (disposed) return state();
      if (!nextEnabled) {
        if (!persist(false)) return state();
        enabled = false;
        destroyTray();
        return state();
      }
      if (enabled && tray !== null) return state();
      if (!createTray()) {
        enabled = false;
        persist(false);
        return state();
      }
      if (!persist(true)) {
        destroyTray();
        enabled = false;
        return state();
      }
      enabled = true;
      return state();
    },

    setLanguage(nextLanguage) {
      if (disposed) return;
      if (nextLanguage === language) return;
      language = nextLanguage;
      try {
        deps.writeSetting(UI_LANGUAGE_SETTING_KEY, language);
      } catch (persistError) {
        deps.reportError(persistError);
      }
      if (tray) tray.setContextMenu(menuFor());
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      destroyTray();
      enabled = false;
    },
  };
}
