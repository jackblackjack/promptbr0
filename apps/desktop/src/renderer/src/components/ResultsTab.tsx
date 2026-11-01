import { useState } from "react";
import { FlaskConical, Play, Plus, Trash2 } from "lucide-react";
import { t } from "../lib/i18n";
import type { PromptDetail, RunDto, RunGroupDto } from "../../../shared/ipc.js";
import { useAppMutation, useRunGroups, useRuns } from "../hooks/use-data";
import { relativeTime } from "../lib/time";
import { ConfirmDialog, LogRunDialog, type LogRunInput } from "./dialogs";
import { EmptyState, Spinner, Stars } from "./ui";

/** Manual-log filter: everything, only hand-logged tools, or only model runs. */
type RunToolFilter = "all" | "manual" | "model";

const RUN_TOOL_FILTERS: Array<{ value: RunToolFilter; labelKey: string }> = [
  { value: "all", labelKey: "results_tab.all_activity" },
  { value: "manual", labelKey: "results_tab.manual_runs" },
  { value: "model", labelKey: "results_tab.model_runs" },
];

function matchesToolFilter(run: RunDto, filter: RunToolFilter): boolean {
  if (filter === "all") return true;
  return filter === "model" ? run.tool === "prompt-run" : run.tool !== "prompt-run";
}

