import { AppError, RateLimitError } from '../../http/errors.js';

export type RetryPolicy = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5_000
};

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof AppError) return error.statusCode === 429 || error.statusCode >= 500;
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: number }).status) : undefined;
  return Boolean(status && (status === 429 || status >= 500));
}

export async function withRetry<T>(operation: () => Promise<T>, policy: RetryPolicy = defaultRetryPolicy): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === policy.attempts || !isRetryableError(error)) break;
      const retryAfterMs = error instanceof RateLimitError && typeof error.details === 'object' && error.details !== null && 'retryAfterMs' in error.details
        ? Number((error.details as { retryAfterMs: number }).retryAfterMs)
        : undefined;
      const jitter = Math.floor(Math.random() * 100);
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs ?? exponential + jitter));
    }
  }
  throw lastError;
}
