import { useCallback, useEffect, useState } from "react";
import type { CollectionMoveInput } from "../../../shared/ipc.js";
import {
  BookOpen,
  Clock,
  Folder,
  HardDrive,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import iconUrl from "../assets/icon.png";
import { useAppMutation, useAppInfo, useCollectionTree, useSuggestions, useTags } from "../hooks/use-data";
import { t } from "../lib/i18n";
import { cx } from "../lib/time";
import { useAppState, type AppView } from "../state/app-state";
import { colorForName, SectionLabel } from "./ui";
import { CollectionTree } from "./CollectionTree";
import { ConfirmDialog, CreateCollectionDialog, NameDialog, RenameCollectionDialog } from "./dialogs";
import { SyncStatusRow } from "./SyncStatusRow";

const COLLAPSED_FOLDERS_KEY = "pb:collapsedFolders";

const TAG_PREVIEW_COUNT = 8;

function NavItem({
  view,
  label,
  icon,
  badge,
  collapsed,
}: {
  view: AppView;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  collapsed?: boolean;
}) {
  const { view: current, setView, selectPrompt } = useAppState();
  const active = current.kind === view.kind;

  if (collapsed) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => {
          setView(view);
          selectPrompt(null);
        }}
        className={cx(
          "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          active ? "bg-accent-soft text-accent" : "text-ink-dim hover:bg-hover hover:text-ink",
        )}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-semibold tabular-nums text-white">
            {badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setView(view);
        selectPrompt(null);
      }}
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
        active ? "bg-accent-soft font-medium text-accent" : "text-ink-dim hover:bg-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold tabular-nums text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

