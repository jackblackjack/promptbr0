import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CloudDownload,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Info,
  Keyboard,
  Palette,
  RefreshCcw,
  SquarePen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import iconUrl from "../assets/icon.png";
import { useAppInfo, useAppMutation } from "../hooks/use-data";
import { usePref, type PrefKey } from "../lib/prefs";
import { t, onLocaleChange } from "../lib/i18n";
import { useThemeMode, type ThemeMode } from "../lib/theme";
import { cx } from "../lib/time";
import { useToast } from "../lib/toast";
import { useAppState, type SettingsSection, type UiLanguage } from "../state/app-state";
import { AiProvidersSection } from "./AiProvidersSection";
import { ConfirmDialog } from "./dialogs";
import { LicensesDialog } from "./LicensesDialog";
import { QuickPaletteSettings } from "./QuickPaletteSettings";
import { TraySettings } from "./TraySettings";

import { SyncSection } from "./SyncSection";
import { UpdatesSection } from "./UpdatesSection";

/** Section list; labels come from `settings.sections.*` translation keys. */
const SECTION_META: Array<{ id: SettingsSection; icon: React.ReactNode }> = [
  { id: "appearance", icon: <Palette size={13} /> },
  { id: "editor", icon: <SquarePen size={13} /> },
  { id: "quick-access", icon: <Keyboard size={13} /> },
  { id: "ai", icon: <Cpu size={13} /> },
  { id: "data", icon: <Database size={13} /> },
  { id: "sync", icon: <RefreshCcw size={13} /> },
  { id: "updates", icon: <CloudDownload size={13} /> },
  { id: "about", icon: <Info size={13} /> },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-semibold text-ink">{children}</h3>;
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <span className="text-[12px] font-medium text-ink-dim">{children}</span>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Horizontal segmented control used for theme, font size and editor mode. */
function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex w-fit rounded-md border border-line p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            "rounded px-2.5 py-1 text-[11px] transition-colors",
            value === option.value ? "bg-accent-soft font-medium text-accent" : "text-ink-dim hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** On/off switch bound to a boolean pref. */
function PrefToggle({ pref, label, hint }: { pref: PrefKey & ("word-wrap" | "autosave-drafts"); label: string; hint?: string }) {
  const [value, setValue] = usePref(pref);
  return (
    <div className="flex items-center justify-between gap-4">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => setValue(!value)}
        className={cx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          value ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
            value ? "left-4.5" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function AppearanceSection() {
  const [themeMode, setThemeMode] = useThemeMode();
  const [fontSize, setFontSize] = usePref("editor-font-size");
  const [editorMode, setEditorMode] = usePref("editor-mode");
  const { uiLanguage, setUiLanguage } = useAppState();
  const handleLanguageChange = useCallback((lang: UiLanguage) => setUiLanguage(lang), [setUiLanguage]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <FieldLabel hint={t("appearance.theme-hint")}>{t("appearance.theme")}</FieldLabel>
        <SegmentedControl<ThemeMode>
          ariaLabel={t("appearance.theme")}
          value={themeMode}
          onChange={setThemeMode}
          options={[
            { value: "dark", label: t("appearance.theme.dark") },
            { value: "light", label: t("appearance.theme.light") },
            { value: "system", label: t("appearance.theme.system") },
          ]}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel>{t("appearance.font-size")}</FieldLabel>
        <SegmentedControl<number>
          ariaLabel={t("appearance.font-size")}
          value={fontSize}
          onChange={setFontSize}
          options={[
            { value: 13, label: t("appearance.font-size.13") },
            { value: 14, label: t("appearance.font-size.14") },
            { value: 16, label: t("appearance.font-size.16") },
          ]}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel hint={t("appearance.editor-mode-hint")}>
          {t("appearance.editor-mode")}
        </FieldLabel>
        <SegmentedControl<"edit" | "preview" | "split">
          ariaLabel={t("appearance.editor-mode")}
          value={editorMode}
          onChange={setEditorMode}
          options={[
            { value: "edit", label: t("appearance.editor-mode.edit") },
            { value: "preview", label: t("appearance.editor-mode.preview") },
            { value: "split", label: t("appearance.editor-mode.split") },
          ]}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel hint={t("appearance.language-hint")}>{t("appearance.language")}</FieldLabel>
        <SegmentedControl<UiLanguage>
          ariaLabel={t("appearance.language")}
          value={uiLanguage}
          onChange={handleLanguageChange}
          options={[
            { value: "en", label: t("appearance.language.en") },
            { value: "ru", label: t("appearance.language.ru") },
          ]}
        />
      </div>
      <div className="border-t border-line pt-4">
        <TraySettings />
      </div>
    </div>
  );
}

function EditorSection() {
  return (
    <div className="space-y-5">
      <PrefToggle pref="word-wrap" label={t("editor.word-wrap")} hint={t("editor.word-wrap-hint")} />
      <PrefToggle
        pref="autosave-drafts"
        label={t("editor.autosave-drafts")}
        hint={t("editor.autosave-drafts-hint")}
      />
    </div>
  );
}

function DataSection() {
  const { data: appInfo } = useAppInfo();
  const { toast } = useToast();
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);

  const exportLibrary = useAppMutation(() => window.promptbr0.library.exportJson(), {
    toast: (r) => (r.canceled ? t("data.export-canceled") : `Exported to ${r.path!}`),
  });
  const importLibrary = useAppMutation(() => window.promptbr0.library.importJson(), {
    onSuccess: (r) => {
      if (r.canceled || !r.summary) return;
      const prompts = r.summary["prompts"]?.inserted ?? 0;
      const versions = r.summary["versions"]?.inserted ?? 0;
      toast(t("data.import-success", { prompts: String(prompts), versions: String(versions) }));
    },
  });
  const backupNow = useAppMutation(() => window.promptbr0.library.backupNow(), {
    toast: (path) => t("data.backup-success", { filename: path.split(/[\\/]/).pop() ?? "" }),
  });
  const emptyTrash = useAppMutation(() => window.promptbr0.library.emptyTrash(), {
    toast: (count) => count === 0 ? t("data.empty-trash-success-empty") : t("data.empty-trash-success", { count: String(count), s: count === 1 ? "" : "s" }),
  });

  const copyDbPath = () => {
    if (!appInfo) return;
    void navigator.clipboard.writeText(appInfo.dbPath).then(
      () => toast(t("data.db-path-copied")),
      () => toast(t("data.db-path-copy-failed")),
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <FieldLabel>{t("data.db-location")}</FieldLabel>
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-app px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim" title={appInfo?.dbPath}>
            {appInfo?.dbPath ?? "…"}
          </span>
          <button
            type="button"
            onClick={copyDbPath}
            className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label={t("data.db-copy-label")}
          >
            <Copy size={12} />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel hint={t("data.backups-hint")}>
          {t("data.backups")}
        </FieldLabel>
        <button
          type="button"
          onClick={() => backupNow.mutate(undefined)}
          disabled={backupNow.isPending}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <Download size={12} />
          {t("data.backup-now")}
        </button>
      </div>

      <div className="space-y-2">
        <FieldLabel hint={t("data.library-transfer-hint")}>
          {t("data.library-transfer")}
        </FieldLabel>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => exportLibrary.mutate(undefined)}
            disabled={exportLibrary.isPending}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <Upload size={12} />
            {t("data.export-library")}
          </button>
          <button
            type="button"
            onClick={() => importLibrary.mutate(undefined)}
            disabled={importLibrary.isPending}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <Download size={12} />
            {t("data.import-library")}
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-danger/20 bg-danger-soft p-3">
        <FieldLabel hint={t("data.danger-zone-hint")}>
          {t("data.danger-zone")}
        </FieldLabel>
        <button
          type="button"
          onClick={() => setEmptyTrashOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-danger/30 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger-soft"
        >
          <Trash2 size={12} />
          {t("data.empty-trash")}
        </button>
      </div>

      <ConfirmDialog
        open={emptyTrashOpen}
        onOpenChange={setEmptyTrashOpen}
        title={t("data.empty-trash-confirm")}
        description={t("data.empty-trash-desc")}
        confirmLabel={t("data.empty-trash-label")}
        danger
        onConfirm={() => emptyTrash.mutate(undefined)}
      />
    </div>
  );
}

function AboutSection() {
  const { data: appInfo } = useAppInfo();
  const { toast } = useToast();
  const [licensesOpen, setLicensesOpen] = useState(false);

  const openWebsite = () => {
    void window.promptbr0.app.openExternal("https://github.com/jackblackjack/promptbr0").catch(() => {
      toast(t("about.could-not-open"));
    });
  };

  const runtimes: Array<[string, string]> = appInfo
    ? [
        ["Electron", appInfo.electronVersion],
        ["Chromium", appInfo.chromeVersion],
        ["Node.js", appInfo.nodeVersion],
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img src={iconUrl} alt={t("about.app_icon_alt")} className="h-[100px] w-[100px] rounded-xl" />
        <div>
          <p className="text-[14px] font-semibold tracking-tight text-ink">{t("about.app-name")}</p>
          <p className="text-[12px] tabular-nums text-ink-dim">{t("about.version", { version: appInfo?.version ?? "…" })}</p>
          <p className="text-[11px] text-ink-faint">{t("about.tagline")}</p>
          <button
            type="button"
            onClick={openWebsite}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent transition-colors hover:underline"
          >
            github.com/jackblackjack/promptbr0
            <ExternalLink size={10} aria-hidden />
          </button>
        </div>
      </div>
      <dl className="space-y-1.5 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[11px] text-ink-faint">{t("about.repository")}</dt>
          <dd className="text-[11px]">
            <button
              type="button"
              onClick={openWebsite}
              className="inline-flex items-center gap-1 text-accent transition-colors hover:underline"
            >
              GitHub
              <ExternalLink size={10} aria-hidden />
            </button>
          </dd>
        </div>
        {runtimes.map(([label, version]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[11px] text-ink-faint">{label}</dt>
            <dd className="font-mono text-[11px] tabular-nums text-ink-dim">{version}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <p className="text-[11px] text-ink-faint">{t("about.copyright")}</p>
        <button
          type="button"
          onClick={() => setLicensesOpen(true)}
          className="text-[11px] text-accent hover:underline"
        >
          {t("about.licenses")}
        </button>
      </div>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </div>
  );
}

/**
 * Settings window-dialog: left section nav + right content. Opened from the
 * left-rail gear or the app menu (app:open-settings); the section can be
 * preselected via app state.
 */
export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, settingsSection } = useAppState();
  const [section, setSection] = useState<SettingsSection>(settingsSection);
  // A language switch loads the dictionary asynchronously; re-render the whole
  // dialog once it is ready (the app root does the same for the rest of the UI).
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((tick) => tick + 1)), []);

  // Opening via menu/gear may target a specific section; adopt it on open.
  useEffect(() => {
    if (settingsOpen) setSection(settingsSection);
  }, [settingsOpen, settingsSection]);

  const sections = SECTION_META.map((meta) => ({
    ...meta,
    label: t(`settings.sections.${meta.id}`),
  }));

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="pb-overlay fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pb-dialog fixed left-1/2 top-1/2 z-50 flex h-[min(520px,calc(100vh-2rem))] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50 focus:outline-none"
        >
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-app p-2">
            <Dialog.Title className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {t("settings.title")}
            </Dialog.Title>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cx(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                  section === item.id
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-dim hover:bg-hover hover:text-ink",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <SectionTitle>{t(`settings.sections.${section}`)}</SectionTitle>
              <Dialog.Close
                aria-label={t("dialog.close")}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
              >
                <X size={15} />
              </Dialog.Close>
            </div>
            <div className="@container min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {section === "appearance" && <AppearanceSection />}
              {section === "editor" && <EditorSection />}
              {section === "quick-access" && <QuickPaletteSettings />}
              {section === "ai" && <AiProvidersSection />}
              {section === "data" && <DataSection />}

              {section === "sync" && <SyncSection />}
              {section === "updates" && <UpdatesSection />}
              {section === "about" && <AboutSection />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
