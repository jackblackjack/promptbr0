import { Laptop } from "lucide-react";
import { useSyncStatus } from "../hooks/use-data";
import { useAppState } from "../state/app-state";
import { t } from "../lib/i18n";

/**
 * LeftRail footer status line for device sync. Shown only while sync is
 * enabled — the Settings → Sync section is the entry point otherwise.
 */
export function SyncStatusRow() {
  const { data: status } = useSyncStatus();
  const { openSettings } = useAppState();
  if (!status?.enabled) return null;

  const peers = status.peers;
  const anySyncing = peers.some((p) => p.state === "syncing" || p.state === "connecting");
  const hasError = peers.some((p) => p.state === "error") || peers.some((p) => p.unhealthy);
  const offline = peers.find((p) => p.state === "offline");
  const pending = status.pendingDirty > 0;

  let dot = "bg-ink-faint";
  let label = t("sync_status.waiting");
  if (peers.length === 0) {
    label = t("sync_status.no_devices");
  } else if (hasError) {
    dot = "bg-red-500";
    label = t("sync_status.failing");
  } else if (offline) {
    // Offline outranks "pending changes": nothing can drain while the peer
    // is unreachable, so blue here would read as perpetual fake progress.
    dot = "bg-red-500";
    label = t("sync_status.offline", { name: offline.name });
  } else if (anySyncing || pending) {
    dot = "bg-blue-400";
    label = t("sync_status.syncing");
  } else if (peers.some((p) => p.state === "steady")) {
    dot = "bg-success";
    const steady = peers.find((p) => p.state === "steady");
    label = t("sync_status.synced", { name: steady?.name ?? t("sync_status.device") });
  }

  return (
    <button
      type="button"
      onClick={() => openSettings("sync")}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-hover"
      title={t("sync_status.click_to_manage")}
    >
      <Laptop size={13} className="shrink-0 text-ink-faint" />
      <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-ink-dim">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}