export function LeftRail({
  collapsed = false,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { view, setView, selectPrompt, openSettings, openNewPrompt, filterByTag, filters, setFilters } = useAppState();
  const { data: tags } = useTags();
  const { data: tree } = useCollectionTree();
  const { data: appInfo } = useAppInfo();
  const { data: suggestions } = useSuggestions();
  const [showAllTags, setShowAllTags] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; parentId: string | null } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [collectionMenu, setCollectionMenu] = useState<{
    collection: { id: string; name: string; parentId: string | null };
    x: number;
    y: number;
  } | null>(null);
  const [tagMenu, setTagMenu] = useState<{ tag: { id: string; name: string }; x: number; y: number } | null>(null);
  const [deleteTagTarget, setDeleteTagTarget] = useState<{ id: string; name: string } | null>(null);
  /** Which collection triggered "New subcollection". */
  const [createTargetParent, setCreateTargetParent] = useState<string | null>(null);
  // Expanded folder ids, persisted in localStorage.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
      if (!raw) return new Set<string>();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set<string>();
    }
  });

  // Persist expanded folders on change.
  useEffect(() => {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandFolder = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleCollectionContextMenu = useCallback(
    (id: string, name: string, parentId: string | null, x: number, y: number) => {
      setCollectionMenu({ collection: { id, name, parentId }, x, y });
    },
    [],
  );

  useEffect(() => {
    if (!collectionMenu) return;
    const close = () => setCollectionMenu(null);
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
  }, [collectionMenu]);

  useEffect(() => {
    if (!tagMenu) return;
    const close = () => setTagMenu(null);
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
  }, [tagMenu]);

  const createTag = useAppMutation((name: string) => window.promptbr0.tags.create({ name, color: colorForName(name) }), {
    toast: (tag) => t("left_rail.tag_created", { name: tag.name }),
  });
  const deleteTag = useAppMutation(
    (input: { id: string; name: string }) => window.promptbr0.tags.delete({ id: input.id }),
    {
      // The name travels in the mutation input: the target state is cleared
      // on confirm, before the success toast fires.
      toast: (_result, input) => t("left_rail.tag_deleted", { name: input.name }),
      onSuccess: (_result, input) => {
        // A deleted tag cannot keep filtering the library view.
        if (filters.tagIds.includes(input.id)) {
          setFilters({ ...filters, tagIds: filters.tagIds.filter((id) => id !== input.id) });
        }
      },
    },
  );
  const createCollection = useAppMutation(
    (input: { name: string; parentCollectionId: string | null }) =>
      window.promptbr0.collections.create(input),
    {
      toast: (c) => t("left_rail.collection_created", { name: c.name }),
    },
  );
  const renameCollection = useAppMutation(
    (input: { id: string; patch: { name?: string; parentCollectionId?: string | null } }) =>
      window.promptbr0.collections.update(input),
    {
      toast: () => t("left_rail.collection_renamed"),
      invalidate: true,
    },
  );
  const deleteCollection = useAppMutation(
    (id: string) => window.promptbr0.collections.delete(id),
    {
      toast: () => t("left_rail.collection_deleted"),
      invalidate: true,
    },
  );
  // Drag-and-drop is its own affordance: no success toast, but failures still
  // surface through the shared mutation error path.
  const moveCollection = useAppMutation(
    (input: CollectionMoveInput) => window.promptbr0.collections.move(input),
    { quiet: true, invalidate: true },
  );

  const visibleTags = showAllTags ? (tags ?? []) : (tags ?? []).slice(0, TAG_PREVIEW_COUNT);

  // Slim icon-only strip shown when the rail panel is collapsed, so nav
  // stays reachable.
  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center bg-panel py-2">
        <img src={iconUrl} alt={t("left_rail.app_name")} className="h-6 w-6 rounded-md" />
        <nav className="mt-3 flex flex-col items-center space-y-0.5">
          <NavItem collapsed view={{ kind: "library" }} label={t("left_rail.library")} icon={<BookOpen size={15} />} />
          <NavItem collapsed view={{ kind: "history" }} label={t("left_rail.history")} icon={<Clock size={15} />} />
          <NavItem collapsed view={{ kind: "starred" }} label={t("left_rail.starred")} icon={<Star size={15} />} />

          <NavItem
            collapsed
            view={{ kind: "suggestions" }}
            label={t("left_rail.suggestions")}
            icon={<Inbox size={15} />}
            badge={suggestions?.length}
          />
          <NavItem collapsed view={{ kind: "trash" }} label={t("left_rail.trash")} icon={<Trash2 size={15} />} />
        </nav>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={t("left_rail.expand_sidebar")}
          aria-label={t("left_rail.expand_sidebar")}
          className="mt-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelLeftOpen size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <img src={iconUrl} alt={t("left_rail.app_name")} className="h-6 w-6 shrink-0 rounded-md" />
        <span className="text-[13px] font-semibold tracking-tight text-ink">{t("left_rail.app_name")}</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={t("left_rail.collapse_sidebar")}
          aria-label={t("left_rail.collapse_sidebar")}
          className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelLeftClose size={13} />
        </button>
      </div>

      <nav className="space-y-0.5 px-2 pt-1">
        <NavItem view={{ kind: "library" }} label={t("left_rail.library")} icon={<BookOpen size={15} />} />
        <NavItem view={{ kind: "history" }} label={t("left_rail.history")} icon={<Clock size={15} />} />
        <NavItem view={{ kind: "starred" }} label={t("left_rail.starred")} icon={<Star size={15} />} />
        <NavItem
          view={{ kind: "suggestions" }}
          label={t("left_rail.suggestions")}
          icon={<Inbox size={15} />}
          badge={suggestions?.length}
        />
        <NavItem view={{ kind: "trash" }} label={t("left_rail.trash")} icon={<Trash2 size={15} />} />
      </nav>

      <div className="mt-5 px-2">
        <div className="flex items-center justify-between pr-1">
          <div title={t("left_rail.collections_hint")}>
            <SectionLabel>{t("left_rail.collections")}</SectionLabel>
          </div>
          <button
            type="button"
            onClick={() => setCollectionDialogOpen(true)}
            className="mb-1 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
            aria-label={t("left_rail.new_collection")}
          >
            <Plus size={13} />
          </button>
        </div>
        {tree && tree.children.length > 0 ? (
          <CollectionTree
            tree={tree}
            expandedIds={expandedFolders}
            activeId={view.kind === "collection" ? (view.collectionId ?? null) : null}
            onSelect={(node) => {
              setView({ kind: "collection", collectionId: node.id, collectionName: node.name });
              selectPrompt(null);
            }}
            onToggle={toggleFolder}
            onExpand={expandFolder}
            onContextMenu={(node, x, y) => {
              handleCollectionContextMenu(node.id, node.name, node.parentId, x, y);
            }}
            onMove={(input) => moveCollection.mutate(input)}
          />
        ) : (
          <p className="px-2 py-1 text-[11px] text-ink-faint">{t("left_rail.no_collections")}</p>
        )}
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex items-center justify-between pr-1">
          <SectionLabel>{t("left_rail.tags")}</SectionLabel>
          <button
            type="button"
            onClick={() => setTagDialogOpen(true)}
            className="mb-1 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
            aria-label={t("left_rail.new_tag")}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="space-y-0.5">
          {visibleTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={view.kind === "library" && filters.tagIds.includes(tag.id)}
              onClick={() => filterByTag(tag.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setTagMenu({ tag: { id: tag.id, name: tag.name }, x: event.clientX, y: event.clientY });
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors",
                view.kind === "library" && filters.tagIds.includes(tag.id)
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-ink-dim hover:bg-hover hover:text-ink",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color ?? colorForName(tag.name) }}
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="text-[11px] tabular-nums text-ink-faint">{tag.usageCount}</span>
            </button>
          ))}
          {(tags ?? []).length > TAG_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setShowAllTags((v) => !v)}
              className="px-2 py-1 text-[11px] text-accent hover:underline"
            >
              {showAllTags ? t("left_rail.show_less") : t("left_rail.show_more", { count: (tags ?? []).length - TAG_PREVIEW_COUNT })}
            </button>
          )}
          {(tags ?? []).length === 0 && <p className="px-2 py-1 text-[11px] text-ink-faint">{t("left_rail.no_tags")}</p>}
        </div>
      </div>

      <div className="mt-auto border-t border-line px-2 py-2 space-y-0.5">
        <SyncStatusRow />
        <div className="flex items-center gap-2 rounded-md px-2 py-1">
          <HardDrive size={13} className="shrink-0 text-ink-faint" />
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-ink-dim">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
            <span className="truncate">{t("left_rail.local_db")}</span>
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-faint">
            v{appInfo?.version ?? "…"}
          </span>
          <button
            type="button"
            onClick={() => openSettings()}
            className="-mr-1 rounded p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label={t("common.settings")}
            title={t("settings.title")}
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      <NameDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        title={t("left_rail.new_tag")}
        label={t("dialog.name")}
        placeholder={t("left_rail.new_tag_placeholder")}
        submitLabel={t("left_rail.create_tag")}
        onSubmit={(name) => createTag.mutate(name)}
      />
      <CreateCollectionDialog
        open={collectionDialogOpen}
        onOpenChange={(open) => {
          if (!open) setCreateTargetParent(null);
          setCollectionDialogOpen(open);
        }}
        allCollections={tree ?? null}
        defaultParentId={createTargetParent}
        onSubmit={(input) => createCollection.mutate(input)}
      />
      <RenameCollectionDialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRenameDialogOpen(false);
            setRenameTarget(null);
          }
        }}
        collection={renameTarget}
        allCollections={tree ?? null}
        onSubmit={(input) => {
          renameCollection.mutate(input);
          setRenameDialogOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialogOpen(false);
            setDeleteTarget(null);
          }
        }}
        title={t("left_rail.delete_collection")}
        description={t("left_rail.delete_collection_desc", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("dialog.delete")}
        danger
        onConfirm={() => {
          if (deleteTarget) {
            deleteCollection.mutate(deleteTarget.id);
          }
          setDeleteDialogOpen(false);
          setDeleteTarget(null);
        }}
      />
      {collectionMenu && (
        <div
          role="menu"
          aria-label={t("left_rail.actions_for", { name: collectionMenu.collection.name })}
          onPointerDown={(event) => event.stopPropagation()}
          className="pb-menu fixed z-50 w-44 rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
          style={{
            left: Math.max(8, Math.min(collectionMenu.x, window.innerWidth - 176)),
            top: Math.max(8, Math.min(collectionMenu.y, window.innerHeight - 112)),
          }}
        >
          <button
            autoFocus
            type="button"
            role="menuitem"
            onClick={() => {
              openNewPrompt(collectionMenu.collection);
              setCollectionMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-dim outline-none hover:bg-hover hover:text-ink focus:bg-hover focus:text-ink"
          >
            <Plus size={13} />
            {t("main_pane.new_prompt")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameTarget({
                id: collectionMenu.collection.id,
                name: collectionMenu.collection.name,
                parentId: collectionMenu.collection.parentId,
              });
              setRenameDialogOpen(true);
              setCollectionMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-dim outline-none hover:bg-hover hover:text-ink focus:bg-hover focus:text-ink"
          >
            <Pencil size={13} />
            {t("left_rail.rename")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCreateTargetParent(collectionMenu.collection.id);
              setCollectionDialogOpen(true);
              setCollectionMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-dim outline-none hover:bg-hover hover:text-ink focus:bg-hover focus:text-ink"
          >
            <Folder size={13} />
            {t("left_rail.new_subcollection")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDeleteTarget({
                id: collectionMenu.collection.id,
                name: collectionMenu.collection.name,
              });
              setDeleteDialogOpen(true);
              setCollectionMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-red-500 outline-none hover:bg-hover hover:text-red-400 focus:bg-hover focus:text-red-400"
          >
            <Trash2 size={13} />
            {t("dialog.delete")}
          </button>
        </div>
      )}
      {tagMenu && (
        <div
          role="menu"
          aria-label={t("left_rail.actions_for", { name: tagMenu.tag.name })}
          onPointerDown={(event) => event.stopPropagation()}
          className="pb-menu fixed z-50 w-44 rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
          style={{
            left: Math.max(8, Math.min(tagMenu.x, window.innerWidth - 176)),
            top: Math.max(8, Math.min(tagMenu.y, window.innerHeight - 56)),
          }}
        >
          <button
            autoFocus
            type="button"
            role="menuitem"
            onClick={() => {
              setDeleteTagTarget(tagMenu.tag);
              setTagMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-red-500 outline-none hover:bg-hover hover:text-red-400 focus:bg-hover focus:text-red-400"
          >
            <Trash2 size={13} />
            {t("left_rail.delete_tag")}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={deleteTagTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTagTarget(null);
        }}
        title={t("left_rail.delete_tag")}
        description={t("left_rail.delete_tag_desc", { name: deleteTagTarget?.name ?? "" })}
        confirmLabel={t("dialog.delete")}
        danger
        onConfirm={() => {
          if (deleteTagTarget) {
            deleteTag.mutate({ id: deleteTagTarget.id, name: deleteTagTarget.name });
          }
          setDeleteTagTarget(null);
        }}
      />
    </aside>
  );
}
