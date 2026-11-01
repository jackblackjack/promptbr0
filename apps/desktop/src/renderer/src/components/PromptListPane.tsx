import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownWideNarrow,
  Check,
  Copy,
  Download,
  FileText,
  Folder,
  FolderInput,
  FolderMinus,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import type { PromptDetail, PromptSummary, SortKey } from "../../../shared/ipc.js";
import { useAppMutation, useCollections, usePromptList, useTags } from "../hooks/use-data";
import { userErrorMessage } from "../lib/errors";
import { t } from "../lib/i18n";
import { cx } from "../lib/time";
import { useToast } from "../lib/toast";
import { useAppState, EMPTY_FILTERS, type AppView } from "../state/app-state";
import type { CollectionDto } from "../../../shared/ipc.js";
import { ConfirmDialog, DuplicateBranchDialog, NameDialog } from "./dialogs";
import { MoveToCollectionDialog } from "./MoveToCollectionDialog";
import { colorForName, EmptyState, Spinner, TagChip } from "./ui";

// Holds translation *keys* rather than translated labels: module scope runs
// once, so resolving t() here would freeze the labels in the startup language.
const SORT_OPTIONS: Array<{ value: SortKey; labelKey: string }> = [
  { value: "updated", labelKey: "prompt_list.sort_updated" },
  { value: "created", labelKey: "prompt_list.sort_created" },
  { value: "title", labelKey: "prompt_list.sort_name" },
  { value: "rating", labelKey: "prompt_list.sort_rating" },
];

function CollectionChips({
  collectionIds,
  setView,
}: {
  collectionIds: string[];
  setView: (view: AppView) => void;
}) {
  const { data: collections } = useCollections();
  const collectionMap = useMemo(() => {
    const map = new Map<string, CollectionDto>();
    for (const c of collections ?? []) map.set(c.id, c);
    return map;
  }, [collections]);

  const visible = collectionIds.slice(0, 4);
  const more = collectionIds.length - visible.length;

  if (visible.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {visible.map((id) => {
        const c = collectionMap.get(id);
        if (!c) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setView({ kind: "collection", collectionId: id })}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-folder-soft text-folder hover:bg-folder-soft/80"
          >
            <Folder size={10} />
            <span className="truncate max-w-[80px]">{c.name}</span>
          </button>
        );
      })}
      {more > 0 && (
        <span className="text-[10px] text-ink-faint">{t("prompt_list.more", { count: more })}</span>
      )}
    </div>
  );
}

const VIEW_TITLES: Record<string, string> = {
  library: "prompt_list.library",
  starred: "prompt_list.starred",
  trash: "prompt_list.trash",
};

interface DuplicateSourceTarget {
  prompt: PromptDetail;
  versionId: string;
  versionLabel: string;
}

