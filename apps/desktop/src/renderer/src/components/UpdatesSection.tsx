import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  updateStateDtoSchema,
  type UpdateAssetDto,
  type UpdateStateDto,
} from "../../../shared/ipc.js";
import { qk, useUpdateState } from "../hooks/use-data";
import { cx, relativeTime } from "../lib/time";
import { t } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useAppState } from "../state/app-state";

const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

const primaryButton =
  "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40";

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function downloadLabel(asset: UpdateAssetDto, assetCount: number): string {
  if (assetCount === 1) return t("updates.update-downloaded");
  if (asset.kind === "appimage") return t("updates.download-appimage");
  if (asset.kind === "deb") return t("updates.download-deb");
  return t("updates.download-label", { label: asset.label });
}

function statusCopy(state: UpdateStateDto): {
  title: string;
  description: string;
  icon: ReactNode;
  tone: string;
} {
  const target = state.platform + ' ' + state.architecture;
  switch (state.status) {
    case "checking":
      return {
        title: t("updates.checking"),
        description: t("updates.checking-desc", { target }),
        icon: <RefreshCw size={16} className="animate-spin" aria-hidden />,
        tone: "border-accent/25 bg-accent-soft text-accent",
      };
    case "up-to-date":
      return {
        title: t("updates.up-to-date"),
        description: t("updates.up-to-date-desc", { version: state.currentVersion }),
        icon: <CheckCircle2 size={16} aria-hidden />,
        tone: "border-success/25 bg-success/10 text-success",
      };
    case "update-available":
      return {
        title: t("updates.update-available", { version: state.latestVersion ?? "" }),
        description: t("updates.update-available-desc", { target }),
        icon: <Sparkles size={16} aria-hidden />,
        tone: "border-accent/25 bg-accent-soft text-accent",
      };
    case "no-compatible-download":
      return {
        title: t("updates.no-compatible"),
        description:
          t("updates.no-compatible-desc", { version: state.latestVersion ?? "the latest release", target }),
        icon: <AlertTriangle size={16} aria-hidden />,
        tone: "border-line-strong bg-raised text-ink-dim",
      };
    case "newer-build":
      return {
        title: t("updates.newer-build"),
        description:
          t("updates.newer-build-desc", {
            installed: state.currentVersion,
            version: state.latestVersion ? ` (${state.latestVersion})` : "",
          }),
        icon: <Sparkles size={16} aria-hidden />,
        tone: "border-line-strong bg-raised text-ink-dim",
      };
    case "error":
      return {
        title: t("updates.check-error"),
        description: state.errorMessage ?? t("updates.check-error-desc"),
        icon: <AlertTriangle size={16} aria-hidden />,
        tone: "border-danger/25 bg-danger-soft text-danger",
      };
    case "not-checked":
      return {
        title: t("updates.ready-to-check"),
        description: t("updates.ready-to-check-desc"),
        icon: <RefreshCw size={16} aria-hidden />,
        tone: "border-line-strong bg-raised text-ink-dim",
      };
  }
}


