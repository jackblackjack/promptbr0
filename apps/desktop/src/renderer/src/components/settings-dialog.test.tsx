// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { useAppState } from "../state/app-state";
import { t, initI18n } from "../lib/i18n";
import { installMockBridge } from "../test/mock-bridge";
import { renderApp } from "../test/render";
import { SettingsDialog } from "./SettingsDialog";

function OpenSettingsWithSection({ section }: { section: "quick-access" | "about" | "appearance" }) {
  const { openSettings } = useAppState();
  useEffect(() => {
    openSettings(section);
  }, [openSettings, section]);
  return <SettingsDialog />;
}

describe("SettingsDialog Quick access section", () => {
  it("opens the global shortcut controls from settings navigation", async () => {
    installMockBridge();
    renderApp(<OpenSettingsWithSection section="quick-access" />);

    expect(await screen.findByRole("heading", { name: "Quick access" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable global shortcut" })).toBeInTheDocument();
  });
});

describe("SettingsDialog About section", () => {
  it("renders the repository link and opens it", async () => {
    const bridge = installMockBridge();
    renderApp(<OpenSettingsWithSection section="about" />);
    const repoLinks = await screen.findAllByRole("button", { name: /github\.com\/jackblackjack\/promptbr0/ });
    expect(repoLinks.length).toBeGreaterThanOrEqual(1);

    await userEvent.click(repoLinks[0]!);
    expect(bridge.app.openExternal).toHaveBeenCalledWith("https://github.com/jackblackjack/promptbr0");
  });

  it("opens the in-app open-source licenses dialog", async () => {
    installMockBridge();
    renderApp(<OpenSettingsWithSection section="about" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open Source Licenses" }));
    expect(await screen.findByRole("heading", { name: "Open Source Licenses" })).toBeInTheDocument();
  });

  it("does not link to a separate About window", async () => {
    installMockBridge();
    renderApp(<OpenSettingsWithSection section="about" />);

    // Wait for the section to finish rendering, then confirm the removed
    // duplicate entry point is gone.
    await screen.findByRole("button", { name: "Open Source Licenses" });
    expect(screen.queryByRole("button", { name: "Open About window" })).not.toBeInTheDocument();
  });
});

describe("SettingsDialog language switching", () => {
  beforeAll(async () => {
    // Ensure English is loaded for tests.
    await initI18n("en");
  });

  it("shows English labels by default in the sidebar", async () => {
    installMockBridge();
    renderApp(<OpenSettingsWithSection section="appearance" />);

    // Sidebar section labels should be in English by default
    const nav = await screen.findByRole("navigation");
    expect(nav).toBeInTheDocument();
    // Check the sidebar buttons contain English labels
    const sidebarButtons = nav.querySelectorAll("button");
    const labels = Array.from(sidebarButtons).map((b) => b.textContent).filter(Boolean);
    const joined = labels.join(" ");
    expect(joined).toContain("Appearance");
    expect(joined).toContain("Editor");
    expect(joined).toContain("Quick access");
    expect(joined).toContain("AI Providers");
    expect(joined).toContain("Data");
    expect(joined).toContain("Sync");
    expect(joined).toContain("Updates");
    expect(joined).toContain("About");
  });

  it("t() returns Russian translations after initI18n('ru')", async () => {
    // Verify English is the default
    expect(t("appearance.title")).toBe("Appearance");

    // Switch to Russian
    await initI18n("ru");

    // t() should now return Russian translations
    expect(t("appearance.title")).toBe("Внешний вид");
    expect(t("settings.sections.appearance")).toBe("Внешний вид");
    expect(t("appearance.theme")).toBe("Тема");
    expect(t("appearance.language")).toBe("Язык");

    // Fallback: missing keys should return the key itself
    expect(t("nonexistent.key")).toBe("nonexistent.key");

    // English should still be available as fallback for Russian keys that don't exist
    await initI18n("en");
    expect(t("appearance.title")).toBe("Appearance");
  });

  it("renders English labels when language is switched back", async () => {
    installMockBridge();
    renderApp(<OpenSettingsWithSection section="appearance" />);

    // Verify English is active — section title should be "Appearance"
    expect(await screen.findByRole("heading", { name: "Appearance", level: 3 })).toBeInTheDocument();

    // Find the language segmented control and click the Russian option
    const langGroup = screen.getByRole("group", { name: "Language" });
    const buttons = langGroup.querySelectorAll("button");
    const user = userEvent.setup();

    // Click Russian — the component re-renders after initI18n resolves.
    await user.click(buttons[1]!);

    // The settings UI itself must switch, not just the t() helper.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Внешний вид", level: 3 })).toBeInTheDocument();
    });
    expect(t("appearance.title")).toBe("Внешний вид");
    expect(localStorage.getItem("promptbr0:pref:ui-lang")).toBe('"ru"');

    // Leave the shared module state in English for any later test in this file.
    await initI18n("en");
  });
});
