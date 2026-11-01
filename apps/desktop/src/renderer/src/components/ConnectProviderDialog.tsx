/**
 * "Connect provider" dialog (OpenCode-style): a search-first, scrollable list
 * of the whole models.dev catalog — popular providers up top, then "Other"
 * A-Z, with a pinned "Custom OpenAI-compatible provider" row — followed by an
 * inline second step for the API key (and base URL when relevant). Connecting
 * creates the provider, auto-tests inline and refreshes the catalog in the
 * background; the provider is kept even when the test fails.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, RefreshCw, Search, X, Zap } from "lucide-react";
import type { AiCatalogModelDto, AiCatalogProviderDto } from "../../../shared/ipc.js";
import { useAiCatalog, useAiEnvDetect, useAiProviders } from "../hooks/use-data";
import { chatModelTier } from "../lib/chat-models";
import { userErrorMessage } from "../lib/errors";
import { cx } from "../lib/time";
import { t } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { ProviderTile } from "./ui";

const inputClass =
  "w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40";

const primaryButtonClass =
  "rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40";

const ghostButtonClass =
  "rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** The pinned "custom endpoint" pseudo-provider. */
const CUSTOM_ID = "openai-compatible";

type Phase = "form" | "working" | "connected" | "error";

/** Second step: API key (+ base URL when relevant), inline test on connect. */
function ConnectForm({
  provider,
  catalogModels,
  envDetected,
  onBack,
  onDone,
}: {
  /** Null for the custom OpenAI-compatible endpoint. */
  provider: AiCatalogProviderDto | null;
  /** This provider's catalog models — the user picks the model the
   * connection test runs with; nothing is auto-selected. */
  catalogModels: AiCatalogModelDto[];
  envDetected: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isCustom = provider === null;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.api ?? "");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [modelUnavailable, setModelUnavailable] = useState(false);
  // Replacement model named by the provider in a retirement notice.
  const [suggestedModel, setSuggestedModel] = useState<string | undefined>(undefined);
  // No default: the test model is an explicit user choice, never a guess.
  const [testModelId, setTestModelId] = useState("");
  // Suggested ordering, not a filter: confirmed chat models first (a test
  // needs a model that can answer), then unknown-modality entries, then
  // known non-text models (image/music) last. Everything stays selectable.
  const testModelOptions = useMemo(() => {
    return [...catalogModels]
      .map((model) => ({
        model,
        tier: chatModelTier(model),
        cost: model.costInput ?? Number.POSITIVE_INFINITY,
      }))
      .sort(
        (a, b) =>
          a.tier - b.tier || a.cost - b.cost || a.model.id.localeCompare(b.model.id),
      )
      .map((entry) => entry.model);
  }, [catalogModels]);
  // Delayed auto-close after a successful connect; cleared on unmount.
  const doneTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current);
    },
    [],
  );
  const scheduleDone = () => {
    doneTimerRef.current = window.setTimeout(onDone, 900);
  };

  const displayName = provider?.name ?? t("connect_provider.custom_provider");
  // Base URL matters for long-tail + custom endpoints; native drivers know theirs.
  const showBaseUrl = isCustom || provider!.driver === "openai-compatible";

  /** Background catalog refresh: silent on success, toast on failure. */
  const refreshCatalogQuiet = () => {
    void window.promptbr0.ai.catalog.refresh().then((result) => {
      if (!result.ok) toast(t("connect_provider.catalog_refresh_failed", { error: result.error ?? t("connect_provider.unknown_error") }), "error");
    });
  };

  const runTest = async (providerId: string, modelId?: string) => {
    // The provider row must appear immediately, whatever the test outcome.
    await queryClient.invalidateQueries();
    const result = await window.promptbr0.ai.providers.test(providerId, modelId);
    if (result.ok) {
      setModelUnavailable(false);
      setSuggestedModel(undefined);
      setErrorHint(null);
      setPhase("connected");
      refreshCatalogQuiet();
      scheduleDone();
    } else {
      setModelUnavailable(result.modelUnavailable === true);
      setSuggestedModel(result.suggestedModel);
      setPhase("error");
      setError(result.error ?? t("connect_provider.connection_test_failed"));
      setErrorHint(result.hint ?? null);
      refreshCatalogQuiet();
    }
  };

  const connect = async (modelId: string) => {
    setPhase("working");
    setError(null);
    setErrorHint(null);
    try {
      let providerId = createdId;
      if (providerId === null) {
        const created = await window.promptbr0.ai.providers.create({
          type: provider?.id ?? CUSTOM_ID,
          name: isCustom ? t("connect_provider.custom_endpoint") : displayName,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(showBaseUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        });
        providerId = created.id;
        setCreatedId(providerId);
      } else {
        // "Fix" path: the provider is already saved; update the key and retry.
        await window.promptbr0.ai.providers.update({
          id: providerId,
          patch: {
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(showBaseUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          },
        });
      }
      await runTest(providerId, modelId !== "" ? modelId : undefined);
    } catch (err) {
      setPhase("error");
      setError(userErrorMessage(err));
      setErrorHint(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect(testModelId);
  };

  /** One-click recovery: adopt the provider's named replacement model. */
  const switchAndRetry = () => {
    if (!suggestedModel) return;
    setTestModelId(suggestedModel);
    void connect(suggestedModel);
  };

  const connectEnv = async () => {
    if (!provider) return;
    setPhase("working");
    setError(null);
    setErrorHint(null);
    try {
      const result = await window.promptbr0.ai.providers.connectEnv({
        catalogId: provider.id,
        ...(testModelId ? { modelId: testModelId } : {}),
      });
      await queryClient.invalidateQueries();
      if (result.test.ok) {
        setPhase("connected");
        toast(t("connect_provider.connected_via_env", { name: result.provider.name }));
        refreshCatalogQuiet();
        scheduleDone();
      } else {
        setPhase("error");
        setModelUnavailable(result.test.modelUnavailable === true);
        setSuggestedModel(result.test.suggestedModel);
        setError(result.test.error ?? t("connect_provider.connection_test_failed"));
        setErrorHint(result.test.hint ?? null);
        setCreatedId(result.provider.id);
        refreshCatalogQuiet();
      }
    } catch (err) {
      setPhase("error");
      setError(userErrorMessage(err));
      setErrorHint(null);
    }
  };

  const keyOptional = isCustom;
  const canSubmit =
    phase !== "working" &&
    (!showBaseUrl || baseUrl.trim().length > 0) &&
    (keyOptional || apiKey.trim().length > 0 || createdId !== null) &&
    // With catalog models, the test model is an explicit choice — never
    // auto-picked — so Connect stays disabled until one is selected.
    (testModelOptions.length === 0 || testModelId !== "");

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("connect_provider.back_to_provider_list")}
          disabled={phase === "working"}
          className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={14} />
        </button>
        <ProviderTile label={displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{displayName}</p>
          {provider && (
            <p className="truncate text-[10px] text-ink-faint">
              {t("connect_provider.model_count", { count: provider.modelCount })} {t("connect_provider.in_catalog")}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto px-4 py-4">
        {envDetected && provider && createdId === null && (
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border border-success/30 bg-success-soft px-2.5 py-2">
            <span className="text-[11px] font-medium text-success">
              {provider.env[0] ?? t("connect_provider.api_key")} {t("connect_provider.detected_in_environment")}
            </span>
            <button
              type="button"
              onClick={() => void connectEnv()}
              disabled={
                phase === "working" || (testModelOptions.length > 0 && testModelId === "")
              }
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-40"
            >
              {phase === "working" ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
              {t("connect_provider.use_environment_key")}
            </button>
          </div>
        )}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-dim">
            {t("connect_provider.api_key")}{" "}
            {createdId !== null ? (
              <span className="font-normal text-ink-faint">{t("connect_provider.enter_corrected_key")}</span>
            ) : (
              keyOptional && <span className="font-normal text-ink-faint">{t("connect_provider.optional_for_local")}</span>
            )}
          </span>
          <input
            type="password"
            autoFocus
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider?.env[0] ?? (keyOptional ? t("connect_provider.placeholder_optional") : t("connect_provider.placeholder_api_key"))}
            className={inputClass}
          />
          <span className="block text-[11px] leading-relaxed text-ink-faint">
            {t("connect_provider.stored_encrypted")}
          </span>
        </label>
        {showBaseUrl && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-dim">
              {t("connect_provider.base_url")}{" "}
              {!isCustom && <span className="font-normal text-ink-faint">{t("connect_provider.from_catalog_editable")}</span>}
            </span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t("connect_provider.placeholder_base_url")}
              className={cx(inputClass, "font-mono text-xs")}
            />
            {createdId !== null && (
              <span className="block text-[11px] leading-relaxed text-ink-faint">
                {t("connect_provider.changing_url_clears_key")}
              </span>
            )}
          </label>
        )}
        {testModelOptions.length > 0 && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-dim">
              {t("connect_provider.test_model")} <span className="font-normal text-ink-faint">{t("connect_provider.connection_check_runs")}</span>
            </span>
            <select
              aria-label={t("connect_provider.test_model")}
              value={testModelId}
              onChange={(e) => setTestModelId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("connect_provider.select_model")}</option>
              {testModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.id})
                </option>
              ))}
            </select>
            <span className="block text-[11px] leading-relaxed text-ink-faint">
              {t("connect_provider.models_conversation_first")}
            </span>
          </label>
        )}
        {phase === "working" && (
          <p className="flex items-center gap-2 text-[11px] text-ink-dim">
            <Loader2 size={11} className="animate-spin" />
            {createdId === null ? t("connect_provider.connecting_testing") : t("connect_provider.retesting_connection")}
          </p>
        )}
        {phase === "connected" && (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-success">
            <Check size={12} />
            {isCustom ? t("connect_provider.declare_models") : t("connect_provider.all_models_ready", { name: displayName })}
          </p>
        )}
        {phase === "error" && (
          <div className="rounded-md border border-danger/20 bg-danger-soft px-2.5 py-2">
            <p className="text-[11px] leading-relaxed text-danger">{error}</p>
            {errorHint && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{errorHint}</p>
            )}
            {modelUnavailable && testModelOptions.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                {t("connect_provider.model_not_available")}
              </p>
            )}
            {suggestedModel && suggestedModel !== testModelId && (
              <button
                type="button"
                onClick={switchAndRetry}
                className="mt-2 rounded-md border border-line bg-panel px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-raised disabled:opacity-40"
              >
                {t("connect_provider.switch_and_retry", { model: suggestedModel })}
              </button>
            )}
            <p className="mt-1 text-[10px] text-ink-faint">
              {createdId === null ? (
                t("connect_provider.nothing_saved", { orUrl: showBaseUrl ? ` ${t("connect_provider.or_url")}` : "" })
              ) : (
                t("connect_provider.provider_saved", { orUrl: showBaseUrl ? ` ${t("connect_provider.or_url")}` : "" })
              )}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        {phase === "error" && (
          <button type="button" className={ghostButtonClass} onClick={onDone}>
            {createdId === null ? t("dialog.cancel") : t("connect_provider.keep_and_close")}
          </button>
        )}
        <button type="submit" className={primaryButtonClass} disabled={!canSubmit}>
          {phase === "working" ? t("connect_provider.connecting") : phase === "error" ? t("connect_provider.fix_and_retry") : t("connect_provider.connect")}
        </button>
      </div>
    </form>
  );
}

