/** Lightweight variable substitution — mirrors @promptbr0/core without pulling in node:crypto. */

const PROMPT_VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;

const MAX_VARIABLES = 100;
const MAX_VALUE_LENGTH = 100_000;
const MAX_INPUT_LENGTH = 1_000_000;
const MAX_RENDERED_LENGTH = 1_000_000;

export function renderPromptVariablesBounded(
  content: string,
  values: Record<string, string>,
): string {
  const supplied = new Map<string, string>();
  let inputLength = 0;
  for (const name in values) {
    if (!Object.hasOwn(values, name)) continue;
    if (supplied.size >= MAX_VARIABLES) break;
    const value = values[name]!;
    inputLength += name.length + value.length;
    if (value.length > MAX_VALUE_LENGTH || inputLength > MAX_INPUT_LENGTH) break;
    supplied.set(name, value);
  }

  const names = new Set<string>();
  const segments: string[] = [];
  let end = 0;
  let renderedLength = 0;
  for (const match of content.matchAll(PROMPT_VARIABLE_PATTERN)) {
    const name = match[1]!;
    names.add(name);
    if (names.size > MAX_VARIABLES) break;
    const replacement = supplied.get(name) ?? match[0];
    renderedLength += match.index - end + replacement.length;
    if (renderedLength > MAX_RENDERED_LENGTH) break;
    segments.push(content.slice(end, match.index), replacement);
    end = match.index + match[0].length;
  }
  segments.push(content.slice(end));
  return segments.join("");
}
