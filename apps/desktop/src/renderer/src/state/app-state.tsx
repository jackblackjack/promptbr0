import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SortKey } from "../../../shared/ipc.js";
import { initI18n } from "../lib/i18n";
import { usePref } from "../lib/prefs";

export type ViewKind = "library" | "history" | "starred" | "trash" | "collection" | "suggestions";

export type SettingsSection = "appearance" | "editor" | "quick-access" | "ai" | "data" | "sync" | "updates" | "about";
export type UiLanguage = "en" | "ru";

export interface AppView {
  kind: ViewKind;
  /** Set when kind === "collection". */
  collectionId?: string;
  collectionName?: string;
}

export interface ListFilters {
  tagIds: string[];
  starredOnly: boolean;
  minRating?: number;
}

export const EMPTY_FILTERS: ListFilters = { tagIds: [], starredOnly: false };

export interface NewPromptCollection {
  id: string;
  name: string;
}

interface AppStateValue {
  view: AppView;
  setView: (view: AppView) => void;
  selectedPromptId: string | null;
  selectPrompt: (id: string | null) => void;
  /** Version being viewed in the main pane; null = the current version. */
  viewingVersionId: string | null;
  setViewingVersionId: (id: string | null) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  filters: ListFilters;
  setFilters: (filters: ListFilters) => void;
  filterByTag: (tagId: string) => void;
  listSearch: string;
  setListSearch: (value: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  newPromptOpen: boolean;
  newPromptCollection: NewPromptCollection | null;
  openNewPrompt: (collection?: NewPromptCollection) => void;
  setNewPromptOpen: (open: boolean) => void;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  setSettingsOpen: (open: boolean) => void;

  /** Public Markdown URL delivered by a promptbr0://import-markdown deep link. */
  markdownImportUrl: string | null;
  setMarkdownImportUrl: (url: string | null) => void;
  /** The "Manage models" dialog, opened from the model picker footer or Settings. */
  manageModelsOpen: boolean;
  setManageModelsOpen: (open: boolean) => void;

  /** Current UI language ("en" | "ru"). */
  uiLanguage: UiLanguage;
  setUiLanguage: (lang: UiLanguage) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>({ kind: "library" });
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("updated");
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [listSearch, setListSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newPromptOpen, setNewPromptOpenState] = useState(false);
  const [newPromptCollection, setNewPromptCollection] = useState<NewPromptCollection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [markdownImportUrl, setMarkdownImportUrl] = useState<string | null>(null);
  const [manageModelsOpen, setManageModelsOpen] = useState(false);
  // The language lives in the shared prefs store (localStorage) so the quick
  // palette window and the next app start see the same value.
  const [uiLanguage, setUiLanguage] = usePref("ui-lang");

  // Load the dictionary for the current language; switching languages
  // re-runs this and notifies subscribers once the new dictionary is ready.
  useEffect(() => {
    void initI18n(uiLanguage);
  }, [uiLanguage]);

  // Main owns the tray menu, so it needs the interface language too. The push
  // also happens on first mount: a relaunch with a saved language shows the
  // right tray labels before any settings surface is opened. The optional
  // chain keeps component tests that render this provider without the bridge
  // (see test/render.tsx) from failing on the effect.
  useEffect(() => {
    void window.promptbr0?.app?.setLanguage?.({ language: uiLanguage });
  }, [uiLanguage]);

  const selectPrompt = useCallback((id: string | null) => {
    setSelectedPromptId(id);
    setViewingVersionId(null);
  }, []);

  const openSettings = useCallback((section: SettingsSection = "appearance") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  const openNewPrompt = useCallback((collection?: NewPromptCollection) => {
    setNewPromptCollection(collection ?? null);
    setNewPromptOpenState(true);
  }, []);

  const filterByTag = useCallback((tagId: string) => {
    setView({ kind: "library" });
    setSelectedPromptId(null);
    setViewingVersionId(null);
    setListSearch("");
    setFilters((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((id) => id !== tagId)
        : [tagId],
    }));
  }, []);

  const setNewPromptOpen = useCallback((open: boolean) => {
    setNewPromptOpenState(open);
    if (!open) setNewPromptCollection(null);
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      view,
      setView,
      selectedPromptId,
      selectPrompt,
      viewingVersionId,
      setViewingVersionId,
      sort,
      setSort,
      filters,
      setFilters,
      filterByTag,
      listSearch,
      setListSearch,
      paletteOpen,
      setPaletteOpen,
      newPromptOpen,
      newPromptCollection,
      openNewPrompt,
      setNewPromptOpen,
      settingsOpen,
      settingsSection,
      openSettings,
      setSettingsOpen,

      markdownImportUrl,
      setMarkdownImportUrl,
      manageModelsOpen,
      setManageModelsOpen,
      uiLanguage,
      setUiLanguage,
    }),
    [view, selectedPromptId, selectPrompt, viewingVersionId, sort, filters, listSearch, paletteOpen, newPromptOpen, newPromptCollection, openNewPrompt, setNewPromptOpen, filterByTag, settingsOpen, settingsSection, openSettings, markdownImportUrl, manageModelsOpen, uiLanguage, setUiLanguage],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}
