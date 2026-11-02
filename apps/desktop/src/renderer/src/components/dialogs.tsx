import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2, Sparkles, X } from "lucide-react";
import { t } from "../lib/i18n";
import type {
  CollectionDto,
  CollectionImportApplyInput,
  CollectionImportApplyStrategy,
  CollectionImportPreviewDto,
  CollectionTreeDto,
  PromptBlockDto,
  RatingAddInput,
  TagDto,
} from "../../../shared/ipc.js";
import { useAppMutation } from "../hooks/use-data";
import type { ModelRef } from "../lib/ai-prefs";
import { userErrorMessage } from "../lib/errors";
import { cx } from "../lib/time";
import { useToast } from "../lib/toast";
import { useAppState } from "../state/app-state";
import { BlocksEditor, persistableBlocks } from "./BlocksEditor";
import { ModelPicker, useAvailableModels } from "./model-picker";
import { colorForName, StarRatingInput } from "./ui";

export function DialogShell({
  open,
  onOpenChange,
  title,
  children,
  width = "max-w-md",
  size,
  onPointerDownOutside,
  onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  width?: string;
  /** Replaces the default sizing block (width/height/display) entirely, e.g.
      "flex h-[80vh] w-[75vw]" — an appended w-* class could not reliably override
      the base w-[calc(100vw-2rem)] because cx is a plain join, not tailwind-merge. */
  size?: string;
  /** Optional guards for outside clicks / Escape; call event.preventDefault()
      to keep the dialog open. Used to confirm discards of unsaved input. */
  onPointerDownOutside?: (event: Event) => void;
  onEscapeKeyDown?: (event: Event) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pb-overlay fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          onPointerDownOutside={onPointerDownOutside}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cx(
            "pb-dialog fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            size ?? cx("max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto", width),
            "rounded-xl border border-line-strong bg-panel p-5 shadow-2xl shadow-black/50 focus:outline-none",
          )}
        >
          <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
            <Dialog.Title className="min-w-0 break-words text-sm font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={t("dialog.close")}
              className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";

const primaryButtonClass =
  "rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40";

const ghostButtonClass =
  "rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink";

/** Single-text-input dialog used for "new tag", "new collection", "rename". */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = "",
  placeholder,
  submitLabel = t("dialog.save"),
  allowEmpty = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed && !allowEmpty) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!allowEmpty && !value.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Destructive/confirming action dialog. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* z-60/70: must sit above the compare view (z-40/50) it opens from. */}
        <AlertDialog.Overlay className="pb-overlay fixed inset-0 z-[60] bg-black/60" />
        <AlertDialog.Content className="pb-dialog fixed left-1/2 top-1/2 z-[70] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line-strong bg-panel p-5 shadow-2xl shadow-black/50 focus:outline-none">
          <AlertDialog.Title className="break-words text-sm font-semibold text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-ink-dim">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel className={ghostButtonClass}>{t("dialog.cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className={cx(
                "rounded-md px-3 py-1.5 text-[13px] font-medium text-white transition-colors",
                danger ? "bg-red-600 hover:bg-red-500" : "bg-accent hover:bg-accent-strong",
              )}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** "New prompt" creation dialog. */
