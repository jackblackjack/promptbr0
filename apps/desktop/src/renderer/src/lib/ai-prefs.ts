/**
 * Per-prompt AI run preferences (last model selection), stored in localStorage
 * alongside the global prefs in lib/prefs.ts. These keys are dynamic (scoped
 * by prompt id), so they live outside PrefsSchema; components keep them in
 * local state and persist on change — no store subscription is needed.
 *
 * Variable values are deliberately not remembered: since the unified run
 * window, variable values live in the edited prompt text itself.
 */

export interface ModelRef {
  providerId: string;
  modelId: string;
}

const PREFIX = "promptbr0:pref:";

function read<T>(key: string, validate: (value: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // persistence is best-effort
  }
}

function asModelRefs(value: unknown): ModelRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs = value.filter(
    (v): v is ModelRef =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as ModelRef).providerId === "string" &&
      typeof (v as ModelRef).modelId === "string",
  );
  return refs.length === value.length ? refs : null;
}

/** Last model selection used to run this prompt; null when never run. */
export function getRunModelSelection(promptId: string): ModelRef[] | null {
  return read(`run-models:${promptId}`, asModelRefs);
}

export function setRunModelSelection(promptId: string, refs: ModelRef[]): void {
  write(`run-models:${promptId}`, refs);
}

/** {{variable}} names in a prompt's content, in order of first appearance. */
export function extractVariableNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu)) {
    names.add(match[1]!);
  }
  return [...names];
}
