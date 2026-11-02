import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { t } from "../lib/i18n";
import type { PromptBlockDto } from "../../../shared/ipc.js";
import { cx } from "../lib/time";
import { ToggleSwitch } from "./ui";

/** Mirrors core BLOCK_LIMITS.maxBlocks — the two must move together. */
const MAX_BLOCKS = 50;
const inputClass =
  "w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";
const rowButtonClass =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint";

export function newBlockId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `block-${Math.random().toString(36).slice(2)}`;
}

export function newBlock(): PromptBlockDto {
  return { id: newBlockId(), description: "", content: "", isActive: true };
}

/** Core rejects whitespace-only block content — these are not persistable yet. */
export function persistableBlocks(blocks: PromptBlockDto[]): PromptBlockDto[] {
  return blocks.filter((block) => block.content.trim().length > 0);
}

/**
 * Controlled editor for a prompt's optional-block list: per-block default-state
 * toggle, description and expandable text, reorder and delete. Pure UI — the
 * parent owns the list and decides when it is persisted.
 */
export function BlocksEditor({
  blocks,
  onChange,
  disabled = false,
}: {
  blocks: PromptBlockDto[];
  onChange: (next: PromptBlockDto[]) => void;
  disabled?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const patch = (id: string, changes: Partial<PromptBlockDto>) => {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...changes } : block)));
  };
  const move = (index: number, delta: -1 | 1) => {
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved!);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => {
        const expanded = expandedId === block.id;
        const persistable = block.content.trim().length > 0;
        return (
          <div
            key={block.id}
            className={cx(
              "rounded-md border bg-raised px-2 py-1.5",
              persistable ? "border-line" : "border-dashed border-danger/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <ToggleSwitch
                checked={block.isActive}
                onChange={(checked) => patch(block.id, { isActive: checked })}
                label={t("blocks.toggle_aria", { index: index + 1 })}
                disabled={disabled}
              />
              <input
                value={block.description}
                onChange={(e) => patch(block.id, { description: e.target.value })}
                placeholder={t("blocks.description_placeholder")}
                maxLength={200}
                disabled={disabled}
                aria-label={t("blocks.description_aria", { index: index + 1 })}
                className={cx(inputClass, "min-w-0 flex-1")}
              />
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : block.id)}
                aria-expanded={expanded}
                aria-label={t("blocks.expand_aria", { index: index + 1 })}
                title={t("blocks.expand_aria", { index: index + 1 })}
                disabled={disabled}
                className={rowButtonClass}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <button
                type="button"
                onClick={() => move(index, -1)}
                aria-label={t("blocks.move_up_aria", { index: index + 1 })}
                title={t("blocks.move_up_aria", { index: index + 1 })}
                disabled={disabled || index === 0}
                className={rowButtonClass}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                aria-label={t("blocks.move_down_aria", { index: index + 1 })}
                title={t("blocks.move_down_aria", { index: index + 1 })}
                disabled={disabled || index === blocks.length - 1}
                className={rowButtonClass}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                onClick={() => onChange(blocks.filter((b) => b.id !== block.id))}
                aria-label={t("blocks.delete_aria", { index: index + 1 })}
                title={t("blocks.delete_aria", { index: index + 1 })}
                disabled={disabled}
                className={cx(rowButtonClass, "hover:text-danger")}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {expanded && (
              <div className="mt-1.5 space-y-1">
                <textarea
                  value={block.content}
                  onChange={(e) => patch(block.id, { content: e.target.value })}
                  placeholder={t("blocks.content_placeholder")}
                  maxLength={50_000}
                  rows={4}
                  disabled={disabled}
                  aria-label={t("blocks.content_aria", { index: index + 1 })}
                  className={cx(inputClass, "resize-y font-mono leading-relaxed")}
                />
                <span className="block text-right text-[10px] tabular-nums text-ink-faint">
                  {t("blocks.char_count", { count: block.content.length })}
                </span>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const block = newBlock();
          onChange([...blocks, block]);
          setExpandedId(block.id);
        }}
        disabled={disabled || blocks.length >= MAX_BLOCKS}
        className="flex items-center gap-1 rounded-md border border-dashed border-line-strong px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} />
        {t("blocks.add")}
      </button>
    </div>
  );
}
