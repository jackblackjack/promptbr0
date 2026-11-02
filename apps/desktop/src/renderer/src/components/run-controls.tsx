import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Loader2, Play, X } from "lucide-react";
import { extractVariableNames, type ModelRef } from "../lib/ai-prefs";
import { assemblePromptContent } from "../lib/blocks";
import { t, tCount } from "../lib/i18n";
import { cx } from "../lib/time";
import { useToast } from "../lib/toast";
import { ConfirmDialog } from "./dialogs";
import { ModelPicker } from "./model-picker";
import { ToggleSwitch } from "./ui";
import type { PromptBlockDto } from "../../../shared/ipc.js";

/**
 * The unified run window (title stays "Generated prompt"): shows the full
 * prompt — base content with active optional blocks appended — as editable
 * text, with per-use block toggles, the model picker and the Run action.
 * Edits are ephemeral: the text goes to ai:run as typed (unfilled {{vars}}
 * travel as-is), and closing with edits asks for confirmation.
 */
export function RunWindow({
  open,
  onOpenChange,
  baseContent,
  blocks,
  selection,
  onSelectionChange,
  recents,
  running,
  runLabel,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw content (live draft or saved version) the window assembles from. */
  baseContent: string;
  blocks: PromptBlockDto[];
  selection: ModelRef[];
  onSelectionChange: (next: ModelRef[]) => void;
  recents: ModelRef[];
  /** A run is in flight (window would have been closed to get here). */
  running: boolean;
  runLabel: string;
  onRun: (content: string) => void;
}) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [text, setText] = useState(baseContent);
  // Pending toggle over dirty text — applied only after the rebuild confirm.
  const [rebuildAsk, setRebuildAsk] = useState<{ id: string; next: boolean } | null>(null);
  const [closeAsk, setCloseAsk] = useState(false);
  // Capture-once: the window works on the content as of open time; a focus
  // refetch or background sync while the window is up must not yank the text
  // (or the block defaults) mid-decision.
  const [snapshot, setSnapshot] = useState({ base: baseContent, blocks });

  useEffect(() => {
    if (!open) return;
    setSnapshot({ base: baseContent, blocks });
    setOverrides({});
    setText(assemblePromptContent(baseContent, blocks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assembled = useMemo(
    () => assemblePromptContent(snapshot.base, snapshot.blocks, overrides),
    [snapshot, overrides],
  );
  // Any re-assembly (confirmed toggle) replaces the text; manual edits never
  // change behind the user's back because `text` is the single source.
  useEffect(() => {
    setText(assembled);
  }, [assembled]);
  const dirty = text !== assembled;

  const toggleBlock = (id: string, next: boolean) => {
    if (text !== assembled) {
      setRebuildAsk({ id, next });
      return;
    }
    setOverrides((current) => ({ ...current, [id]: next }));
  };

  const requestClose = () => {
    if (dirty) {
      setCloseAsk(true);
      return;
    }
    onOpenChange(false);
  };

  const copy = () => {
    navigator.clipboard.writeText(text);
    toast(t("run_controls.copied"), "success");
  };

  const run = () => {
    if (selection.length === 0) return;
    onRun(text);
    // Progress and results live in the compare view, not here.
    onOpenChange(false);
  };

  const unfilledCount = extractVariableNames(text).length;

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="pb-overlay fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="pb-dialog fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[75vw] flex-col -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50 focus:outline-none"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <Dialog.Title className="text-sm font-semibold text-ink">
                {t("run_controls.generated_prompt")}
              </Dialog.Title>
              <button
                type="button"
                onClick={requestClose}
                aria-label={t("dialog.close")}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>
            {blocks.length > 0 && (
              <div
                role="group"
                aria-label={t("quick_palette.blocks-group")}
                className="flex flex-wrap items-center gap-1.5 px-5 pb-2"
              >
                {blocks.map((block) => {
                  const label = block.description || t("quick_palette.unnamed-block");
                  return (
                    <span
                      key={block.id}
                      className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pl-2 pr-2.5 text-[11px] text-ink-dim"
                    >
                      <ToggleSwitch
                        checked={overrides[block.id] ?? block.isActive}
                        onChange={(next) => toggleBlock(block.id, next)}
                        label={t("run_window.block_toggle_aria", { name: label })}
                      />
                      <span className="min-w-0 max-w-48 truncate" title={label}>
                        {label}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
            {/* 75vw × 80vh = 60% of the window area; flex-1 lets the textarea
                fill the dialog under the toggles and footer. */}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              className="mx-5 mb-2 min-h-[8rem] w-[calc(100%-2.5rem)] flex-1 resize-none overflow-y-auto rounded-md border border-line bg-app px-2.5 py-1.5 font-mono text-[13px] leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {unfilledCount > 0 && (
              <p className="px-5 pb-2 text-[11px] text-ink-faint">
                {tCount(unfilledCount, {
                  one: "run_window.unfilled_vars_one",
                  few: "run_window.unfilled_vars_few",
                  many: "run_window.unfilled_vars_many",
                })}
              </p>
            )}
            <div className="flex items-center gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
              >
                {t("dialog.close")}
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                >
                  <Copy size={13} />
                  {t("run_controls.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    copy();
                    onOpenChange(false);
                  }}
                  className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                >
                  {t("run_controls.copy_close")}
                </button>
                <ModelPicker
                  multi
                  selection={selection}
                  onChange={onSelectionChange}
                  recents={recents}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  disabled={running}
                />
                <button
                  type="button"
                  onClick={run}
                  disabled={running || selection.length === 0}
                  title={t("main_pane.run_with_models")}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {running ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                  <span>{runLabel}</span>
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={rebuildAsk !== null}
        onOpenChange={(next) => {
          if (!next) setRebuildAsk(null);
        }}
        title={t("run_window.rebuild_confirm_title")}
        description={t("run_window.rebuild_confirm_desc")}
        confirmLabel={t("run_window.rebuild_confirm")}
        onConfirm={() => {
          if (rebuildAsk) {
            const { id, next } = rebuildAsk;
            setOverrides((current) => ({ ...current, [id]: next }));
          }
          setRebuildAsk(null);
        }}
      />
      <ConfirmDialog
        open={closeAsk}
        onOpenChange={setCloseAsk}
        title={t("run_window.close_confirm_title")}
        description={t("run_window.close_confirm_desc")}
        confirmLabel={t("run_window.close_confirm")}
        onConfirm={() => {
          setCloseAsk(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
