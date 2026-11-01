import { useState } from "react";
import { Laptop, RefreshCw, Trash2 } from "lucide-react";
import { useAppMutation, useSyncStatus } from "../hooks/use-data";
import { t } from "../lib/i18n";

const inputClass =
  "w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";

const ghostButton =
  "shrink-0 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40";

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <span className="text-[12px] font-medium text-ink-dim">{children}</span>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return t("sync.never");
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t("sync.just-now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

const STATE_LABEL: Record<string, string> = {
  connecting: "sync.waiting",
  syncing: "sync.syncing",
  steady: "sync.synced",
  error: "sync.error",
  offline: "sync.offline",
};

const STATE_DOT: Record<string, string> = {
  connecting: "bg-ink-faint",
  syncing: "bg-blue-400",
  steady: "bg-emerald-500",
  error: "bg-red-500",
  offline: "bg-red-500",
};

/**
 * Settings → Sync: enable P2P sync, name this device, add devices with a
 * pairing code (nearby list or manual address for VPNs), manage and forget
 * paired devices. Data syncs directly between your devices over the local
 * network — there is no server.
 */
export function SyncSection() {
  const { data: status } = useSyncStatus();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [manualPort, setManualPort] = useState("");
  const [code, setCode] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);

  const setEnabled = useAppMutation((enabled: boolean) => window.promptbr0.sync.setEnabled(enabled), {
    quiet: true,
    invalidateKeys: [["sync-status"]],
  });
  const setDeviceName = useAppMutation((name: string) => window.promptbr0.sync.setDeviceName(name), {
    toast: t("sync.device-name-saved"),
    invalidateKeys: [["sync-status"]],
    onSuccess: () => setNameDraft(null),
  });
  const setListenPort = useAppMutation((port: number) => window.promptbr0.sync.setListenPort(port), {
    toast: t("sync.port-saved"),
    invalidateKeys: [["sync-status"]],
    onSuccess: () => setPortDraft(null),
  });
  const beginPairing = useAppMutation(() => window.promptbr0.sync.beginPairing(), {
    quiet: true,
    invalidateKeys: [["sync-status"]],
  });
  const cancelPairing = useAppMutation(() => window.promptbr0.sync.cancelPairing(), {
    quiet: true,
    invalidateKeys: [["sync-status"]],
  });
  const forget = useAppMutation((fingerprint: string) => window.promptbr0.sync.forgetDevice(fingerprint), {
    toast: t("sync.device-forgotten"),
    invalidateKeys: [["sync-status"]],
  });
  const syncNow = useAppMutation(() => window.promptbr0.sync.now(), {
    quiet: true,
    invalidateKeys: [["sync-status"]],
  });

  const pair = useAppMutation(
    (input: { address: string; port: number; code: string }) => window.promptbr0.sync.pairWithCode(input),
    {
      quiet: true,
      invalidateKeys: [["sync-status"]],
      onSuccess: (result) => {
        if (result.ok) {
          setCode("");
          setManualAddress("");
          setManualPort("");
          setPairError(null);
        } else {
          setPairError(result.error ?? t("sync.pair-failed"));
        }
      },
      onError: (err) => setPairError(err.message),
    },
  );

  if (!status) return null;
  const portValue = portDraft ?? (status.listenPort === null ? "" : String(status.listenPort));
  const portNumber = Number(portValue);
  const portValid =
    /^\d+$/.test(portValue) &&
    Number.isInteger(portNumber) &&
    portNumber >= 1_024 &&
    portNumber <= 65_535;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <FieldLabel hint={t("sync.enable-hint")}>
          {t("sync.enable")}
        </FieldLabel>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          onClick={() => setEnabled.mutate(!status.enabled)}
          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
            status.enabled ? "border-accent/60 bg-accent/30" : "border-line bg-app"
          }`}
        >
          <span
            className={`ml-0.5 h-4 w-4 rounded-full transition-transform ${
              status.enabled ? "translate-x-4 bg-accent" : "translate-x-0 bg-ink-faint"
            }`}
          />
        </button>
      </div>

      {status.enabled && (
        <>
          <div className="space-y-2">
            <FieldLabel hint={t("sync.this-device-hint")}>
              {t("sync.this-device")}
            </FieldLabel>
            <div className="flex items-center gap-2">
              <input
                aria-label={t("sync.device-name-label")}
                value={nameDraft ?? status.deviceName}
                onChange={(e) => setNameDraft(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => nameDraft && setDeviceName.mutate(nameDraft)}
                disabled={nameDraft === null || nameDraft.trim().length === 0 || setDeviceName.isPending}
                className={ghostButton}
              >
                {t("sync.rename")}
              </button>
            </div>
            <p className="text-[11px] text-ink-faint">
              {status.fingerprintShort ? `${t("sync.identity-prefix")} ${status.fingerprintShort}` : t("sync-generating-identity")}
              {" · "}
              {status.pendingDirty > 0
                ? t("sync-changes-waiting", { count: String(status.pendingDirty), s: status.pendingDirty === 1 ? "" : "s" })
                : t("sync.last-synced", { time: relativeTime(status.lastSyncedAt) })}
            </p>
            <div className="flex items-center gap-2">
              <input
                aria-label={t("sync.port-label")}
                inputMode="numeric"
                value={portValue}
                onChange={(e) => setPortDraft(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-28 rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => setListenPort.mutate(portNumber)}
                disabled={portDraft === null || !portValid || setListenPort.isPending}
                className={ghostButton}
              >
                {t("data.save")}
              </button>
            </div>
            {portDraft !== null && !portValid && (
              <p className="text-[11px] text-red-500">{t("sync.port-error")}</p>
            )}
            {status.listenError && <p className="text-[12px] text-red-500">{status.listenError}</p>}
          </div>

          <div className="space-y-2">
            <FieldLabel hint={t("sync.add-device-hint")}>
              {t("sync.add-device")}
            </FieldLabel>

            {status.pairingActive ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-ink">{t("sync.pairing-open")}</p>
                  <p className="mt-0.5 font-mono text-[15px] tracking-wider text-ink">{status.pairingCode}</p>
                  {status.listenPort !== null && (
                    <p className="mt-0.5 text-[11px] text-ink-faint">{t("sync.port-number", { port: String(status.listenPort) })}</p>
                  )}
                </div>
                <button type="button" onClick={() => cancelPairing.mutate()} className={ghostButton}>
                  {t("sync.close")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => beginPairing.mutate()} className={ghostButton}>
                {t("sync.show-pairing-code")}
              </button>
            )}

            <div className="flex items-center gap-2">
              <input
                aria-label={t("sync.pairing-code-label")}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t("sync.pairing-code-placeholder")}
                className={`${inputClass} font-mono tracking-wider`}
              />
            </div>

            {status.nearby.length > 0 && (
              <div className="space-y-1.5">
                {status.nearby.map((device) => (
                  <div
                    key={device.fingerprint}
                    className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{device.name}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {device.address}:{device.port}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={code.trim().length === 0 || pair.isPending}
                      onClick={() => pair.mutate({ address: device.address, port: device.port, code: code.trim() })}
                      className={ghostButton}
                    >
                      {t("sync.nearby-pair")}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <details className="text-[12px] text-ink-dim">
              <summary className="cursor-pointer select-none text-ink-faint">{t("sync.pair-by-address")}</summary>
              <p className="mt-1 text-[11px] text-ink-faint">
                {t("sync.pair-address-hint")}
                {status.listenPort !== null && ` ${t("sync.port-number", { port: String(status.listenPort) })}.`}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  aria-label={t("sync.manual-address-label")}
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder={t("sync.manual-address-placeholder")}
                  className={inputClass}
                />
                <input
                  aria-label={t("sync.manual-port-label")}
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder={t("sync.manual-port-placeholder")}
                  className="w-20 rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <button
                  type="button"
                  disabled={
                    code.trim().length === 0 || manualAddress.trim().length === 0 || manualPort.length === 0 || pair.isPending
                  }
                  onClick={() =>
                    pair.mutate({ address: manualAddress.trim(), port: Number(manualPort), code: code.trim() })
                  }
                  className={ghostButton}
                >
                  {t("sync.nearby-pair")}
                </button>
              </div>
            </details>

            {pairError && <p className="text-[12px] text-red-500">{pairError}</p>}
          </div>

          {status.peers.length > 0 && (
            <div className="space-y-2">
              <FieldLabel>{t("sync.paired-devices")}</FieldLabel>
              <div className="space-y-1.5">
                {status.peers.map((peer) => (
                  <div
                    key={peer.fingerprint}
                    className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[peer.state] ?? "bg-ink-faint"}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-ink">{peer.name}</span>
                        <span className="block text-[11px] text-ink-faint">
                          {t(STATE_LABEL[peer.state] ?? peer.state)} · seen {relativeTime(peer.lastSeen)}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${t("sync.forget-device")}: ${peer.name}`}
                      onClick={() => forget.mutate(peer.fingerprint)}
                      className="shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-hover hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Laptop size={13} />
              {status.listening
                ? t("sync.listening", { port: String(status.listenPort) })
                : t("sync.listener-not-running")}
            </span>
            <button type="button" onClick={() => syncNow.mutate()} disabled={syncNow.isPending} className={ghostButton}>
              <span className="flex items-center gap-1.5">
                <RefreshCw size={12} className={syncNow.isPending ? "animate-spin" : undefined} />
                {t("sync.now")}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
