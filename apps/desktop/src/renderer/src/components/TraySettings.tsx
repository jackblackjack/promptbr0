import { useCallback, useEffect, useRef, useState } from "react";
import type { TrayStateDto } from "../../../shared/ipc.js";
import { cx } from "../lib/time";
import { t } from "../lib/i18n";

const INITIAL_STATE: TrayStateDto = { enabled: false, available: true, error: null };

/**
 * "Keep running in the system tray" switch. The preference lives in the
 * device-local settings table (owned by the main process), so the switch
 * loads its state over IPC instead of the localStorage prefs store.
 */
export function TraySettings() {
  const [state, setState] = useState<TrayStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const next = await window.promptbr0.tray.getState();
      if (!mounted.current) return;
      setState(next);
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const update = useCallback(async (enabled: boolean) => {
    setSaving(true);
    setSaveError(false);
    try {
      const next = await window.promptbr0.tray.setEnabled({ enabled });
      if (!mounted.current) return;
      setState(next);
    } catch {
      if (mounted.current) setSaveError(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, []);

  const current = state ?? INITIAL_STATE;
  const disabled = loading || saving || !current.available;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium text-ink-dim">{t("appearance.tray")}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
            {t("appearance.tray-hint")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={current.enabled}
          aria-label={t("appearance.tray")}
          disabled={disabled}
          onClick={() => void update(!current.enabled)}
          className={cx(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            current.enabled ? "bg-accent" : "bg-line-strong",
            disabled && "cursor-not-allowed opacity-40",
          )}
        >
          <span
            className={cx(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
              current.enabled ? "left-4.5" : "left-0.5",
            )}
          />
        </button>
      </div>
      {!current.available ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t("appearance.tray-unavailable")}
        </p>
      ) : (
        // The main process reports save/creation failures in `error` without
        // rejecting the request (the switch simply stays off).
        current.error && (
          <p role="alert" className="text-[11px] leading-relaxed text-danger">
            {current.error}
          </p>
        )
      )}
      {(loadError || saveError) && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {loadError ? t("appearance.tray-load-error") : t("appearance.tray-error")}
        </p>
      )}
    </div>
  );
}
