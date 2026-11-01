import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Folder } from "lucide-react";
import type { CollectionMoveInput, CollectionTreeDto } from "../../../shared/ipc.js";
import {
  AUTO_EXPAND_DELAY_MS,
  planCollectionDrop,
  type CollectionDropPosition,
} from "../lib/collection-dnd";
import { t } from "../lib/i18n";
import { cx } from "../lib/time";
import { colorForName } from "./ui";

interface DragState {
  id: string;
  overId: string | null;
  position: CollectionDropPosition | null;
}

export interface CollectionTreeProps {
  tree: CollectionTreeDto;
  expandedIds: ReadonlySet<string>;
  activeId: string | null;
  onSelect(node: CollectionTreeDto): void;
  onToggle(id: string): void;
  onExpand(id: string): void;
  onContextMenu(node: CollectionTreeDto, x: number, y: number): void;
  onMove(input: CollectionMoveInput): void;
}

/**
 * Recursive collection list with drag-and-drop:
 *
 * - the top and bottom bands of a row insert before/after it, which reorders
 *   siblings (or moves the collection into another parent at that position);
 * - the middle band, where the name sits, nests the collection into the
 *   hovered folder;
 * - hovering a collapsed folder for `AUTO_EXPAND_DELAY_MS` opens it so the
 *   drag can continue inside.
 *
 * The drop plan is always computed from the full tree rather than the row's
 * DOM position, and the core re-validates the same move.
 */
export function CollectionTree({
  tree,
  expandedIds,
  activeId,
  onSelect,
  onToggle,
  onExpand,
  onContextMenu,
  onMove,
}: CollectionTreeProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const expandTimer = useRef<number | null>(null);
  const expandTarget = useRef<string | null>(null);

  const cancelExpand = () => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandTarget.current = null;
  };

  const scheduleExpand = (id: string) => {
    if (expandTarget.current === id) return;
    cancelExpand();
    expandTarget.current = id;
    expandTimer.current = window.setTimeout(() => {
      expandTarget.current = null;
      expandTimer.current = null;
      onExpand(id);
    }, AUTO_EXPAND_DELAY_MS);
  };

  useEffect(() => cancelExpand, []);

  /**
   * Horizontal bands of the hovered row: edges reorder, the middle (where the
   * name is) nests. No modifier is needed, matching file-manager expectations.
   */
  const dropPosition = (event: DragEvent<HTMLElement>): CollectionDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    // jsdom and collapsed layouts report a zero-height rect; nesting is the
    // safe default because it never changes sibling order by accident.
    if (rect.height <= 0) return "inside";
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.3) return "before";
    if (ratio > 0.7) return "after";
    return "inside";
  };

  const handleDragStart = (node: CollectionTreeDto, event: DragEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // Some platforms refuse to start a drag without payload; the id itself
      // is tracked in React state so the payload is never read back.
      event.dataTransfer.setData("text/plain", node.name || node.id);
    }
    setDrag({ id: node.id, overId: null, position: null });
  };

  const handleDragOver = (node: CollectionTreeDto, event: DragEvent<HTMLElement>) => {
    if (!drag) return;
    const position = dropPosition(event);
    const plan = planCollectionDrop(tree, drag.id, node.id, position);

    if (!plan?.valid) {
      cancelExpand();
      if (drag.overId !== null) setDrag({ ...drag, overId: null, position: null });
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (drag.overId !== node.id || drag.position !== position) {
      setDrag({ ...drag, overId: node.id, position });
    }

    if (position === "inside" && node.children.length > 0 && !expandedIds.has(node.id)) {
      scheduleExpand(node.id);
    } else {
      cancelExpand();
    }
  };

  const handleDrop = (node: CollectionTreeDto, event: DragEvent<HTMLElement>) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const position = dropPosition(event);
    const plan = planCollectionDrop(tree, drag.id, node.id, position);
    cancelExpand();
    setDrag(null);
    if (!plan?.valid) return;

    onMove({ id: drag.id, parentCollectionId: plan.parentId, targetIndex: plan.targetIndex });
    if (position === "inside" && node.children.length > 0) onExpand(node.id);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    cancelExpand();
    setDrag((current) =>
      current ? { ...current, overId: null, position: null } : current,
    );
  };

  const handleDragEnd = () => {
    cancelExpand();
    setDrag(null);
  };

  const renderNode = (node: CollectionTreeDto, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = activeId === node.id;
    const isDragging = drag?.id === node.id;
    const isInsideTarget = drag?.overId === node.id && drag.position === "inside";
    const indentPx = depth * 12;

    return (
      <div key={node.id}>
        <div className="relative">
          <button
            type="button"
            draggable
            onClick={() => onSelect(node)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(node, event.clientX, event.clientY);
            }}
            onDragStart={(event) => handleDragStart(node, event)}
            onDragOver={(event) => handleDragOver(node, event)}
            onDrop={(event) => handleDrop(node, event)}
            onDragEnd={handleDragEnd}
            className={cx(
              "flex w-full items-center gap-1 rounded-md px-2 py-1 text-[13px] transition-colors",
              isActive
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink-dim hover:bg-hover hover:text-ink",
              isDragging && "opacity-40",
              isInsideTarget && "bg-accent-soft text-accent ring-1 ring-inset ring-accent/50",
            )}
            style={{ paddingLeft: `${8 + indentPx}px` }}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {!hasChildren && <span className="h-1 w-1 shrink-0 rounded-full bg-ink-faint/40" />}
            </span>
            <Folder size={14} style={{ color: colorForName(node.name) }} />
            <span className="min-w-0 flex-1 truncate text-left">
              {node.name || t("left_rail.library")}
            </span>
            <span className="text-[11px] tabular-nums text-ink-faint">{node.promptCount}</span>
          </button>
          {hasChildren && (
            // A sibling rather than a nested button: interactive elements
            // cannot be nested in HTML, and this keeps the row's accessible
            // name free of the chevron.
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              aria-label={isExpanded ? t("left_rail.collapse_folder") : t("left_rail.expand_folder")}
              className={cx(
                "absolute top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink",
                // While dragging, let the row underneath receive the drop even
                // when the pointer sits on the chevron.
                drag !== null && "pointer-events-none",
              )}
              style={{ left: `${8 + indentPx}px` }}
            >
              <ChevronRight size={12} className={isExpanded ? "rotate-90" : ""} />
            </button>
          )}
          {drag?.overId === node.id && drag.position === "before" && (
            <span className="pointer-events-none absolute -top-px left-1 right-1 h-0.5 rounded bg-accent" />
          )}
          {drag?.overId === node.id && drag.position === "after" && (
            <span className="pointer-events-none absolute -bottom-px left-1 right-1 h-0.5 rounded bg-accent" />
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="ml-1 border-l border-line/40 pl-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="space-y-0.5"
      onDragLeave={handleDragLeave}
      onDrop={handleDragEnd}
      data-testid="collection-tree"
    >
      {tree.children.map((node) => renderNode(node, 0))}
    </div>
  );
}
