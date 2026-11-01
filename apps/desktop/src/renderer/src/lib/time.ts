import { getLocale } from "./i18n";

// Intl already knows plural rules and the idiomatic "yesterday"/"last week"
// forms for every locale, so the renderer only has to pick the unit.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(): Intl.RelativeTimeFormat {
  const locale = getLocale();
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

/** "2 days ago" / "2 дня назад"-style timestamps for ISO-8601 UTC strings. */
export function relativeTime(iso: string, nowMs = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const formatter = relativeFormatter();
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 45) return formatter.format(0, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return formatter.format(-days, "day");
  const weeks = Math.round(days / 7);
  if (weeks < 5) return formatter.format(-weeks, "week");
  const months = Math.round(days / 30);
  if (months < 12) return formatter.format(-months, "month");
  const years = Math.round(days / 365);
  return formatter.format(-years, "year");
}

/** "14:32" clock time in the app language, used for the draft-save indicator. */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function wordCount(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
