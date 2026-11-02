import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import { useQueryClient } from "@tanstack/react-query";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderInput,
  GitFork,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,

  Star,
  Trash2,
} from "lucide-react";
import type { AiRunInput, PromptDetail, VersionDto } from "../../../shared/ipc.js";
import { aiRunProgressEventSchema } from "../../../shared/ipc.js";
import { useAppMutation, useNotes, useRunGroups, useRuns, useVersionContent, useVersions } from "../hooks/use-data";
import {
  getRunModelSelection,
  setRunModelSelection,
  type ModelRef,
} from "../lib/ai-prefs";
import { togglePanel } from "../lib/panels";
import { cx } from "../lib/time";
import { useToast } from "../lib/toast";
import { useAppState } from "../state/app-state";
import { CompareDialog } from "./CompareDialog";
import { ConfirmDialog, DuplicateBranchDialog, NameDialog, RateDialog, type RatingScores } from "./dialogs";
import { EditorTab } from "./EditorTab";
import { HistoryTab } from "./HistoryTab";
import { Inspector } from "./Inspector";
import { NotesTab } from "./NotesTab";
import { ResultsTab } from "./ResultsTab";
import { fromRunResult, fromStoredGroup, placeholderGroup, RunCompareView, type CompareGroup, type CompareRun } from "./RunCompareView";

import { modelRefKey, useAvailableModels } from "./model-picker";
import { MoveToCollectionDialog } from "./MoveToCollectionDialog";
import { RunWindow } from "./run-controls";
import { TagEditor } from "./TagEditor";
import { EmptyState, Spinner } from "./ui";
import { t } from "../lib/i18n";

function MenuItem({
  icon,
  label,
  danger,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cx(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] outline-none",
        danger
          ? "text-danger data-[highlighted]:bg-danger-soft"
          : "text-ink-dim data-[highlighted]:bg-hover data-[highlighted]:text-ink",
      )}
    >
      {icon}
      {label}
    </DropdownMenu.Item>
  );
}

