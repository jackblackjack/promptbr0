import { GitCompare } from "lucide-react";
import type { VersionDto } from "../../../shared/ipc.js";
import { t } from "../lib/i18n";

export function HistoryCompareBar({
  base,
  other,
  onClear,
  onCompare,
}: {
  base: VersionDto | null;
  other: VersionDto | null;
  onClear(): void;
  onCompare(base: VersionDto, other: VersionDto): void;
}) {
  if (!base) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line bg-panel px-5 py-2.5">
      <span className="min-w-0 text-[12px] text-ink-dim">
        {other
          ? `${base.displayLabel} ↔ ${other.displayLabel} ${t("history_compare.selected")}`
          : `${base.displayLabel} ${t("history_compare.pick_another")}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2.5 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        >
          {t("history_compare.clear")}
        </button>
        <button
          type="button"
          disabled={!other}
          onClick={() => {
            if (other) onCompare(base, other);
          }}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GitCompare size={12} />
          {t("history_compare.compare")} {base.displayLabel} ↔ {other?.displayLabel ?? "?"}
        </button>
      </div>
    </div>
  );
}