/** One run-group row: timestamp, model chips, success count, avg outcome. */
function RunGroupRow({
  group,
  onOpen,
  onDelete,
}: {
  group: RunGroupDto;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const ok = group.runs.filter((run) => run.status === "completed").length;
  const rated = group.runs.filter((run) => run.outcomeRating !== null);
  const avgOutcome =
    rated.length > 0 ? rated.reduce((sum, run) => sum + run.outcomeRating!, 0) / rated.length : null;

  return (
    <div className="group flex w-full items-center rounded-lg border border-line bg-panel transition-colors hover:border-line-strong hover:bg-hover">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            {group.runs.slice(0, 4).map((run) => (
              <span
                key={run.id}
                className="inline-flex max-w-40 items-center gap-1 truncate rounded-full border border-line bg-raised px-2 py-0.5 text-[10px] text-ink-dim"
              >
                {run.model ?? "unknown"}
                {run.status === "error" && <span className="text-danger">✕</span>}
              </span>
            ))}
            {group.runs.length > 4 && (
              <span className="text-[10px] text-ink-faint">+{group.runs.length - 4} more</span>
            )}
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-ink-faint">
            {relativeTime(group.createdAt)} · {ok}/{group.runs.length} ok
          </p>
        </div>
        {avgOutcome !== null && <Stars value={avgOutcome} size={11} />}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("results_tab.delete_model_run_aria")}
        title={t("results_tab.delete_run")}
        className="mr-3 shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function ResultsTab({
  prompt,
  currentVersionLabel,
  onOpenRunGroup,
}: {
  prompt: PromptDetail;
  currentVersionLabel: string;
  onOpenRunGroup: (runGroupId: string) => void;
}) {
  const { data: runs, isLoading } = useRuns(prompt.id);
  const { data: runGroups } = useRunGroups(prompt.id);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmRun, setConfirmRun] = useState<RunDto | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<RunGroupDto | null>(null);
  const [toolFilter, setToolFilter] = useState<RunToolFilter>("manual");

  const addRun = useAppMutation(
    (input: LogRunInput) =>
      window.promptbr0.runs.add({
        promptId: prompt.id,
        versionId: prompt.currentVersionId!,
        ...input,
      }),
    { toast: t("results_tab.run_logged") },
  );
  const deleteRun = useAppMutation((runId: string) => window.promptbr0.runs.delete(runId), {
    toast: t("results_tab.run_deleted"),
  });
  const deleteRunGroup = useAppMutation(
    async (group: RunGroupDto) => {
      for (const run of group.runs) await window.promptbr0.runs.delete(run.id);
    },
    { toast: t("results_tab.model_run_deleted") },
  );

  if (isLoading) return <Spinner />;

  const groups = runGroups ?? [];
  // The default "Manual runs" filter excludes model runs (tool
  // "prompt-run") — they live in the Model runs section above; the filter
  // can surface them in the log list too.
  const runList = (runs ?? []).filter((run) => matchesToolFilter(run, toolFilter));
  const rated = runList.filter((run) => run.outcomeRating !== null);
  const avgOutcome =
    rated.length > 0
      ? rated.reduce((sum, run) => sum + run.outcomeRating!, 0) / rated.length
      : null;

  const header = (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
      <span className="text-[12px] tabular-nums text-ink-faint">
        {runList.length === 0
          ? groups.length === 0
            ? t("results_tab.no_runs")
            : t("results_tab.model_runs_count", { count: groups.length })
          : avgOutcome !== null
            ? t("results_tab.runs_avg", { count: runList.length, avg: avgOutcome.toFixed(1) })
            : t("results_tab.runs_count", { count: runList.length })}
      </span>
      <span className="flex items-center gap-2">
        <select
          aria-label={t("results_tab.filter_by_tool")}
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value as RunToolFilter)}
          className="rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-line-strong focus:outline-none"
        >
          {RUN_TOOL_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          disabled={!prompt.currentVersionId}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
          {t("results_tab.log_run")}
        </button>
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {groups.length > 0 && (
          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              <Play size={10} />
              {t("results_tab.model_runs")}
            </p>
            {groups.map((group) => (
              <RunGroupRow
                key={group.runGroupId}
                group={group}
                onOpen={() => onOpenRunGroup(group.runGroupId)}
                onDelete={() => setConfirmGroup(group)}
              />
            ))}
          </section>
        )}
        {runList.length === 0 ? (
          groups.length === 0 && (
            <EmptyState
              icon={<FlaskConical size={16} />}
              title={t("results_tab.no_runs")}
              hint={t("results_tab.runs_hint")}
            />
          )
        ) : (
          <section className="space-y-2">
            {groups.length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                {t(RUN_TOOL_FILTERS.find((o) => o.value === toolFilter)?.labelKey ?? "results_tab.manual_log")}
              </p>
            )}
            {runList.map((run) => (
              <div key={run.id} className="group rounded-lg border border-line bg-panel p-3">
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-faint">
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <span className="font-medium text-ink-dim">{run.tool}</span>
                    {run.model && <span>{run.model}</span>}
                    {run.versionLabel && <span className="text-accent">{run.versionLabel}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Stars value={run.outcomeRating} size={11} />
                    {relativeTime(run.startedAt ?? run.createdAt)}
                    <button
                      type="button"
                      onClick={() => setConfirmRun(run)}
                      aria-label={t("results_tab.delete_run_aria")}
                      className="rounded p-0.5 text-ink-faint transition-colors hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {run.resultSummary && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{run.resultSummary}</p>
                )}
              </div>
            ))}
          </section>
        )}
      </div>

      <LogRunDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        versionLabel={currentVersionLabel}
        onSubmit={(input) => addRun.mutate(input)}
      />
      <ConfirmDialog
        open={confirmGroup !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmGroup(null);
        }}
        title={t("results_tab.delete_model_run_confirm")}
        description={
          confirmGroup?.runs.length === 1
            ? t("results_tab.delete_model_run_desc_one")
            : t("results_tab.delete_model_run_desc", { count: confirmGroup?.runs.length ?? 0 })
        }
        confirmLabel={t("results_tab.delete_model_run_label")}
        danger
        onConfirm={() => {
          if (confirmGroup) deleteRunGroup.mutate(confirmGroup);
          setConfirmGroup(null);
        }}
      />
      <ConfirmDialog
        open={confirmRun !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRun(null);
        }}
        title={t("results_tab.delete_run_confirm")}
        description={`The ${confirmRun?.tool ?? "manual"} run from ${confirmRun ? relativeTime(confirmRun.startedAt ?? confirmRun.createdAt) : ""} is removed. This cannot be undone.`}
        confirmLabel={t("results_tab.delete_run_label")}
        danger
        onConfirm={() => {
          if (confirmRun) deleteRun.mutate(confirmRun.id);
          setConfirmRun(null);
        }}
      />
    </div>
  );
}