export function NewPromptDialog({
  open,
  onOpenChange,
  allTags,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTags: TagDto[];
  onCreate: (input: { title: string; description: string; content: string; tagIds: string[]; blocks: PromptBlockDto[] }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<PromptBlockDto[]>([]);
  const { toast } = useToast();
  const { openSettings } = useAppState();
  const availableModels = useAvailableModels();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genDescription, setGenDescription] = useState("");
  const [genModel, setGenModel] = useState<ModelRef | null>(null);
  const [genPickerOpen, setGenPickerOpen] = useState(false);
  // Generated draft awaiting the overwrite confirmation (non-null = dialog open).
  const [pendingGenerated, setPendingGenerated] = useState<string | null>(null);
  // Outside-click/Escape discard confirmation (any unsaved user input present).
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setContent("");
      setTagIds([]);
      setBlocks([]);
      setGenerateOpen(false);
      setGenDescription("");
      setGenModel(availableModels[0] ?? null);
      setPendingGenerated(null);
      setConfirmDiscardOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyGenerated = (text: string) => {
    setContent(text);
    setGenerateOpen(false);
    toast(t("dialog.draft_generated"));
  };

  const generate = useAppMutation(
    () =>
      window.promptbr0.ai.assist({
        mode: "generate",
        description: genDescription.trim(),
        providerId: genModel!.providerId,
        modelId: genModel!.modelId,
      }),
    {
      quiet: true,
      onSuccess: (result) => {
        // Overwriting written content asks first — via the styled
        // ConfirmDialog (sits above this dialog: z-60/70 over z-40/50).
        if (content.trim()) {
          setPendingGenerated(result.text);
          return;
        }
        applyGenerated(result.text);
      },
    },
  );

  // Anything the user has put into the dialog that would be lost on an
  // accidental outside click, Escape, or an in-flight AI generation. Explicit
  // closes (Cancel button, ✕) bypass the guard — those are deliberate.
  const hasInput =
    title.trim() !== "" ||
    description.trim() !== "" ||
    content.trim() !== "" ||
    tagIds.length > 0 ||
    persistableBlocks(blocks).length > 0 ||
    genDescription.trim() !== "" ||
    generate.isPending;

  const guardDismiss = (event: Event) => {
    if (!hasInput) return;
    event.preventDefault();
    setConfirmDiscardOpen(true);
  };

  const openGenerate = () => {
    if (availableModels.length === 0) {
      toast(t("main_pane.no_ai_providers"), "error");
      onOpenChange(false);
      openSettings("ai");
      return;
    }
    setGenerateOpen((current) => !current);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim(), content, tagIds, blocks: persistableBlocks(blocks) });
    onOpenChange(false);
  };

  return (
    <>
    {/* 75vw × 80vh = 60% of the window area; flex-col so the content
        textarea can stretch to fill the extra height. */}
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("dialog.new_prompt")}
      size="flex h-[80vh] w-[75vw] flex-col overflow-y-auto"
      onPointerDownOutside={guardDismiss}
      onEscapeKeyDown={guardDismiss}
    >
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.title")}</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("dialog.code_review_placeholder")}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.description")}</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("main_pane.description_placeholder")}
            className={inputClass}
          />
        </label>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-dim">{t("dialog.initial_content")}</span>
            <button
              type="button"
              onClick={openGenerate}
              aria-expanded={generateOpen}
              className={cx(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                generateOpen ? "bg-accent-soft text-accent" : "text-ink-dim hover:bg-hover hover:text-ink",
              )}
            >
              <Sparkles size={11} />
              {t("dialog.generate_with_ai")}
            </button>
          </div>
          {generateOpen && (
            <div className="space-y-2 rounded-md border border-line bg-raised p-2.5">
              <textarea
                value={genDescription}
                onChange={(e) => setGenDescription(e.target.value)}
                placeholder={t("dialog.generate_placeholder")}
                rows={3}
                className={cx(inputClass, "resize-y text-[12px] leading-relaxed")}
              />
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ModelPicker
                    multi={false}
                    selection={genModel ? [genModel] : []}
                    onChange={(next) => setGenModel(next[0] ?? null)}
                    open={genPickerOpen}
                    onOpenChange={setGenPickerOpen}
                    align="start"
                    fullWidthTrigger
                  />
                </div>
                <button
                  type="button"
                  onClick={() => generate.mutate(undefined)}
                  disabled={!genDescription.trim() || genModel === null || generate.isPending}
                  className={cx(primaryButtonClass, "flex shrink-0 items-center gap-1.5 text-[12px]")}
                >
                  {generate.isPending && <Loader2 size={11} className="animate-spin" />}
                  {t("dialog.generate")}
                </button>
              </div>
            </div>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("dialog.content_placeholder")}
            rows={7}
            className={cx(inputClass, "min-h-[8rem] flex-1 font-mono text-xs leading-relaxed")}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-ink-dim">{t("blocks.title")}</span>
            <span className="text-[10px] text-ink-faint">{t("blocks.hint")}</span>
          </div>
          <BlocksEditor blocks={blocks} onChange={setBlocks} />
        </div>
        {allTags.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-dim">{t("prompt_list.tags")}</span>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const selected = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setTagIds((current) =>
                        selected ? current.filter((id) => id !== tag.id) : [...current, tag.id],
                      )
                    }
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      selected
                        ? "border-accent/60 bg-accent-soft text-ink"
                        : "border-line bg-raised text-ink-dim hover:text-ink",
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tag.color ?? colorForName(tag.name) }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!title.trim()}>
            {t("dialog.create_prompt")}
          </button>
        </div>
      </form>
    </DialogShell>
    <ConfirmDialog
      open={pendingGenerated !== null}
      onOpenChange={(next) => {
        if (!next) setPendingGenerated(null);
      }}
      title={t("dialog.replace_content")}
      description={t("dialog.replace_content_desc")}
      confirmLabel={t("dialog.replace_content_confirm")}
      onConfirm={() => {
        if (pendingGenerated !== null) applyGenerated(pendingGenerated);
        setPendingGenerated(null);
      }}
    />
    <ConfirmDialog
      open={confirmDiscardOpen}
      onOpenChange={(next) => {
        if (!next) setConfirmDiscardOpen(false);
      }}
      title={t("dialog.close_without_saving_title")}
      description={t("dialog.close_without_saving_desc")}
      confirmLabel={t("dialog.close_without_saving_confirm")}
      danger
      onConfirm={() => {
        setConfirmDiscardOpen(false);
        onOpenChange(false);
      }}
    />
    </>
  );
}

