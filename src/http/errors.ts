export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code = 'APP_ERROR', public details?: unknown) {
    super(message);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterMs: number, details?: unknown) {
    super(429, 'Upstream rate limit exceeded', 'UPSTREAM_RATE_LIMIT', { retryAfterMs, details });
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, message, 'INTEGRATION_ERROR', details);
  }
}
