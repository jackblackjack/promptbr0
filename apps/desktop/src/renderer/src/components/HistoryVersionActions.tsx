import { Copy, Eye, GitFork, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { VersionDto } from "../../../shared/ipc.js";
import { t } from "../lib/i18n";

export interface HistoryVersionActionHandlers {
  onView(versionId: string): void;
  onSetCurrent(version: VersionDto): void;
  onDuplicate(version: VersionDto): void;
  onDuplicateAsPrompt(version: VersionDto): void;
  onRename(version: VersionDto): void;
  onDelete(version: VersionDto): void;
}

export function HistoryVersionActions({
  version,
  isCurrent,
  alwaysVisible = false,
  onView,
  onSetCurrent,
  onDuplicate,
  onDuplicateAsPrompt,
  onRename,
  onDelete,
}: HistoryVersionActionHandlers & { version: VersionDto; isCurrent: boolean; alwaysVisible?: boolean }) {
  return (
    <div
      className={
        alwaysVisible
          ? "flex min-w-0 flex-wrap items-center gap-1"
          : "items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
      }
      style={{
        display: "flex",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={() => onView(version.id)}
        title={t("history_tab.view_version")}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Eye size={12} />
        {t("history_tab.view")}
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onSetCurrent(version)}
          title={t("history_version_actions.set_as_current")}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <RotateCcw size={12} />
          {t("history_version_actions.set_as_current")}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDuplicate(version)}
        aria-label={t("history_version_actions.duplicate_as_variation", { label: version.displayLabel })}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <GitFork size={12} />
        {t("history_version_actions.variation")}
      </button>
      <button
        type="button"
        onClick={() => onDuplicateAsPrompt(version)}
        aria-label={t("history_version_actions.duplicate_as_new_prompt", { label: version.displayLabel })}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Copy size={12} />
        {t("history_version_actions.new_prompt_label")}
      </button>
      <button
        type="button"
        onClick={() => onRename(version)}
        aria-label={t("history_version_actions.rename", { label: version.displayLabel })}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Pencil size={12} />
        {t("dialog.rename")}
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onDelete(version)}
          aria-label={t("history_version_actions.delete", { label: version.displayLabel })}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-danger transition-colors hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger"
        >
          <Trash2 size={12} />
          {t("dialog.delete")}
        </button>
      )}
    </div>
  );
}