/** "Save as new version" dialog — emphasizes the change note. */
export function SaveVersionDialog({
  open,
  onOpenChange,
  nextLabel,
  onSave,
  title,
  warning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextLabel: string;
  onSave: (changeNote: string) => void;
  /** Overrides the default "save version as {{label}}" title (e.g. bake flow). */
  title?: string;
  /** Warning callout rendered above the change-note field (e.g. bake semantics). */
  warning?: ReactNode;
}) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={title ?? t("dialog.save_version_as", { label: nextLabel })}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(note.trim());
          onOpenChange(false);
        }}
        className="space-y-4"
      >
        {warning && (
          <div className="rounded-md border border-danger/20 bg-danger-soft px-2.5 py-2 text-[12px] leading-relaxed text-ink-dim">
            {warning}
          </div>
        )}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink">
            {t("dialog.what_changed")} <span className="font-normal text-ink-faint">{t("dialog.what_changed_hint")}</span>
          </span>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("dialog.what_changed_placeholder")}
            rows={4}
            className={cx(inputClass, "resize-y leading-relaxed")}
          />
          <span className="block text-[11px] leading-relaxed text-ink-faint">
            {t("dialog.change_notes")}
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t("dialog.save_version")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

const RATING_DIMENSIONS: Array<{ key: "effectiveness" | "clarity" | "completeness" | "actionability"; labelKey: string }> = [
  { key: "effectiveness", labelKey: "run_compare.effectiveness" },
  { key: "clarity", labelKey: "run_compare.clarity" },
  { key: "completeness", labelKey: "run_compare.completeness" },
  { key: "actionability", labelKey: "run_compare.actionability" },
];

export type RatingScores = Partial<
  Pick<RatingAddInput, "effectiveness" | "clarity" | "completeness" | "actionability">
>;

