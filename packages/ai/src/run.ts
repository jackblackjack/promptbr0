/**
 * Prompt execution over the AI SDK. Raw SDK errors never cross this boundary:
 * everything is normalized to { message, code? }.
 */
import { generateText, streamText, type LanguageModel } from "ai";

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface RunPromptRequest {
  model: LanguageModel;
  prompt: string;
  maxOutputTokens?: number;
  /** AI SDK retry attempts on retryable failures (default: SDK default). */
  maxRetries?: number;
  /** Cancellation/timeout signal (e.g. AbortSignal.timeout(120_000)). */
  signal?: AbortSignal;
}

export interface RunPromptResult {
  text: string;
  usage: TokenUsage;
  latencyMs: number;
}

/** Normalized error shape returned to callers instead of raw SDK errors. */
export interface NormalizedError {
  message: string;
  code?: string;
}

/** Error thrown by runPrompt; carries the normalized shape. */
export class PromptRunError extends Error implements NormalizedError {
  readonly code?: string;
  constructor(normalized: NormalizedError) {
    super(normalized.message);
    this.name = "PromptRunError";
    if (normalized.code !== undefined) this.code = normalized.code;
  }
}

/**
 * Deepest useful message on the `.cause` chain (walked up to 3 levels), or
 * null. A message that the top-level error already includes adds nothing.
 */
function rootCauseMessage(error: Error): string | null {
  let cause: unknown = (error as { cause?: unknown }).cause;
  let message: string | null = null;
  for (let depth = 0; depth < 3 && cause instanceof Error; depth++) {
    if (!error.message.includes(cause.message)) message = cause.message;
    cause = (cause as { cause?: unknown }).cause;
  }
  return message;
}

/** Converts any thrown value into a { message, code? } pair. */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof PromptRunError) {
    return error.code !== undefined ? { message: error.message, code: error.code } : { message: error.message };
  }
  if (error instanceof Error) {
    const extra = error as Error & { statusCode?: unknown; code?: unknown };
    const status = typeof extra.statusCode === "number" ? extra.statusCode : undefined;
    const cause = rootCauseMessage(error);
    const causeMessage = cause !== null ? `: ${cause}` : "";
    if (error.name === "TimeoutError") {
      return { message: "Request timed out", code: "aborted" };
    }
    if (error.name === "AbortError") {
      return { message: "Request cancelled", code: "aborted" };
    }
    if (status !== undefined) {
      return {
        message: `Provider request failed (HTTP ${status}): ${error.message}${causeMessage}`,
        code: `http-${status}`,
      };
    }
    if (typeof extra.code === "string") {
      return { message: `${error.message}${causeMessage}`, code: extra.code };
    }
    return { message: `${error.message}${causeMessage}` };
  }
  return { message: String(error) };
}

/** Runs a single prompt; throws PromptRunError on failure. */
export async function runPrompt(request: RunPromptRequest): Promise<RunPromptResult> {
  const startedAt = performance.now();
  try {
    const result = await generateText({
      model: request.model,
      prompt: request.prompt,
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.signal !== undefined ? { abortSignal: request.signal } : {}),
    });
    return {
      text: result.text,
      usage: {
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
      },
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    throw new PromptRunError(normalizeError(error));
  }
}

export interface StreamPromptRequest extends RunPromptRequest {
  /**
   * Called with the text accumulated so far (not just the delta) as tokens
   * stream in. Errors thrown here abort the stream.
   */
  onDelta?: (accumulated: string) => void;
  /**
   * Optional separate signal used by the caller to distinguish a user-initiated
   * cancel from a timeout abort.  When both text is present and *only* this
   * signal is aborted the stream is treated as a successful completion; if
   * neither this nor the main signal is aborted it is a timeout race.
   * When passed, the combined signal should be `AbortSignal.any([userSignal, timeout])`.
   */
  userAbortSignal?: AbortSignal;
}

