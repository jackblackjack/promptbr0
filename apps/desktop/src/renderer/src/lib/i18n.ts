/**
 * Minimal i18n module with lazy-loaded dictionaries and English fallback.
 *
 * English is bundled statically so `t()` works on the very first render (no
 * flash of untranslated keys at startup and no inline bootstrap script, which
 * keeps the renderer CSP hash-pinned). Other dictionaries are loaded on demand
 * via dynamic `import()` and are code-split out of the main bundle.
 *
 * Usage:
 *   import { t, initI18n } from "../lib/i18n";
 *   initI18n("en");  // call once when the app starts
 *   t("settings.title");
 */
import en from "../locales/en.json";

type Dict = Record<string, string>;

let currentLocale: string = "en";
const dictionaries: Record<string, Dict> = { en: en as Dict };

/** Callbacks to invoke when locale changes (for forcing re-renders). */
const localeChangeCallbacks: Set<() => void> = new Set();

/**
 * Non-English dictionaries, each code-split into its own chunk by the
 * explicit dynamic imports. Add a locale here when a new dictionary lands.
 */
const localeLoaders: Record<string, () => Promise<{ default: Dict }>> = {
  ru: () => import("../locales/ru.json") as Promise<{ default: Dict }>,
};

/** Preload a dictionary by locale code. */
async function loadLocale(locale: string): Promise<Dict> {
  const loaded = dictionaries[locale];
  if (loaded) return loaded;

  const load = localeLoaders[locale];
  if (!load) return en as Dict;

  const dict = (await load()).default;
  dictionaries[locale] = dict;
  return dict;
}

/**
 * Initialise i18n for a given locale.
 * Loads the requested dictionary eagerly so the first `t()` call is instant.
 * Invokes locale change callbacks after the dictionary loads.
 */
export async function initI18n(locale: string): Promise<void> {
  if (locale === currentLocale && dictionaries[locale]) return;
  currentLocale = locale;
  await loadLocale(locale);
  // Also keep English available as a per-key fallback.
  if (locale !== "en") {
    await loadLocale("en");
  }
  // Notify subscribers so they can re-render.
  for (const cb of localeChangeCallbacks) cb();
}

/** Register a callback to be invoked when the locale changes. Returns an unsubscribe function. */
export function onLocaleChange(cb: () => void): () => void {
  localeChangeCallbacks.add(cb);
  return () => localeChangeCallbacks.delete(cb);
}

/**
 * Ensure a locale is loaded, then return the translation.
 * Synchronously checks if the dictionary is loaded; if not, returns the key
 * (which will be correct on the next render after initI18n completes).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let value = dictionaries[currentLocale]?.[key];
  if (value === undefined) {
    value = dictionaries["en"]?.[key];
  }
  if (value === undefined) {
    return key;
  }
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_match, paramKey: string) =>
    String(params[paramKey] ?? ""),
  );
}

export function getLocale(): string {
  return currentLocale;
}

/**
 * Selects a one/few/many plural form with Intl.PluralRules and interpolates
 * `{count}`. `few` is optional so English callers can omit it: English maps
 * every non-singular count to the "other" category, which uses `many`.
 */
export function tCount(
  count: number,
  keys: { one: string; few?: string; many: string },
): string {
  const category = new Intl.PluralRules(getLocale()).select(count);
  const key =
    category === "one" ? keys.one : category === "few" && keys.few ? keys.few : keys.many;
  return t(key, { count });
}