/** Multi-dimension 1–5 rating dialog for a prompt or a version. */
export function RateDialog({
  open,
  onOpenChange,
  title,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Rate v3" or "Rate prompt". */
  title: string;
  onSubmit: (scores: RatingScores) => void;
}) {
  const [scores, setScores] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (open) setScores({});
  }, [open]);

  const filled = Object.values(scores).filter((v) => v !== null && v !== undefined).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (filled === 0) return;
    const payload: RatingScores = {};
    for (const dim of RATING_DIMENSIONS) {
      const value = scores[dim.key];
      if (value !== null && value !== undefined) payload[dim.key] = value;
    }
    onSubmit(payload);
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2.5">
          {RATING_DIMENSIONS.map((dim) => (
            <div key={dim.key} className="flex items-center justify-between">
              <span className="text-[13px] text-ink-dim">{t(dim.labelKey)}</span>
              <StarRatingInput
                value={scores[dim.key] ?? null}
                onChange={(value) => setScores((current) => ({ ...current, [dim.key]: value }))}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t("dialog.all_dimensions_optional")}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={filled === 0}>
            {t("dialog.save_rating")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

export interface LogRunInput {
  tool: string;
  model?: string;
  outcomeRating?: number;
  resultSummary?: string;
  startedAt?: string;
}

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, in local time. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Manual run-log dialog: tool, model, outcome, summary, started-at. */
export function LogRunDialog({
  open,
  onOpenChange,
  versionLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Label of the version the run is logged against, e.g. "v3". */
  versionLabel: string;
  onSubmit: (input: LogRunInput) => void;
}) {
  const [tool, setTool] = useState("manual");
  const [model, setModel] = useState("");
  const [outcome, setOutcome] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [startedAt, setStartedAt] = useState(() => toLocalInputValue(new Date()));

  useEffect(() => {
    if (open) {
      setTool("manual");
      setModel("");
      setOutcome(null);
      setSummary("");
      setStartedAt(toLocalInputValue(new Date()));
    }
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedTool = tool.trim() || "manual";
    const parsedDate = new Date(startedAt);
    onSubmit({
      tool: trimmedTool,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(outcome !== null ? { outcomeRating: outcome } : {}),
      ...(summary.trim() ? { resultSummary: summary.trim() } : {}),
      ...(Number.isNaN(parsedDate.getTime()) ? {} : { startedAt: parsedDate.toISOString() }),
    });
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t("dialog.log_run_label", { version: versionLabel })}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-dim">{t("dialog.tool")}</span>
            <input
              autoFocus
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              placeholder={t("dialog.tool_placeholder")}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-dim">
              {t("dialog.model")} <span className="font-normal text-ink-faint">{t("dialog.optional")}</span>
            </span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("dialog.model_placeholder")}
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-dim">
            {t("dialog.outcome")} <span className="font-normal text-ink-faint">{t("dialog.optional")}</span>
          </span>
          <StarRatingInput value={outcome} onChange={setOutcome} size={18} />
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">
            {t("dialog.result_summary")} <span className="font-normal text-ink-faint">{t("dialog.optional")}</span>
          </span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("dialog.result_summary_placeholder")}
            rows={3}
            className={cx(inputClass, "resize-y leading-relaxed")}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.started_at")}</span>
          <input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass}>
            {t("dialog.log_run")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** "Duplicate as variation" dialog: names a new branch from a source version. */
export function DuplicateBranchDialog({
  open,
  onOpenChange,
  sourceLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label of the version being duplicated, e.g. "v3". */
  sourceLabel: string;
  /** Rejects with an Error whose message is shown inline (e.g. duplicate name). */
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed, description.trim());
      onOpenChange(false);
    } catch (err) {
      setError(userErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t("dialog.duplicate_as_variation", { label: sourceLabel })}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[12px] leading-relaxed text-ink-dim">
          {t("dialog.duplicate_as_variation_desc", { label: sourceLabel })}
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.variation_name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("dialog.variation_name_placeholder")}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">
            {t("dialog.description")} <span className="font-normal text-ink-faint">{t("dialog.optional")}</span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("dialog.variation_description_placeholder")}
            className={inputClass}
          />
        </label>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!name.trim() || busy}>
            {t("dialog.create_variation")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Find a node by id in the tree. */
function findNode(tree: CollectionTreeDto | null, id: string): CollectionTreeDto | null {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Recursively render indented parent options for the tree select. */
function renderParentOptions(node: CollectionTreeDto | null, depth: number): React.ReactNode[] {
  if (!node) return [];
  const options: React.ReactNode[] = [];
  const prefix = " ".repeat(depth * 2) + (depth > 0 ? "└ " : "");
  options.push(
    <option key={node.id} value={node.id}>
      {prefix}{node.name}
    </option>,
  );
  for (const child of node.children) {
    options.push(...renderParentOptions(child, depth + 1));
  }
  return options;
}

/** Render tree options excluding forbidden ids (for rename dialog). */
function renderFilteredParentOptions(
  node: CollectionTreeDto | null,
  excluded: Set<string>,
  depth = 0,
): React.ReactNode[] {
  if (!node) return [];
  const options: React.ReactNode[] = [];
  if (!excluded.has(node.id)) {
    const prefix = " ".repeat(depth * 2) + (depth > 0 ? "└ " : "");
    options.push(
      <option key={node.id} value={node.id}>
        {prefix}{node.name}
      </option>,
    );
    for (const child of node.children) {
      options.push(...renderFilteredParentOptions(child, excluded, depth + 1));
    }
  } else {
    // Still recurse into children (they may be re-parentable even if the node itself isn't).
    for (const child of node.children) {
      options.push(...renderFilteredParentOptions(child, excluded, depth));
    }
  }
  return options;
}

/** Dialog for creating a new collection with optional parent folder. */
export function CreateCollectionDialog({
  open,
  onOpenChange,
  allCollections,
  defaultParentId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allCollections: CollectionTreeDto | null;
  defaultParentId?: string | null;
  onSubmit: (input: { name: string; parentCollectionId: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [parentCollectionId, setParentCollectionId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setParentCollectionId(defaultParentId ?? null);
    }
  }, [open, defaultParentId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, parentCollectionId });
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t("dialog.new_collection")}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("dialog.collection_name_placeholder")}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.parent_folder")}</span>
          <select
            value={parentCollectionId ?? ""}
            onChange={(e) => setParentCollectionId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">{t("dialog.none_top_level")}</option>
            {allCollections?.children.map((child) => renderParentOptions(child, 0))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!name.trim()}>
            {t("dialog.create_collection")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Dialog for renaming a collection and optionally moving it to a different parent. */
export function RenameCollectionDialog({
  open,
  onOpenChange,
  collection,
  allCollections,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: { id: string; name: string; parentId: string | null } | null;
  allCollections: CollectionTreeDto | null;
  onSubmit: (input: { id: string; patch: { name?: string; parentCollectionId?: string | null } }) => void;
}) {
  const [name, setName] = useState("");
  const [parentCollectionId, setParentCollectionId] = useState<string | null>(null);

  useEffect(() => {
    if (open && collection) {
      setName(collection.name);
      setParentCollectionId(collection.parentId);
    }
  }, [open, collection]);

  // Exclude the current collection and all its descendants from parent options.
  const excludedIds = useMemo(() => {
    if (!collection) return new Set<string>();
    const descendants = new Set<string>();
    const queue = [collection.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = findNode(allCollections, current);
      if (node) {
        for (const child of node.children) {
          descendants.add(child.id);
          queue.push(child.id);
        }
      }
    }
    descendants.add(collection.id);
    return descendants;
  }, [allCollections, collection]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!collection) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      id: collection.id,
      patch: { name: trimmed, parentCollectionId },
    });
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t("dialog.rename_collection")}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("dialog.new_name")}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">{t("dialog.parent_folder")}</span>
          <select
            value={parentCollectionId ?? ""}
            onChange={(e) => setParentCollectionId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">{t("dialog.none_top_level")}</option>
            {allCollections?.children.map((child) =>
              renderFilteredParentOptions(child, excludedIds, 0),
            )}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" className={primaryButtonClass} disabled={!name.trim()}>
            {t("dialog.rename")}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Bound on unmatched titles actually mounted in the DOM (see the list below). */
const MAX_RENDERED_UNMATCHED = 200;

/**
 * Preview-and-confirm surface for a `.pbrcol` import: what the file contains,
 * which members matched, and — when a top-level name collision exists — the
 * skip/overwrite/duplicate strategy decision. Nothing is written until Apply.
 */
export function CollectionImportDialog({
  open,
  preview,
  pending,
  onApply,
  onOpenChange,
}: {
  open: boolean;
  preview: CollectionImportPreviewDto | null;
  pending: boolean;
  onApply: (input: CollectionImportApplyInput) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [strategy, setStrategy] = useState<CollectionImportApplyStrategy>("overwrite");
  const rootName = preview?.rootName ?? "";
  // Each new preview starts from the recommended default, even for the same file.
  useEffect(() => {
    if (open) setStrategy("overwrite");
  }, [open, rootName]);

  if (!preview) return null;
  const collision = preview.rootCollision;
  const strategies: CollectionImportApplyStrategy[] = ["overwrite", "duplicate", "skip"];

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={t("collection_import.title")}>
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-dim">
          {collision
            ? t("collection_import.collision_warning", { name: preview.rootName })
            : t("collection_import.will_add", { name: preview.rootName })}
        </p>

        <div className="space-y-1 rounded-md border border-line bg-app p-2.5 text-[12px] text-ink-dim">
          <div>{t("collection_import.subcollections", { count: preview.subcollectionCount, s: preview.subcollectionCount === 1 ? "" : "s" })}</div>
          <div>{t("collection_import.members", { count: preview.memberCount, s: preview.memberCount === 1 ? "" : "s" })}</div>
          <div>{t("collection_import.matched", { id: preview.matchedById, title: preview.matchedByTitle })}</div>
        </div>

        {preview.unmatchedTitles.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-ink-dim">
              {t("collection_import.unmatched", { count: preview.unmatchedTitles.length, s: preview.unmatchedTitles.length === 1 ? "" : "s" })}
            </div>
            {/* The count above is authoritative; the DOM is not — a hostile
                file can carry hundreds of thousands of members, and mounting
                one <li> per title would freeze the renderer on preview. */}
            <ul className="max-h-24 space-y-0.5 overflow-y-auto rounded-md border border-line bg-app p-2 text-[12px] text-ink-faint">
              {preview.unmatchedTitles.slice(0, MAX_RENDERED_UNMATCHED).map((title, index) => (
                <li key={`${index}:${title}`} className="truncate" title={title}>
                  {title}
                </li>
              ))}
            </ul>
            {preview.unmatchedTitles.length > MAX_RENDERED_UNMATCHED && (
              <div className="text-[11px] text-ink-faint">
                {t("collection_import.unmatched_more", { count: preview.unmatchedTitles.length - MAX_RENDERED_UNMATCHED })}
              </div>
            )}
          </div>
        )}

        {collision && (
          <div role="radiogroup" aria-label={t("collection_import.strategy_label")} className="space-y-1.5">
            {strategies.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={strategy === value}
                onClick={() => setStrategy(value)}
                className={cx(
                  "block w-full rounded-md border p-2.5 text-left text-[12px] transition-colors",
                  strategy === value ? "border-accent/50 bg-accent-soft" : "border-line hover:bg-hover",
                )}
              >
                <span className={cx("font-medium", strategy === value ? "text-accent" : "text-ink")}>
                  {t(`collection_import.strategy_${value}`)}
                  {value === "overwrite" && <span className="ml-1.5 font-normal text-ink-faint">{t("collection_import.recommended")}</span>}
                </span>
                <span className="mt-0.5 block text-ink-faint">{t(`collection_import.strategy_${value}_hint`)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              onApply({
                path: preview.path,
                // Without a collision every strategy degrades to a plain add;
                // "skip" simply carries no destructive intent.
                strategy: collision ? strategy : "skip",
                expectedRootCollision: collision,
              })
            }
            className={primaryButtonClass}
          >
            {t("collection_import.apply")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