/**
 * Streaming counterpart of runPrompt: consumes the AI SDK event stream,
 * reports accumulated text via onDelta, and resolves with the same result
 * shape. Mid-stream error parts and aborts normalize like runPrompt errors.
 *
 * When the abort signal fires **after** the stream has fully settled the
 * result is treated as completed (partial text is returned).  When the
 * abort fires **during** stream processing the stream is aborted as
 * expected — if text was already collected it is returned as partial
 * output; if no text was collected a cancellation error is returned.
 *
 * When `request.userAbortSignal` is provided the caller can distinguish
 * a user-initiated cancel from a timeout abort: if only the combined
 * signal is aborted but `userAbortSignal` is **not** aborted the result
 * is treated as completed (the timeout fired after the stream settled).
 */
export async function streamPrompt(request: StreamPromptRequest): Promise<RunPromptResult> {
  const startedAt = performance.now();
  let text = "";
  let result: Awaited<ReturnType<typeof streamText>> | undefined;
  try {
    result = streamText({
      model: request.model,
      prompt: request.prompt,
      // The event stream below surfaces the same error to our normalized boundary.
      // Avoid the SDK default handler dumping the raw provider error first.
      onError: () => undefined,
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
      ...(request.signal !== undefined ? { abortSignal: request.signal } : {}),
    });
    // The event stream (not textStream) keeps mid-stream provider errors visible.
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.text;
        request.onDelta?.(text);
      } else if (part.type === "error") {
        throw part.error;
      }
    }
    // The for-await completed without throwing.  The stream settled
    // naturally; if the abort signal fired afterwards (race with a
    // timeout or a late cancel) the accumulated text is valid.
    const usage = await result.usage;
    return {
      text,
      usage: {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
      },
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    // AbortError during stream: differentiate between a user-initiated
    // cancel and a timeout race.  If a separate userAbortSignal is
    // provided and only the combined signal is aborted (user signal
    // untouched) treat it as a completed stream; otherwise return
    // partial text or report cancellation.
    if (error instanceof Error && error.name === "AbortError") {
      // When a separate userAbortSignal is provided: if that signal is
      // aborted it means the user explicitly cancelled (error).  If only
      // the combined signal is aborted but the user signal is not, the
      // abort came from the timeout side and the result is treated as
      // completed.
      const isUserCancel = request.userAbortSignal
        ? request.userAbortSignal.aborted
        : request.signal?.aborted ?? false;

      if (text && result) {
        // User explicitly cancelled — this is an error even with partial text.
        if (isUserCancel) {
          throw new PromptRunError({ message: "Request cancelled", code: "aborted" });
        }
        // Timeout race: stream delivered text before timeout fired.
        try {
          const usage = await result.usage;
          return {
            text,
            usage: { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null },
            latencyMs: Math.round(performance.now() - startedAt),
          };
        } catch {
          // Even usage() can fail when the stream was aborted; return
          // partial text without usage rather than bubbling the error.
          return { text, usage: { inputTokens: null, outputTokens: null }, latencyMs: Math.round(performance.now() - startedAt) };
        }
      }
      throw new PromptRunError({ message: "Request cancelled", code: "aborted" });
    }
    throw new PromptRunError(normalizeError(error));
  }
}

export type SettledRunResult =
  | { status: "fulfilled"; value: RunPromptResult }
  | { status: "rejected"; reason: NormalizedError };
/**
 * Runs several prompts concurrently; results preserve input order and never
 * throw — failures arrive as rejected entries with normalized errors.
 */
export async function runPromptMany(requests: RunPromptRequest[]): Promise<SettledRunResult[]> {
  const settled = await Promise.allSettled(requests.map((request) => runPrompt(request)));
  return settled.map((entry): SettledRunResult => {
    if (entry.status === "fulfilled") return { status: "fulfilled", value: entry.value };
    return { status: "rejected", reason: normalizeError(entry.reason) };
  });
}