/** Settings -> Updates: detection is automatic; installation remains user-controlled. */
export function UpdatesSection() {
  const queryClient = useQueryClient();
  const updateQuery = useUpdateState();
  const { setSettingsOpen } = useAppState();
  const { toast } = useToast();
  const [preferencePending, setPreferencePending] = useState(false);

  const setState = (state: UpdateStateDto) => {
    queryClient.setQueryData<UpdateStateDto>(qk.updateState, state);
  };

  if (updateQuery.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-24 animate-pulse rounded-lg border border-line bg-app" />
        <p className="text-[11px] text-ink-faint">{t("updates.loading")}</p>
      </div>
    );
  }

  if (!updateQuery.data) {
    return (
      <div className="rounded-lg border border-danger/25 bg-danger-soft p-4 text-danger">
        <p className="text-[12px] font-medium">{t("updates.unavailable")}</p>
        <button
          type="button"
          onClick={() => void updateQuery.refetch()}
          className="mt-3 rounded-md border border-danger/30 px-3 py-1.5 text-[12px] font-medium hover:bg-danger/10"
        >
          {t("updates.try-again")}
        </button>
      </div>
    );
  }

  const state = updateQuery.data;
  const status = statusCopy(state);
  const checking = state.status === "checking";
  const checkLabel =
    state.status === "error"
      ? t("updates.try-again")
      : checking
        ? t("updates.checking…")
        : state.status === "not-checked"
          ? t("updates.check-for-updates")
          : t("updates.check-again");
  const lastChecked = state.lastCheckedAt
    ? capitalize(relativeTime(state.lastCheckedAt))
    : t("updates.last-checked-never");

  const checkNow = () => {
    if (checking) return;
    setState({
      ...state,
      status: "checking",
      checkSource: "manual",
      errorMessage: null,
    });
    void window.promptbr0.updates
      .check()
      .then((next) => setState(updateStateDtoSchema.parse(next)))
      .catch(() => {
        setState({
          ...state,
          status: "error",
          lastCheckedAt: new Date().toISOString(),
          checkSource: "manual",
          errorMessage: t("updates.check-failed-full"),
        });
      });
  };

  const setAutomaticChecks = () => {
    if (preferencePending) return;
    setPreferencePending(true);
    void window.promptbr0.updates
      .setAutomaticChecks(!state.automaticChecksEnabled)
      .then((next) => setState(updateStateDtoSchema.parse(next)))
      .catch(() => toast(t("updates.preference-error"), "error"))
      .finally(() => setPreferencePending(false));
  };

  const openDownload = (asset: UpdateAssetDto) => {
    void window.promptbr0.updates
      .openDownload(asset.name)
      .catch(() => toast(t("updates.download-error"), "error"));
  };

  const openReleaseNotes = () => {
    void window.promptbr0.updates
      .openReleaseNotes()
      .catch(() => toast(t("updates.release-notes-error"), "error"));
  };

  const showRelease =
    state.status === "update-available" || state.status === "no-compatible-download";

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-line bg-app">
        <div
          role="status"
          aria-live="polite"
          className={cx("flex items-start gap-3 border-b px-4 py-3.5", status.tone)}
        >
          <span className="mt-0.5 shrink-0">{status.icon}</span>
          <div className="min-w-0">
            <h4 className="text-[13px] font-semibold tracking-tight">{status.title}</h4>
            <p className="mt-0.5 max-w-[52ch] text-[11px] leading-relaxed opacity-80">
              {status.description}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3.5">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              {t("updates.current-version")}
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-ink">
              {state.currentVersion}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              {t("updates.latest-version")}
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-ink">
              {state.latestVersion ?? t("updates.latest-version-not-checked")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              {t("updates.this-build")}
            </dt>
            <dd className="mt-0.5 text-[11px] text-ink-dim">
              {state.platform} · {state.architecture}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              {t("updates.last-checked")}
            </dt>
            <dd
              className="mt-0.5 text-[11px] text-ink-dim"
              title={state.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString() : undefined}
            >
              {lastChecked}
            </dd>
          </div>
        </dl>
      </section>

      {showRelease && state.releaseNotes ? (
        <section className="space-y-1.5">
          <h4 className="text-[11px] font-semibold text-ink-dim">{t("updates.what-is-new")}</h4>
          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-app px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">
            {state.releaseNotes}
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {state.status === "update-available"
          ? state.assets.map((asset) => {
              const label = downloadLabel(asset, state.assets.length);
              return (
                <button
                  key={asset.name}
                  type="button"
                  aria-label={label}
                  onClick={() => openDownload(asset)}
                  className={primaryButton}
                >
                  <Download size={12} aria-hidden />
                  {label}
                  {asset.recommended && state.assets.length > 1 ? (
                    <span
                      aria-hidden
                      className="ml-0.5 rounded bg-white/15 px-1 py-px text-[9px] font-medium"
                    >
                      {t("updates.recommended")}
                    </span>
                  ) : null}
                </button>
              );
            })
          : null}
        {state.status !== "update-available" ? (
          <button
            type="button"
            onClick={checkNow}
            disabled={checking}
            className={secondaryButton}
          >
            <RefreshCw
              size={12}
              className={checking ? "animate-spin" : undefined}
              aria-hidden
            />
            {checkLabel}
          </button>
        ) : null}
        {showRelease ? (
          <button type="button" onClick={openReleaseNotes} className={secondaryButton}>
            {t("updates.full-release-notes")}
            <ExternalLink size={12} aria-hidden />
          </button>
        ) : null}
        {state.status === "update-available" ? (
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded-md px-2 py-1.5 text-[12px] text-ink-faint transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {t("updates.later")}
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
        <div>
          <p className="text-[12px] font-medium text-ink-dim">
            {t("updates.automatic-checks")}
          </p>
          <p className="mt-0.5 max-w-[48ch] text-[11px] leading-relaxed text-ink-faint">
            {t("updates.automatic-checks-hint")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.automaticChecksEnabled}
          aria-label={t("updates.automatic-checks")}
          disabled={preferencePending}
          onClick={setAutomaticChecks}
          className={cx(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40",
            state.automaticChecksEnabled ? "bg-accent" : "bg-line-strong",
          )}
        >
          <span
            className={cx(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
              state.automaticChecksEnabled ? "left-4.5" : "left-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}