function FilterPopover() {
  const { filters, setFilters } = useAppState();
  const { data: tags } = useTags();
  const { data: collections } = useCollections();
  const [open, setOpen] = useState(false);

  const activeCount =
    filters.tagIds.length + (filters.starredOnly ? 1 : 0) + (filters.minRating !== undefined ? 1 : 0);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cx(
            "relative flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-dim transition-colors",
            "hover:bg-hover hover:text-ink",
            activeCount > 0 && "border-accent/50 text-accent",
          )}
          aria-label={t("prompt_list.filter")}
        >
          <SlidersHorizontal size={13} />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="pb-menu z-50 w-64 rounded-lg border border-line-strong bg-raised p-3 shadow-xl shadow-black/40"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">{t("prompt_list.filter")}</span>
            {activeCount > 0 && (
              <button
                type="button"
                className="text-[11px] text-accent hover:underline"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                {t("prompt_list.clear_all")}
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{t("prompt_list.tags")}</p>
              <div className="max-h-36 space-y-0.5 overflow-y-auto">
                {(tags ?? []).length === 0 && <p className="text-[11px] text-ink-faint">{t("left_rail.no_tags")}</p>}
                {(tags ?? []).map((tag) => {
                  const checked = filters.tagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] text-ink-dim hover:bg-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setFilters({
                            ...filters,
                            tagIds: checked
                              ? filters.tagIds.filter((id) => id !== tag.id)
                              : [...filters.tagIds, tag.id],
                          })
                        }
                        className="accent-accent"
                      />
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color ?? colorForName(tag.name) }}
                      />
                      <span className="min-w-0 truncate">{tag.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-dim">
              <input
                type="checkbox"
                checked={filters.starredOnly}
                onChange={(e) => setFilters({ ...filters, starredOnly: e.target.checked })}
                className="accent-accent"
              />
              {t("prompt_list.starred-only")}
            </label>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {t("prompt_list.min_rating")}
              </p>
              <select
                value={filters.minRating ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    minRating: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                className="w-full rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink focus:border-accent/60 focus:outline-none"
              >
                <option value="">{t("prompt_list.any_rating")}</option>
                <option value="3">{t("prompt_list.stars", { n: 3 })}</option>
                <option value="4">{t("prompt_list.stars", { n: 4 })}</option>
                <option value="4.5">{t("prompt_list.stars", { n: 4.5 })}</option>
              </select>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortDropdown() {
  const { sort, setSort } = useAppState();
  const current = SORT_OPTIONS.find((o) => o.value === sort);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        >
          <ArrowDownWideNarrow size={12} />
          {t(current?.labelKey ?? "prompt_list.sort")}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="pb-menu z-50 w-36 rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
        >
          <DropdownMenu.RadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            {SORT_OPTIONS.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[12px] text-ink-dim outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink"
              >
                {t(option.labelKey)}
                <DropdownMenu.ItemIndicator>
                  <Check size={12} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PromptCard({
  prompt,
  onContextMenu,
  setView,
}: {
  prompt: PromptSummary;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  setView: (view: AppView) => void;
}) {
  const { selectedPromptId, selectPrompt, filterByTag } = useAppState();
  const setStarred = useAppMutation(
    (starred: boolean) => window.promptbr0.prompts.setStarred(prompt.id, starred),
    { quiet: true },
  );
  const selected = selectedPromptId === prompt.id;

  return (
    <button
      type="button"
      onClick={() => selectPrompt(prompt.id)}
      onContextMenu={onContextMenu}
      className={cx(
        "group relative w-full rounded-lg border bg-panel p-3 text-left transition-colors",
        selected
          ? "border-accent/60 ring-1 ring-accent/40"
          : "border-line hover:border-line-strong hover:bg-raised",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <FileText size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{prompt.title}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setStarred.mutate(!prompt.isStarred);
              }}
              className={cx(
                "shrink-0 rounded p-0.5 transition-colors",
                prompt.isStarred ? "text-star" : "text-ink-faint opacity-0 hover:text-star group-hover:opacity-100",
              )}
              aria-label={prompt.isStarred ? t("prompt_list.unstar") : t("prompt_list.star")}
            >
              <Star size={13} fill={prompt.isStarred ? "currentColor" : "none"} />
            </span>
          </div>
          {prompt.description && (
            <p className="mt-0.5 truncate text-[12px] text-ink-dim">{prompt.description}</p>
          )}
          {prompt.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {prompt.tags.slice(0, 4).map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  color={tag.color ?? colorForName(tag.name)}
                  onClick={() => filterByTag(tag.id)}
                />
              ))}
              {prompt.tags.length > 4 && (
                <span className="text-[10px] text-ink-faint">+{prompt.tags.length - 4}</span>
              )}
            </div>
          )}
          {prompt.collectionIds.length > 0 && (
            <CollectionChips
              collectionIds={prompt.collectionIds}
              setView={setView}
            />
          )}

        </div>
      </div>
    </button>
  );
}

function PromptMenuItem({
  icon,
  label,
  danger,
  autoFocus,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      autoFocus={autoFocus}
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] outline-none",
        danger
          ? "text-danger hover:bg-danger-soft focus:bg-danger-soft"
          : "text-ink-dim hover:bg-hover hover:text-ink focus:bg-hover focus:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function PromptListPane({
  collapsed = false,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const {
    view,
    setView,
    listSearch,
    setListSearch,
    openNewPrompt,
    filters,
    selectedPromptId,
    selectPrompt,
    viewingVersionId,
    setViewingVersionId,
  } = useAppState();
  const { data: prompts, isLoading } = usePromptList();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [contextMenu, setContextMenu] = useState<{
    prompt: PromptSummary;
    x: number;
    y: number;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<PromptSummary | null>(null);
  const [moveTarget, setMoveTarget] = useState<PromptDetail | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateSourceTarget | null>(null);
  const [duplicatePromptTarget, setDuplicatePromptTarget] = useState<DuplicateSourceTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptSummary | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<PromptSummary | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const setStarred = useAppMutation(
    ({ promptId, starred }: { promptId: string; starred: boolean }) =>
      window.promptbr0.prompts.setStarred(promptId, starred),
    { quiet: true },
  );
  const rename = useAppMutation(
    ({ promptId, title }: { promptId: string; title: string }) =>
      window.promptbr0.prompts.update(promptId, { title }),
    { toast: t("main_pane.prompt_renamed") },
  );
  const exportPrompt = useAppMutation(
    (promptId: string) => window.promptbr0.prompts.exportJson(promptId),
    { toast: (result) => (result.canceled ? "Export canceled" : `Exported to ${result.path}`) },
  );
  const softDelete = useAppMutation(
    (promptId: string) => window.promptbr0.prompts.softDelete(promptId),
    { toast: t("main_pane.moved_to_trash"), onSuccess: () => selectPrompt(null) },
  );
  const restore = useAppMutation(
    (promptId: string) => window.promptbr0.prompts.restore(promptId),
    { toast: t("main_pane.prompt_restored") },
  );
  const hardDelete = useAppMutation(
    (promptId: string) => window.promptbr0.prompts.hardDelete(promptId),
    { toast: t("main_pane.prompt_permanently_deleted"), onSuccess: () => selectPrompt(null) },
  );
  const duplicatePrompt = useAppMutation(
    ({ promptId, versionId, title }: { promptId: string; versionId: string; title: string }) =>
      window.promptbr0.prompts.duplicate({ promptId, versionId, title }),
    {
      toast: t("main_pane.prompt_duplicated"),
      onSuccess: (created) => selectPrompt(created.id),
    },
  );
  const removeFromCollection = useAppMutation(
    ({ collectionId, promptId }: { collectionId: string; promptId: string }) =>
      window.promptbr0.collections.removePrompt(collectionId, promptId),
    { toast: t("prompt_list.removed_from_collection") },
  );

  const loadPrompt = async (
    summary: PromptSummary,
    usePrompt: (prompt: PromptDetail) => void,
  ) => {
    try {
      const prompt = await window.promptbr0.prompts.get(summary.id);
      if (!prompt) throw new Error(t("prompt_list.prompt_not_found"));
      usePrompt(prompt);
    } catch (error) {
      toast(userErrorMessage(error), "error");
    }
  };

  const copyPromptName = async (prompt: PromptSummary) => {
    setContextMenu(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt.title);
      toast(t("prompt_list.prompt_name_copied"));
    } catch {
      toast(t("prompt_list.could_not_copy_name"), "error");
    }
  };

  const loadDuplicateSource = async (
    summary: PromptSummary,
    useSource: (target: DuplicateSourceTarget) => void,
  ) => {
    try {
      const prompt = await window.promptbr0.prompts.get(summary.id);
      if (!prompt) throw new Error(t("prompt_list.prompt_not_found"));
      const versionId =
        selectedPromptId === summary.id
          ? (viewingVersionId ?? prompt.currentVersionId)
          : prompt.currentVersionId;
      if (!versionId) throw new Error(t("prompt_list.no_saved_version"));
      const version = await window.promptbr0.versions.get(versionId);
      if (!version) throw new Error(t("prompt_list.selected_version_not_found"));
      useSource({ prompt, versionId, versionLabel: version.displayLabel });
    } catch (error) {
      toast(userErrorMessage(error), "error");
    }
  };

  const duplicateAsVariation = async (name: string, description: string) => {
    const target = duplicateTarget;
    if (!target) throw new Error(t("prompt_list.no_version_selected"));
    const result = await window.promptbr0.branches.create({
      promptId: target.prompt.id,
      name,
      fromVersionId: target.versionId,
      ...(description ? { description } : {}),
    });
    await queryClient.invalidateQueries();
    selectPrompt(target.prompt.id);
    setViewingVersionId(result.version.id);
    void window.promptbr0.sync.now().catch(() => undefined);
    toast(t("main_pane.variation_created", { name }));
  };

  const createPrompt = () =>
    openNewPrompt(
      view.kind === "collection" && view.collectionId
        ? { id: view.collectionId, name: view.collectionName ?? t("prompt_list.collection") }
        : undefined,
    );

  const filtered = useMemo(() => {
    const list = prompts ?? [];
    const q = listSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.tags.some((t) => t.name.toLowerCase().includes(q)),
    );
  }, [prompts, listSearch]);

  const title =
    view.kind === "collection"
      ? (view.collectionName ?? t("prompt_list.collection"))
      : t(VIEW_TITLES[view.kind] ?? "prompt_list.library");
  const subheader =
    view.kind === "library" && (filters.tagIds.length > 0 || filters.starredOnly || filters.minRating !== undefined)
      ? t("prompt_list.filtered")
      : view.kind === "library"
        ? t("prompt_list.all_prompts")
        : title;

  // Breadcrumb path for collection view.
  const isCollectionView = view.kind === "collection";
  const [breadcrumbs, setBreadcrumbs] = useState<
    Array<{ id: string; name: string; parentId: string | null }>
  >([]);
  useEffect(() => {
    if (!isCollectionView || !view.collectionId) {
      setBreadcrumbs([]);
      return;
    }
    const load = async () => {
      try {
        const collectionId = view.collectionId;
        if (!collectionId) return;
        const path = await window.promptbr0.collections.path(collectionId);
        setBreadcrumbs(path);
      } catch {
        // Non-critical — fall back to showing just the collection name.
      }
    };
    void load();
  }, [isCollectionView, view.collectionId]);
  const hasActiveListCriteria =
    listSearch.trim().length > 0 ||
    (view.kind === "library" &&
      (filters.tagIds.length > 0 || filters.starredOnly || filters.minRating !== undefined));

  // Slim strip shown when the list panel is collapsed.
  if (collapsed) {
    return (
      <section className="flex h-full w-full flex-col items-center gap-1 bg-app py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={t("prompt_list.expand_list")}
          aria-label={t("prompt_list.expand_list")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelLeftOpen size={14} />
        </button>
        <button
          type="button"
          onClick={createPrompt}
          title={t("prompt_list.new-prompt")}
          aria-label={t("prompt_list.new-prompt")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        >
          <Plus size={14} />
        </button>
      </section>
    );
  }

  return (
    <section className="flex h-full w-full flex-col bg-app">
      <div className="border-b border-line px-3 pb-3 pt-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {isCollectionView && breadcrumbs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-0.5 text-[12px] text-ink-dim">
                {breadcrumbs.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-0.5">
                    {i > 0 && <span className="mx-0.5 text-ink-faint">›</span>}
                    <button
                      type="button"
                      onClick={() => {
                        const parent = breadcrumbs[i]?.parentId ?? null;
                        if (parent === null && i === breadcrumbs.length - 1) {
                          // Top-level breadcrumb is the current collection → go to Library.
                          setView({ kind: "library" });
                        } else {
                          setView({ kind: "collection", collectionId: crumb.id });
                        }
                      }}
                      className={cx(
                        "transition-colors hover:text-ink",
                        i === breadcrumbs.length - 1 && "font-semibold text-ink",
                      )}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <h1 className="min-w-0 truncate text-[14px] font-semibold text-ink">{title}</h1>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {view.kind === "library" && <FilterPopover />}
            <button
              type="button"
              onClick={createPrompt}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-strong"
              aria-label={t("prompt_list.new-prompt")}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              title={t("prompt_list.collapse_list")}
              aria-label={t("prompt_list.collapse_list")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <PanelLeftClose size={13} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            id="prompt-search-input"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder={t("prompt_list.search_placeholder")}
            className="w-full rounded-md border border-line bg-panel py-1.5 pl-8 pr-2.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-[11px] font-medium text-ink-faint">
          {subheader}
          {filtered.length > 0 && <span className="ml-1.5 tabular-nums">({filtered.length})</span>}
        </span>
        <SortDropdown />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {isLoading && <Spinner />}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon={view.kind === "trash" ? <Trash2 size={16} /> : <FileText size={16} />}
            title={
              hasActiveListCriteria
                ? t("prompt_list.no_matching")
                : view.kind === "trash"
                  ? t("prompt_list.trash_empty")
                  : view.kind === "starred"
                    ? t("prompt_list.no_starred")
                    : t("prompt_list.no_prompts_yet")
            }
            hint={
              hasActiveListCriteria
                ? t("prompt_list.try_different_search")
                : view.kind === "trash"
                  ? t("prompt_list.deleted_prompts_landing")
                  : view.kind === "starred"
                    ? t("prompt_list.star_from_list")
                    : t("prompt_list.create_first")
            }
          />
        )}
        {filtered.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            onContextMenu={(event) => {
              event.preventDefault();
              if (selectedPromptId !== prompt.id) selectPrompt(prompt.id);
              setContextMenu({ prompt, x: event.clientX, y: event.clientY });
            }}
            setView={setView}
          />
        ))}
      </div>

      {contextMenu && (
        <div
          role="menu"
          aria-label={t("prompt_list.actions_for", { title: contextMenu.prompt.title })}
          onPointerDown={(event) => event.stopPropagation()}
          className="pb-menu fixed z-50 w-64 rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 264)),
            top: Math.max(
              8,
              Math.min(contextMenu.y, window.innerHeight - (view.kind === "trash" ? 124 : 340)),
            ),
          }}
        >
          {view.kind === "trash" ? (
            <>
              <PromptMenuItem
                autoFocus
                icon={<RotateCcw size={13} />}
                label={t("prompt_list.restore")}
                onClick={() => {
                  restore.mutate(contextMenu.prompt.id);
                  setContextMenu(null);
                }}
              />
              <PromptMenuItem
                icon={<Copy size={13} />}
                label={t("prompt_list.copy_name")}
                onClick={() => void copyPromptName(contextMenu.prompt)}
              />
              <div className="my-1 h-px bg-line" />
              <PromptMenuItem
                icon={<Trash2 size={13} />}
                label={t("prompt_list.delete-permanently")}
                danger
                onClick={() => {
                  setHardDeleteTarget(contextMenu.prompt);
                  setContextMenu(null);
                }}
              />
            </>
          ) : (
            <>
              <PromptMenuItem
                autoFocus
                icon={<Star size={13} />}
                label={contextMenu.prompt.isStarred ? t("prompt_list.unstar") : t("prompt_list.star")}
                onClick={() => {
                  setStarred.mutate({
                    promptId: contextMenu.prompt.id,
                    starred: !contextMenu.prompt.isStarred,
                  });
                  setContextMenu(null);
                }}
              />
              <PromptMenuItem
                icon={<Copy size={13} />}
                label={t("prompt_list.copy_name")}
                onClick={() => void copyPromptName(contextMenu.prompt)}
              />
              <PromptMenuItem
                icon={<Pencil size={13} />}
                label={t("prompt_list.rename")}
                onClick={() => {
                  setRenameTarget(contextMenu.prompt);
                  setContextMenu(null);
                }}
              />
              <PromptMenuItem
                icon={<FolderInput size={13} />}
                label={t("prompt_list.move-to-collection")}
                onClick={() => {
                  void loadPrompt(contextMenu.prompt, setMoveTarget);
                  setContextMenu(null);
                }}
              />
              {view.kind === "collection" && view.collectionId && (
                <PromptMenuItem
                  icon={<FolderMinus size={13} />}
                  label={t("prompt_list.remove_from_collection")}
                  onClick={() => {
                    removeFromCollection.mutate({
                      collectionId: view.collectionId!,
                      promptId: contextMenu.prompt.id,
                    });
                    setContextMenu(null);
                  }}
                />
              )}
              <PromptMenuItem
                icon={<Copy size={13} />}
                label={t("prompt_list.duplicate-as-new")}
                onClick={() => {
                  void loadDuplicateSource(contextMenu.prompt, setDuplicatePromptTarget);
                  setContextMenu(null);
                }}
              />
              <PromptMenuItem
                icon={<GitFork size={13} />}
                label={t("prompt_list.duplicate_as_variation")}
                onClick={() => {
                  void loadDuplicateSource(contextMenu.prompt, setDuplicateTarget);
                  setContextMenu(null);
                }}
              />
              <PromptMenuItem
                icon={<Download size={13} />}
                label={t("prompt_list.export")}
                onClick={() => {
                  exportPrompt.mutate(contextMenu.prompt.id);
                  setContextMenu(null);
                }}
              />
              <div className="my-1 h-px bg-line" />
              <PromptMenuItem
                icon={<Trash2 size={13} />}
                label={t("prompt_list.delete")}
                danger
                onClick={() => {
                  setDeleteTarget(contextMenu.prompt);
                  setContextMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}

      <NameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title={t("dialog.rename_prompt")}
        label={t("dialog.title")}
        initialValue={renameTarget?.title ?? ""}
        submitLabel={t("dialog.rename")}
        onSubmit={(title) => {
          if (renameTarget) rename.mutate({ promptId: renameTarget.id, title });
        }}
      />
      {moveTarget && (
        <MoveToCollectionDialog
          prompt={moveTarget}
          open
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
        />
      )}
      <DuplicateBranchDialog
        open={duplicateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateTarget(null);
        }}
        sourceLabel={duplicateTarget?.versionLabel ?? "selected version"}
        onSubmit={duplicateAsVariation}
      />
      <NameDialog
        open={duplicatePromptTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicatePromptTarget(null);
        }}
        title={t("dialog.duplicate_as_new_prompt")}
        label={t("dialog.title")}
        initialValue={`${duplicatePromptTarget?.prompt.title ?? t("dialog.prompt")} ${t("dialog.copy_suffix")}`}
        submitLabel={t("dialog.duplicate")}
        onSubmit={(title) => {
          if (duplicatePromptTarget) {
            duplicatePrompt.mutate({
              promptId: duplicatePromptTarget.prompt.id,
              versionId: duplicatePromptTarget.versionId,
              title,
            });
          }
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("run_compare.delete_prompt_confirm", { title: deleteTarget?.title ?? t("dialog.prompt") })}
        description={t("main_pane.delete_prompt_desc")}
        confirmLabel={t("main_pane.move_to_trash_confirm")}
        danger
        onConfirm={() => {
          if (deleteTarget) softDelete.mutate(deleteTarget.id);
        }}
      />
      <ConfirmDialog
        open={hardDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHardDeleteTarget(null);
        }}
        title={t("run_compare.permanently_delete_confirm", { title: hardDeleteTarget?.title ?? t("dialog.prompt") })}
        description={t("main_pane.permanently_delete_desc")}
        confirmLabel={t("main_pane.delete_permanently_confirm")}
        danger
        onConfirm={() => {
          if (hardDeleteTarget) hardDelete.mutate(hardDeleteTarget.id);
        }}
      />
    </section>
  );
}