function ProviderListRow({
  provider,
  detected,
  alreadyConnected,
  onSelect,
}: {
  provider: AiCatalogProviderDto;
  detected: boolean;
  alreadyConnected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
    >
      <ProviderTile label={provider.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{provider.name}</span>
        <span className="block truncate text-[10px] text-ink-faint">
          {t("connect_provider.model_count", { count: provider.modelCount })}
        </span>
      </span>
      {alreadyConnected && (
        <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-faint">
          {t("ai.connected")}
        </span>
      )}
      {detected && (
        <span className="shrink-0 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-success">
          {t("connect_provider.detected")}
        </span>
      )}
    </button>
  );
}

export function ConnectProviderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: catalog } = useAiCatalog();
  const { data: providers } = useAiProviders();
  const { data: envDetected } = useAiEnvDetect();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /** Refresh + revalidate the cached catalog query (get alone never refetches). */
  const refreshCatalog = () => {
    setRefreshing(true);
    setRefreshError(null);
    void window.promptbr0.ai.catalog
      .refresh()
      .then(async (result) => {
        await queryClient.invalidateQueries();
        if (!result.ok) {
          setRefreshError(result.error ?? t("connect_provider.catalog_refresh_failed_short"));
          if (catalog !== null) toast(t("connect_provider.catalog_refresh_failed", { error: result.error ?? t("connect_provider.unknown_error") }), "error");
        }
      })
      .finally(() => setRefreshing(false));
  };

  // Cold start: no cached catalog — fetch it when the dialog opens.
  useEffect(() => {
    if (!open || catalog !== null) return;
    refreshCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catalog]);

  // Reset the flow whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedId(null);
    }
  }, [open]);

  const connectedTypes = useMemo(() => new Set((providers ?? []).map((p) => p.type)), [providers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = catalog?.providers ?? [];
    if (!q) return all;
    return all.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [catalog, query]);

  const popular = filtered.filter((p) => p.popular);
  const other = filtered.filter((p) => !p.popular);
  const selected = selectedId && selectedId !== CUSTOM_ID ? (catalog?.providers.find((p) => p.id === selectedId) ?? null) : null;

  const customVisible =
    !query.trim() ||
    "custom openai-compatible provider".includes(query.trim().toLowerCase()) ||
    "openai compatible".includes(query.trim().toLowerCase());

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pb-overlay fixed inset-0 z-[60] bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pb-dialog fixed left-1/2 top-1/2 z-[70] flex h-[min(520px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50 focus:outline-none"
        >
          {selectedId === null ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <Dialog.Title className="text-sm font-semibold text-ink">{t("connect_provider.title")}</Dialog.Title>
                <Dialog.Close
                  aria-label={t("dialog.close")}
                  className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
                >
                  <X size={15} />
                </Dialog.Close>
              </div>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <Search size={12} className="shrink-0 text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("connect_provider.search_placeholder")}
                  aria-label={t("connect_provider.search_placeholder")}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {customVisible && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(CUSTOM_ID)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <ProviderTile label={t("connect_provider.custom")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-ink">
                        {t("connect_provider.custom_provider")}
                      </span>
                      <span className="block truncate text-[10px] text-ink-faint">
                        {t("connect_provider.custom_hint")}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent">
                      {t("connect_provider.custom")}
                    </span>
                  </button>
                )}
                {catalog === null ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    {refreshing ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-ink-faint" />
                        <p className="text-[11px] text-ink-faint">{t("connect_provider.fetching_catalog")}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] leading-relaxed text-ink-faint">
                          {refreshError
                            ? t("connect_provider.could_not_fetch", { error: refreshError })
                            : t("connect_provider.no_catalog_cached")}
                        </p>
                        <button
                          type="button"
                          onClick={refreshCatalog}
                          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                        >
                          <RefreshCw size={11} />
                          {t("connect_provider.retry_catalog_refresh")}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {popular.length > 0 && (
                      <>
                        <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                          {t("connect_provider.popular")}
                        </p>
                        {popular.map((p) => (
                          <ProviderListRow
                            key={p.id}
                            provider={p}
                            detected={envDetected?.[p.id] === true && !connectedTypes.has(p.id)}
                            alreadyConnected={connectedTypes.has(p.id)}
                            onSelect={() => setSelectedId(p.id)}
                          />
                        ))}
                      </>
                    )}
                    {other.length > 0 && (
                      <>
                        <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                          {t("connect_provider.other")}
                        </p>
                        {other.map((p) => (
                          <ProviderListRow
                            key={p.id}
                            provider={p}
                            detected={envDetected?.[p.id] === true && !connectedTypes.has(p.id)}
                            alreadyConnected={connectedTypes.has(p.id)}
                            onSelect={() => setSelectedId(p.id)}
                          />
                        ))}
                      </>
                    )}
                    {filtered.length === 0 && (
                      <p className="px-2 py-3 text-[11px] text-ink-faint">{t("connect_provider.no_match", { query })}</p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="sr-only">Connect {selected?.name ?? "custom provider"}</Dialog.Title>
              <ConnectForm
                key={selectedId}
                provider={selected}
                catalogModels={selected ? (catalog?.models[selected.id] ?? []) : []}
                envDetected={selected !== null && envDetected?.[selected.id] === true}
                onBack={() => setSelectedId(null)}
                onDone={() => onOpenChange(false)}
              />
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