function VersionDropdown({
  prompt,
  versions,
  viewingVersion,
  onDuplicate,
}: {
  prompt: PromptDetail;
  versions: VersionDto[];
  viewingVersion: VersionDto | null;
  onDuplicate: (version: VersionDto) => void;
}) {
  const { setViewingVersionId } = useAppState();
  const current = versions.find((v) => v.id === prompt.currentVersionId) ?? null;
  const shown = viewingVersion ?? current;

  // Group by branch, preserving order of first appearance.
  const branchNames: string[] = [];
  const byBranch = new Map<string, VersionDto[]>();
  for (const version of versions) {
    if (!byBranch.has(version.branchName)) {
      byBranch.set(version.branchName, []);
      branchNames.push(version.branchName);
    }
    byBranch.get(version.branchName)!.push(version);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex min-w-0 max-w-36 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink transition-colors hover:border-line-strong @max-lg:max-w-28 @max-md:max-w-20"
        >
          <span className="min-w-0 truncate tabular-nums">
            {shown ? shown.displayLabel : t("common.none")}
            {shown && shown.id === prompt.currentVersionId && (
              <span className="ml-1 text-ink-faint">{t("main_pane.current")}</span>
            )}
          </span>
          <ChevronDown size={12} className="shrink-0 text-ink-faint" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="pb-menu z-50 max-h-80 w-60 overflow-y-auto rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
        >
          {branchNames.map((branchName) => (
            <DropdownMenu.Group key={branchName}>
              {branchNames.length > 1 && (
                <DropdownMenu.Label className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {branchName}
                </DropdownMenu.Label>
              )}
              {[...(byBranch.get(branchName) ?? [])]
                .sort((a, b) => b.number - a.number)
                .map((version) => (
                  <DropdownMenu.Item
                    key={version.id}
                    onSelect={() => setViewingVersionId(version.id === prompt.currentVersionId ? null : version.id)}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink-dim outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink"
                  >
                    <span className="min-w-0 truncate">
                      {version.displayLabel}
                      {version.id === prompt.currentVersionId && (
                        <span className="ml-1 text-ink-faint">{t("main_pane.current")}</span>
                      )}
                    </span>
                    {version.id === (shown?.id ?? prompt.currentVersionId) && (
                      <Check size={12} className="shrink-0 text-accent" />
                    )}
                  </DropdownMenu.Item>
                ))}
            </DropdownMenu.Group>
          ))}
          {shown && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                onSelect={() => onDuplicate(shown)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink-dim outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink"
              >
                <GitFork size={12} />
                {t("main_pane.duplicate_as_variation", { label: shown.displayLabel })}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MainPane({ prompt }: { prompt: PromptDetail }) {
  const { viewingVersionId, setViewingVersionId, selectPrompt, openSettings } = useAppState();
  const { data: versions } = useVersions(prompt.id);
  const { data: notes } = useNotes(prompt.id);
  const { data: runs } = useRuns(prompt.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("prompt");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVersionTarget, setRenameVersionTarget] = useState<VersionDto | null>(null);
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<VersionDto | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
  const [rateTarget, setRateTarget] = useState<{ type: "prompt" } | { type: "version"; version: VersionDto } | null>(null);
  const [comparePair, setComparePair] = useState<{ base: VersionDto; other: VersionDto } | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<VersionDto | null>(null);
  const [duplicatePromptSource, setDuplicatePromptSource] = useState<VersionDto | null>(null);
  const [runWindowOpen, setRunWindowOpen] = useState(false);

  useEffect(() => {
    setActiveTab("prompt");
  }, [prompt.id]);

  const versionList = versions ?? [];
  useEffect(() => {
    if (!versions) return;
    const liveIds = new Set(versions.map((version) => version.id));
    const keepVersion = (target: VersionDto | null) =>
      target !== null && liveIds.has(target.id) ? target : null;
    setRenameVersionTarget(keepVersion);
    setDeleteVersionTarget(keepVersion);
    setDuplicateSource(keepVersion);
    setDuplicatePromptSource(keepVersion);
    setRateTarget((target) =>
      target?.type === "version" && !liveIds.has(target.version.id) ? null : target,
    );
    setComparePair((pair) =>
      pair && liveIds.has(pair.base.id) && liveIds.has(pair.other.id) ? pair : null,
    );
  }, [versions]);
  const viewingVersion =
    (viewingVersionId ? versionList.find((v) => v.id === viewingVersionId) : null) ??
    versionList.find((v) => v.id === prompt.currentVersionId) ??
    null;
  const isViewingCurrent = viewingVersion !== null && viewingVersion.id === prompt.currentVersionId;
  const viewingDraftContent =
    viewingVersion &&
    prompt.draftContent !== null &&
    (prompt.draftBaseVersionId === viewingVersion.id ||
      (prompt.draftBaseVersionId === null && isViewingCurrent))
      ? prompt.draftContent
      : null;
  const nextViewingVersionNumber = viewingVersion
    ? Math.max(
        0,
        ...versionList
          .filter((candidate) => candidate.branchId === viewingVersion.branchId)
          .map((candidate) => candidate.number),
      ) + 1
    : 1;
  const handleVersionCreated = useCallback(
    (created: VersionDto) => setViewingVersionId(created.isCurrent ? null : created.id),
    [setViewingVersionId],
  );

  const { data: versionContent } = useVersionContent(viewingVersion?.id ?? null);

  // ------------------------------------------------------------- AI run flow
  const liveContentRef = useRef<string | null>(null);
  const availableModels = useAvailableModels();
  const { data: runGroups } = useRunGroups(prompt.id);
  const [modelSelection, setModelSelection] = useState<ModelRef[]>(
    () => getRunModelSelection(prompt.id) ?? [],
  );
  const [compare, setCompare] = useState<
    { kind: "fresh"; group: CompareGroup } | { kind: "history"; runGroupId: string } | null
  >(null);
  // The in-flight run, shown live in the compare view: placeholder columns
  // created when the run starts, updated by ai:run-progress events until
  // the final DTO (kind "fresh") replaces them. runGroupId is adopted from
  // the first matching "queued" event, emitted at request time,
  // so Cancel works before the first token (the ai:run invoke resolves only
  // at the end). Closing the view mid-run only dismisses it — tracking
  // continues so the Run button keeps showing "Running n/m…"; completion
  // reopens the settled view unless another group was opened meanwhile.
  const [live, setLive] = useState<{
    requestId: string;
    group: CompareGroup;
    cancelling: boolean;
    dismissed: boolean;
  } | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  // Detached mutations retain their original callbacks, so consult the
  // current view when deciding where their completion belongs.
  const runViewRef = useRef({ promptId: prompt.id, compare });
  runViewRef.current = { promptId: prompt.id, compare };

  useEffect(() => {
    setModelSelection(getRunModelSelection(prompt.id) ?? []);
    setCompare(null);
    // Mid-run prompt switch (F13): the run keeps going in the background —
    // the live view is dropped and the completion toast reroutes instead.
    setLive(null);
    activeRequestIdRef.current = null;
  }, [prompt.id]);

  // Live progress side channel. Zod-parsed here (defense in depth — the
  // sandboxed preload forwards the raw payload). Events for other requests
  // (e.g. late events of a finished run) are ignored.
  useEffect(() => {
    return window.promptbr0.ai.onRunProgress((raw) => {
      const parsed = aiRunProgressEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      setLive((current) => {
        if (!current || current.requestId !== event.requestId) return current;
        const runs = current.group.runs.map((run): CompareRun => {
          if (run.providerId !== event.providerId || run.modelId !== event.modelId) return run;
          switch (event.phase) {
            case "queued":
              // Carries the runGroupId at request time (Cancel works before
              // the first token); the row stays pending until "started".
              return run;
            case "started":
              return { ...run, status: "streaming" };
            case "delta":
              return { ...run, status: "streaming", partial: event.text ?? run.partial };
            case "completed":
              return {
                ...run,
                status: "completed",
                output: event.text ?? run.partial,
                partial: event.text ?? run.partial,
                latencyMs: event.latencyMs ?? null,
                usage: event.usage ?? null,
                costUsd: event.costUsd ?? null,
              };
            case "error":
              return {
                ...run,
                status: "error",
                error: event.error ?? t("main.run-failed"),
                partial: event.text ?? run.partial,
              };
          }
        });
        const runGroupId = current.group.runGroupId === "" && event.phase === "queued"
          ? event.runGroupId
          : current.group.runGroupId;
        return { ...current, group: { ...current.group, runGroupId, runs } };
      });
    });
  }, []);

  const runModels = useAppMutation(
    ({ promptTitle: _promptTitle, ...input }: AiRunInput & { promptTitle: string }) =>
      window.promptbr0.ai.run(input),
    {
      toast: (group, input) => {
        if (input.promptId !== runViewRef.current.promptId || activeRequestIdRef.current !== input.requestId) {
          return t("main_pane.run_finished", { title: input.promptTitle });
        }
        const succeeded = group.runs.filter((r) => r.status === "completed").length;
        const total = group.runs.length;
        const summary = t("main_pane.run_complete", { n: succeeded, total });
        // Another group was opened while this run was dismissed — the toast
        // reroutes instead of hijacking the open view.
        return runViewRef.current.compare !== null ? `${summary} — ${t("main_pane.run_complete_open")}` : summary;
      },
      onSuccess: (group, input) => {
        if (activeRequestIdRef.current !== input.requestId) return;
        activeRequestIdRef.current = null;
        setLive((current) => current?.requestId === input.requestId ? null : current);
        if (input.promptId !== runViewRef.current.promptId) return;
        // The user explicitly opened another group while this run was in
        // flight (dismissed live view) — don't clobber it with the result.
        if (runViewRef.current.compare !== null) return;
        setCompare({ kind: "fresh", group: fromRunResult(group) });
      },
      onError: (_error, input) => {
        if (activeRequestIdRef.current !== input.requestId) return;
        activeRequestIdRef.current = null;
        setLive((current) => current?.requestId === input.requestId ? null : current);
      },
    },
  );

  const resetRunModels = runModels.reset;
  useEffect(() => {
    // Detach this prompt's observer so another prompt can run while the
    // previous invocation finishes in the background.
    resetRunModels();
  }, [prompt.id, resetRunModels]);

  const cancelRun = useAppMutation(
    ({ runGroupId }: { requestId: string; runGroupId: string }) =>
      window.promptbr0.ai.runCancel({ runGroupId }),
    {
      toast: (result) => (result.cancelled ? t("main_pane.run_cancelled") : t("main_pane.run_already_finished")),
      // Both failure and "already finished" must release the Cancelling… state.
      onSuccess: (result, input) => {
        if (!result.cancelled) {
          setLive((current) =>
            current?.requestId === input.requestId && current.group.runGroupId === input.runGroupId
              ? { ...current, cancelling: false }
              : current,
          );
        }
      },
      onError: (_error, input) => setLive((current) =>
        current?.requestId === input.requestId && current.group.runGroupId === input.runGroupId
          ? { ...current, cancelling: false }
          : current,
      ),
    },
  );

  /**
   * Starts a run: opens the compare view immediately with placeholder
   * columns, then fires the ai:run invoke (resolves when ALL models settle;
   * live progress arrives via events meanwhile). The content is the final
   * text assembled in the run window — variables travel inside it (unfilled
   * ones go to the model as-is), so no separate substitution happens here.
   */
  const beginRun = (refs: ModelRef[], content: string) => {
    const requestId = crypto.randomUUID();
    const withNames = refs.map((ref) => ({
      ...ref,
      providerName:
        availableModels.find((m) => modelRefKey(m) === modelRefKey(ref))?.providerName ?? ref.providerId,
    }));
    setCompare(null);
    activeRequestIdRef.current = requestId;
    setLive({
      requestId,
      group: placeholderGroup(withNames, viewingVersion?.id ?? ""),
      cancelling: false,
      dismissed: false,
    });
    runModels.mutate({
      requestId,
      promptId: prompt.id,
      promptTitle: prompt.title,
      ...(viewingVersion ? { versionId: viewingVersion.id } : {}),
      content,
      modelRefs: refs,
      variables: {},
    });
  };

  /**
   * Opens the unified run window — the single entry point for runs. With
   * `refs` (rerun path), re-validates and adopts that selection first.
   */
  const openRunWindow = (refs?: ModelRef[]) => {
    if (availableModels.length === 0) {
      toast(t("main_pane.no_models"), "error");
      openSettings("ai");
      return;
    }
    if (refs) {
      const valid = refs.filter((ref) => availableModels.some((m) => modelRefKey(m) === modelRefKey(ref)));
      setModelSelection(valid);
      setRunModelSelection(prompt.id, valid);
    }
    setRunWindowOpen(true);
  };

  // Memoized: a fresh object every render would reset RunCompareView's
  // local star-rating state via its group-sync effect.
  const compareGroup: CompareGroup | null = useMemo(() => {
    if (compare === null) return null;
    if (compare.kind === "fresh") return compare.group;
    const stored = runGroups?.find((g) => g.runGroupId === compare.runGroupId);
    return stored ? fromStoredGroup(stored) : null;
  }, [compare, runGroups]);
  // An explicitly opened group (fresh result or history) takes precedence
  // over the in-flight live view; the final DTO (kind "fresh") replaces the
  // live group only when nothing else was opened meanwhile.
  const activeGroup = compareGroup ?? live?.group ?? null;
  const compareVersionLabel =
    (activeGroup && versionList.find((v) => v.id === activeGroup.versionId)?.displayLabel) ?? null;
  // "Running n/m…" on the Run button, derived from progress events.
  const liveSettled = live?.group.runs.filter((r) => r.status === "completed" || r.status === "error").length ?? 0;
  const runLabel = runModels.isPending
    ? live !== null
      ? `${t("main.running")} ${liveSettled}/${live.group.runs.length}…`
      : t("main.running…")
    : t("main.run");

  const setStarred = useAppMutation(
    (starred: boolean) => window.promptbr0.prompts.setStarred(prompt.id, starred),
    { quiet: true },
  );
  const rename = useAppMutation(
    (title: string) => window.promptbr0.prompts.update(prompt.id, { title }),
    { toast: t("main_pane.prompt_renamed") },
  );
  const renameVersion = useAppMutation(
    ({ versionId, label }: { versionId: string; label: string | null }) =>
      window.promptbr0.versions.updateLabel(versionId, label),
    { toast: t("main_pane.version_renamed") },
  );
  const deleteVersion = useAppMutation(
    (versionId: string) => window.promptbr0.versions.delete(versionId),
    {
      toast: t("main_pane.version_deleted"),
      onSuccess: (_result, versionId) => {
        if (viewingVersionId === versionId) setViewingVersionId(null);
      },
    },
  );
  const duplicatePrompt = useAppMutation(
    ({ versionId, title }: { versionId: string; title: string }) =>
      window.promptbr0.prompts.duplicate({ promptId: prompt.id, versionId, title }),
    {
      toast: t("main_pane.prompt_duplicated"),
      onSuccess: (created) => selectPrompt(created.id),
    },
  );
  const updateDescription = useAppMutation(
    (description: string) => window.promptbr0.prompts.update(prompt.id, { description }),
    { toast: t("main_pane.description_updated") },
  );
  const softDelete = useAppMutation(() => window.promptbr0.prompts.softDelete(prompt.id), {
    toast: t("main_pane.moved_to_trash"),
    onSuccess: () => selectPrompt(null),
  });
  const restore = useAppMutation(() => window.promptbr0.prompts.restore(prompt.id), {
    toast: t("main_pane.prompt_restored"),
  });
  const hardDelete = useAppMutation(() => window.promptbr0.prompts.hardDelete(prompt.id), {
    toast: t("main_pane.prompt_permanently_deleted"),
    onSuccess: () => selectPrompt(null),
  });
  const setCurrent = useAppMutation(
    () => window.promptbr0.versions.setCurrent(prompt.id, viewingVersion!.id),
    {
      toast: t("main_pane.version_restored"),
      onSuccess: () => setViewingVersionId(null),
    },
  );
  const exportPrompt = useAppMutation(() => window.promptbr0.prompts.exportJson(prompt.id), {
    toast: (r) => (r.canceled ? t("main_pane.export_canceled") : `Exported to ${r.path}`),
  });
  const rate = useAppMutation(
    (input: { targetType: "prompt" | "version"; targetId: string; scores: RatingScores }) =>
      window.promptbr0.ratings.add({ targetType: input.targetType, targetId: input.targetId, ...input.scores }),
    { toast: t("main_pane.rating_saved") },
  );

  // A new variation becomes the working version without replacing the
  // preferred version used by Quick Access and the CLI.
  const duplicateAsVariation = async (name: string, description: string) => {
    const source = duplicateSource;
    if (!source) return;
    const result = await window.promptbr0.branches.create({
      promptId: prompt.id,
      name,
      fromVersionId: source.id,
      ...(description ? { description } : {}),
    });
    await queryClient.invalidateQueries();
    toast(t("main_pane.variation_created", { name }));
    setViewingVersionId(result.version.id);
    setActiveTab("prompt");
  };

  const inTrash = prompt.deletedAt !== null;

  // Editor | inspector split: resizable via drag separator, collapsible.
  const inspectorRef = usePanelRef();
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const mainLayout = useDefaultLayout({ id: "promptbr0-main", storage: localStorage });
  // First run only (no persisted layout): on narrow windows, start with the
  // inspector collapsed. The collapse itself is then persisted and respected.
  useEffect(() => {
    if (mainLayout.defaultLayout === undefined && window.innerWidth < 1150) {
      inspectorRef.current?.collapse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stable callbacks: the memoized Inspector (and EditorTab above) must not
  // re-render on each streamed run delta — inline arrows would defeat memo.
  const toggleInspector = useCallback(() => {
    togglePanel(inspectorRef.current, setInspectorCollapsed);
  }, [inspectorRef]);
  const rateVersion = useCallback((version: VersionDto) => setRateTarget({ type: "version", version }), []);
  const compareVersions = useCallback(
    (base: VersionDto, other: VersionDto) => setComparePair({ base, other }),
    [],
  );
  const openRunGroup = useCallback((runGroupId: string) => setCompare({ kind: "history", runGroupId }), []);

  return (
    <>
      <Group
        orientation="horizontal"
        className="h-full"
        defaultLayout={mainLayout.defaultLayout}
        onLayoutChanged={mainLayout.onLayoutChanged}
      >
        <Panel id="editor" minSize={320} className="min-h-0 min-w-0">
          <div className="@container flex h-full w-full min-w-0 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent @max-md:hidden">
            <FileText size={16} />
          </div>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" title={prompt.title}>{prompt.title}</h2>
          {viewingVersion && viewingVersion.branchName !== "main" && (
            <span className="flex min-w-0 max-w-32 shrink items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent @max-2xl:hidden">
              <GitFork size={10} className="shrink-0" />
              <span className="truncate">{viewingVersion.branchName}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setStarred.mutate(!prompt.isStarred)}
            className={cx(
              "shrink-0 rounded-md p-1.5 transition-colors",
              prompt.isStarred ? "text-star" : "text-ink-faint hover:text-star",
            )}
            aria-label={prompt.isStarred ? t("prompt_list.prompt_name_unstar") : t("prompt_list.prompt_name_star")}
          >
            <Star size={16} fill={prompt.isStarred ? "currentColor" : "none"} />
          </button>
          <VersionDropdown prompt={prompt} versions={versionList} viewingVersion={isViewingCurrent ? null : viewingVersion} onDuplicate={(v) => setDuplicateSource(v)} />
          {!inTrash && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (runModels.isPending) {
                    setCompare(null);
                    setLive((current) =>
                      current ? { ...current, dismissed: false } : current,
                    );
                    return;
                  }
                  openRunWindow();
                }}
                disabled={runModels.isPending && live === null}
                title={runModels.isPending ? t("main_pane.open_running_eval") : t("main_pane.run_with_models")}
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runModels.isPending ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Play size={12} />
                )}
                <span className="@max-md:hidden">{runLabel}</span>
              </button>
            </>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="shrink-0 rounded-md p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                aria-label={t("main.more-actions")}
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="pb-menu z-50 w-52 rounded-lg border border-line-strong bg-raised p-1 shadow-xl shadow-black/40"
              >
                <MenuItem icon={<Pencil size={13} />} label={t("main_pane.rename_prompt")} onSelect={() => setRenameOpen(true)} />
                <MenuItem icon={<FileText size={13} />} label={t("main_pane.edit_description")} onSelect={() => setDescriptionOpen(true)} />
                <MenuItem icon={<FolderInput size={13} />} label={t("main_pane.move_to_collection")} onSelect={() => setCollectionsOpen(true)} />
                <MenuItem icon={<Star size={13} />} label={t("main_pane.rate_prompt")} onSelect={() => setRateTarget({ type: "prompt" })} />
                <MenuItem
                  icon={<Copy size={13} />}
                  label={t("main_pane.duplicate_as_new_prompt")}
                  onSelect={() => {
                    if (viewingVersion) setDuplicatePromptSource(viewingVersion);
                  }}
                />
                <MenuItem
                  icon={<GitFork size={13} />}
                  label={t("main_pane.duplicate_as_variation_menu")}
                  onSelect={() => {
                    if (viewingVersion) setDuplicateSource(viewingVersion);
                  }}
                />
                <MenuItem
                  icon={<Pencil size={13} />}
                  label={t("main_pane.rename_version")}
                  onSelect={() => {
                    if (viewingVersion) setRenameVersionTarget(viewingVersion);
                  }}
                />
                {!isViewingCurrent && viewingVersion && (
                  <MenuItem
                    icon={<Trash2 size={13} />}
                    label={t("main_pane.delete_version")}
                    danger
                    onSelect={() => setDeleteVersionTarget(viewingVersion)}
                  />
                )}
                <MenuItem
                  icon={<Download size={13} />}
                  label={t("main_pane.export_json")}
                  onSelect={() => exportPrompt.mutate(undefined)}
                />

                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <MenuItem icon={<Trash2 size={13} />} label={t("main_pane.delete_prompt")} danger onSelect={() => setDeleteOpen(true)} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {/* Tag row */}
        <div className="border-b border-line px-4 py-2">
          <TagEditor prompt={prompt} />
        </div>

        {/* Trash banner */}
        {inTrash && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-danger/20 bg-danger-soft px-4 py-2">
            <span className="min-w-0 text-[12px] text-danger">
              {t("main_pane.trash_readonly")}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => restore.mutate(undefined)}
                className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-raised"
              >
                <RotateCcw size={12} />
                Restore
              </button>
              <button
                type="button"
                onClick={() => setHardDeleteOpen(true)}
                className="rounded-md bg-red-600 px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-red-500"
              >
                {t("main_pane.delete_permanently")}
              </button>
            </div>
          </div>
        )}

        {/* Non-current version banner */}
        {!inTrash && !isViewingCurrent && viewingVersion && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-accent/20 bg-accent-soft/60 px-4 py-2">
            <span className="min-w-0 text-[12px] text-ink-dim">
              You're viewing <span className="font-medium text-ink">{viewingVersion.displayLabel}</span> — read-only.
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrent.mutate(undefined)}
                className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong"
              >
                {t("main_pane.restore_as_current")}
              </button>
              <button
                type="button"
                onClick={() => setViewingVersionId(null)}
                className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
              >
                {t("main_pane.back_to_current")}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs.Root
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 pt-1.5">
            {[
              { value: "prompt", label: t("main_pane.prompt") },
              { value: "history", label: t("main_pane.history", { count: versionList.length }) },
              // Matches the manual-log list in ResultsTab: model runs
              // (tool "prompt-run") have their own "Model runs" section.
              { value: "results", label: t("main_pane.results", { count: (runs ?? []).filter((r) => r.tool !== "prompt-run").length }) },
              { value: "notes", label: t("main_pane.notes", { count: notes?.length ?? 0 }) },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className={cx(
                  "shrink-0 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-3 py-1.5 text-[12px] font-medium transition-colors",
                  "text-ink-dim hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink",
                )}
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="prompt" className="flex min-h-0 flex-1 flex-col outline-none">
            {versionContent && viewingVersion ? (
              <EditorTab
                key={`${prompt.id}:${viewingVersion.id}`}
                prompt={prompt}
                version={versionContent}
                isCurrent={isViewingCurrent}
                isEditable={!inTrash}
                nextVersionNumber={nextViewingVersionNumber}
                onVersionCreated={handleVersionCreated}
                liveContentRef={liveContentRef}
              />
            ) : (
              <Spinner />
            )}
          </Tabs.Content>
          <Tabs.Content value="history" className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
            <HistoryTab
              prompt={prompt}
              versions={versionList}
              onView={(versionId) => {
                setViewingVersionId(versionId === prompt.currentVersionId ? null : versionId);
                setActiveTab("prompt");
              }}
              onCompare={compareVersions}
              onDuplicate={(version) => setDuplicateSource(version)}
              onDuplicateAsPrompt={(version) => setDuplicatePromptSource(version)}
              onRename={(version) => setRenameVersionTarget(version)}
              onDelete={(version) => setDeleteVersionTarget(version)}
            />
          </Tabs.Content>
          <Tabs.Content value="results" className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
            <ResultsTab
              prompt={prompt}
              currentVersionLabel={
                versionList.find((v) => v.id === prompt.currentVersionId)?.displayLabel ?? "current"
              }
              onOpenRunGroup={openRunGroup}
            />
          </Tabs.Content>
          <Tabs.Content value="notes" className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
            <NotesTab prompt={prompt} versions={versionList} viewingVersion={viewingVersion} />
          </Tabs.Content>
        </Tabs.Root>
      </div>

        </Panel>
        <Separator className="w-px shrink-0" />
        <Panel
          id="inspector"
          collapsible
          collapsedSize={36}
          minSize={240}
          maxSize={400}
          defaultSize={288}
          groupResizeBehavior="preserve-pixel-size"
          panelRef={inspectorRef}
          onResize={(size) => setInspectorCollapsed(size.inPixels <= 37)}
          className="min-h-0"
        >
          <Inspector
            prompt={prompt}
            viewingVersion={viewingVersion}
            collapsed={inspectorCollapsed}
            onToggleCollapse={toggleInspector}
            onRateVersion={rateVersion}
            onCompare={compareVersions}
            onOpenRunGroup={openRunGroup}
          />
        </Panel>
      </Group>

      {/* Dialogs */}
      <RunWindow
        open={runWindowOpen}
        onOpenChange={setRunWindowOpen}
        baseContent={liveContentRef.current ?? viewingDraftContent ?? versionContent?.content ?? ""}
        blocks={prompt.blocks}
        selection={modelSelection}
        onSelectionChange={(next) => {
          setModelSelection(next);
          setRunModelSelection(prompt.id, next);
        }}
        recents={getRunModelSelection(prompt.id) ?? []}
        running={runModels.isPending}
        runLabel={runLabel}
        onRun={(content) => beginRun(modelSelection, content)}
      />
      <NameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t("main_pane.rename_prompt")}
        label={t("dialog.title")}
        initialValue={prompt.title}
        submitLabel={t("dialog.rename")}
        onSubmit={(title) => rename.mutate(title)}
      />
      <NameDialog
        open={descriptionOpen}
        onOpenChange={setDescriptionOpen}
        title={t("main_pane.edit_description")}
        label={t("dialog.description")}
        initialValue={prompt.description ?? ""}
        placeholder={t("main_pane.description_placeholder")}
        onSubmit={(value) => updateDescription.mutate(value)}
      />
      <NameDialog
        open={duplicatePromptSource !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicatePromptSource(null);
        }}
        title={t("main_pane.duplicate_version_as_new_prompt", { label: duplicatePromptSource?.displayLabel ?? t("dialog.version") })}
        label={t("dialog.title")}
        initialValue={`${prompt.title} ${t("dialog.copy_suffix")}`}
        submitLabel={t("dialog.duplicate")}
        onSubmit={(title) => {
          if (duplicatePromptSource) {
            duplicatePrompt.mutate({ versionId: duplicatePromptSource.id, title });
          }
        }}
      />
      <NameDialog
        open={renameVersionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameVersionTarget(null);
        }}
        title={t("dialog.rename_version", { label: renameVersionTarget?.displayLabel ?? t("dialog.version") })}
        label={t("dialog.version_name")}
        initialValue={renameVersionTarget?.label ?? ""}
        placeholder={renameVersionTarget ? `Automatic: v${renameVersionTarget.number}` : undefined}
        submitLabel={t("dialog.rename")}
        allowEmpty
        onSubmit={(label) => {
          if (renameVersionTarget) {
            renameVersion.mutate({ versionId: renameVersionTarget.id, label: label || null });
          }
        }}
      />
      <MoveToCollectionDialog prompt={prompt} open={collectionsOpen} onOpenChange={setCollectionsOpen} />
      <ConfirmDialog
        open={deleteVersionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteVersionTarget(null);
        }}
        title={t("main_pane.delete_version_confirm", { label: deleteVersionTarget?.displayLabel ?? "" })}
        description={t("main_pane.delete_version_desc")}
        confirmLabel={t("main_pane.delete_version_label")}
        danger
        onConfirm={() => {
          if (deleteVersionTarget) deleteVersion.mutate(deleteVersionTarget.id);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("run_compare.delete_prompt_confirm", { title: prompt.title })}
        description={t("main_pane.delete_prompt_desc")}
        confirmLabel={t("main_pane.move_to_trash_confirm")}
        danger
        onConfirm={() => softDelete.mutate(undefined)}
      />
      <ConfirmDialog
        open={hardDeleteOpen}
        onOpenChange={setHardDeleteOpen}
        title={t("run_compare.permanently_delete_confirm", { title: prompt.title })}
        description={t("main_pane.permanently_delete_desc")}
        confirmLabel={t("main_pane.delete_permanently_confirm")}
        danger
        onConfirm={() => hardDelete.mutate(undefined)}
      />
      <RateDialog
        open={rateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRateTarget(null);
        }}
        title={
          rateTarget?.type === "version" ? `Rate ${rateTarget.version.displayLabel}` : t("main.rate-prompt")
        }
        onSubmit={(scores) => {
          if (!rateTarget) return;
          rate.mutate({
            targetType: rateTarget.type,
            targetId: rateTarget.type === "version" ? rateTarget.version.id : prompt.id,
            scores,
          });
        }}
      />
      <DuplicateBranchDialog
        open={duplicateSource !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateSource(null);
        }}
        sourceLabel={duplicateSource?.displayLabel ?? ""}
        onSubmit={duplicateAsVariation}
      />
      <CompareDialog
        open={comparePair !== null}
        onOpenChange={(open) => {
          if (!open) setComparePair(null);
        }}
        base={comparePair?.base ?? null}
        other={comparePair?.other ?? null}
      />
      <RunCompareView
        group={activeGroup}
        promptId={prompt.id}
        promptTitle={prompt.title}
        versionLabel={compareVersionLabel}
        open={compare !== null || (live !== null && !live.dismissed)}
        onOpenChange={(open) => {
          if (!open) {
            setCompare(null);
            // Closing mid-run only dismisses the view: progress tracking
            // continues (Run button keeps its n/m label) and completion
            // reopens the settled compare view.
            setLive((current) => (current ? { ...current, dismissed: true } : current));
          }
        }}
        running={runModels.isPending}
        live={live !== null && !live.dismissed}
        cancelling={live?.cancelling ?? false}
        onCancel={() => {
          if (!live || !live.group.runGroupId) return;
          const { requestId, group: { runGroupId } } = live;
          setLive((current) => (current ? { ...current, cancelling: true } : current));
          cancelRun.mutate({ requestId, runGroupId });
        }}
        onRerun={(refs) => openRunWindow(refs)}
        onChangeModels={() => {
          setCompare(null);
          setLive(null);
          setRunWindowOpen(true);
        }}
      />
    </>
  );
}

export function MainPaneEmpty() {
  const { view } = useAppState();
  return (
    <div className="flex h-full w-full min-w-0 items-center justify-center">
      <EmptyState
        icon={<FileText size={16} />}
        title={view.kind === "trash" ? t("main_pane.nothing_selected") : t("main_pane.select_prompt")}
        hint={t("main_pane.select_prompt_hint")}
      />
    </div>
  );
}
