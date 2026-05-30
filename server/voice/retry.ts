/**
 * retry.ts — Generic retry utility with exponential backoff
 *
 * Used by voice pipeline components (Claude, Inworld TTS) to handle
 * transient failures without dropping the call.
 */

import logger from "../lib/logger";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  label: string;
  /** Only retry if this returns true for the error. Default: retry on 5xx and 429. */
  isRetryable?: (err: any) => boolean;
}

const DEFAULT_IS_RETRYABLE = (err: any): boolean => {
  // Retry on rate limits (429) and server errors (5xx)
  const status = err?.status || err?.statusCode || err?.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;

  // Retry on network errors
  const message = err?.message?.toLowerCase() || "";
  if (message.includes("econnreset") || message.includes("econnrefused")) return true;
  if (message.includes("timeout") || message.includes("socket hang up")) return true;

  return false;
};

/**
 * Execute a function with retry logic and exponential backoff.
 * Only retries on transient/retryable errors; throws immediately on 4xx/validation errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, label } = options;
  const isRetryable = options.isRetryable || DEFAULT_IS_RETRYABLE;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Don't retry non-retryable errors (4xx, validation, abort, etc.)
      if (err.name === "AbortError" || !isRetryable(err)) {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`[RETRY] ${label} attempt ${attempt + 1}/${maxRetries} failed: ${err.message}. Retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
