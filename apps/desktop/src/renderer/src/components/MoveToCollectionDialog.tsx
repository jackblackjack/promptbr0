import { t } from "../lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { CollectionTreeDto, PromptDetail } from "../../../shared/ipc.js";
import { useAppMutation, useCollectionTree } from "../hooks/use-data";
import { cx } from "../lib/time";
import { DialogShell } from "./dialogs";

export function MoveToCollectionDialog({
  prompt,
  open,
  onOpenChange,
}: {
  prompt: PromptDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: tree } = useCollectionTree();
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>(prompt.collectionIds);
  // Inverted expansion: a folder is collapsed only when listed here, so the
  // whole hierarchy is visible the moment the dialog opens. The component
  // stays mounted between opens, so the choice persists across uses.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const wasOpen = useRef(false);
  const previousPromptId = useRef(prompt.id);
  const updateMemberships = useAppMutation(
    async ({ add, remove }: { add: string[]; remove: string[] }) => {
      await Promise.all([
        ...add.map((collectionId) =>
          window.promptbr0.collections.addPrompt(collectionId, prompt.id),
        ),
        ...remove.map((collectionId) =>
          window.promptbr0.collections.removePrompt(collectionId, prompt.id),
        ),
      ]);
    },
    { quiet: true },
  );

  useEffect(() => {
    if (open && (!wasOpen.current || previousPromptId.current !== prompt.id)) {
      setSelectedCollectionIds(prompt.collectionIds);
    }
    wasOpen.current = open;
    previousPromptId.current = prompt.id;
  }, [open, prompt.id, prompt.collectionIds]);

  const toggleNode = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMember = (id: string, checked: boolean) => {
    setSelectedCollectionIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((member) => member !== id);
    });
  };

  const save = async () => {
    const current = new Set(prompt.collectionIds);
    const selected = new Set(selectedCollectionIds);
    const add = selectedCollectionIds.filter((id) => !current.has(id));
    const remove = prompt.collectionIds.filter((id) => !selected.has(id));

    if (add.length === 0 && remove.length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await updateMemberships.mutateAsync({ add, remove });
      onOpenChange(false);
    } catch {
      // Keep the draft open so the user can retry after the mutation error toast.
    }
  };

  const renderNode = (node: CollectionTreeDto, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = !collapsed.has(node.id);
    const member = selectedCollectionIds.includes(node.id);
    const indentPx = depth * 12;

    return (
      <div key={node.id}>
        <div className="relative flex items-center rounded-md hover:bg-hover">
          {/* The label owns the checkbox and the name; the chevron stays a
              sibling — interactive elements cannot be nested (same layout as
              CollectionTree). */}
          <label
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-2 pr-1 text-[13px] text-ink-dim"
            style={{ marginLeft: `${indentPx}px` }}
          >
            <input
              type="checkbox"
              aria-label={node.name}
              checked={member}
              disabled={updateMemberships.isPending}
              onChange={(event) => toggleMember(node.id, event.currentTarget.checked)}
              className="accent-accent"
            />
            <span className="min-w-0 truncate">{node.name}</span>
            <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
              {node.promptCount}
            </span>
          </label>
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
              aria-label={isExpanded ? t("left_rail.collapse_folder") : t("left_rail.expand_folder")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
            >
              <ChevronRight size={12} className={isExpanded ? "rotate-90" : ""} />
            </button>
          )}
        </div>
        {hasChildren && isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const roots = tree?.children ?? [];

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("move_to.collection")}
      // Auto-sized to its content, but the user can drag the bottom edge to
      // stretch it up to 60% of the window height; beyond that the tree
      // scrolls inside while the header and footer stay put.
      size="flex max-h-[60vh] w-[min(24rem,calc(100vw-2rem))] resize-y flex-col overflow-auto"
    >
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {roots.length === 0 && (
          <p className="text-[12px] text-ink-faint">
            {t("prompt_list.no_collections")}
          </p>
        )}
        {roots.map((node) => renderNode(node, 0))}
      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={updateMemberships.isPending}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("dialog.save")}
        </button>
      </div>
    </DialogShell>
  );
}
