import { tokenManager } from '../../auth/tokenManager.js';
import { AppError } from '../../http/errors.js';
import { createHttpClient } from '../base/httpClient.js';
import { integrationRateLimiter } from '../base/rateLimiter.js';
import { withRetry } from '../base/retry.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';
import { ProviderConfig } from './providerConfig.js';

export class RestAdapter implements IntegrationAdapter {
  public provider: string;

  constructor(provider: string, private config: ProviderConfig) {
    this.provider = provider;
  }

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    const { method = 'GET', path, body, query, headers = {} } = request.input as Record<string, unknown>;
    if (typeof path !== 'string') throw new AppError(400, 'REST action requires string path', 'INVALID_ACTION_INPUT');
    if (!path.startsWith('/')) throw new AppError(400, 'REST path must be relative and start with /', 'INVALID_ACTION_INPUT');

    await integrationRateLimiter.consume(request.tenantId, this.provider, this.config.rateLimit);
    await tokenManager.refreshOAuthIfNeeded(request.tenantId, this.provider);
    const authHeaders = await tokenManager.getAuthHeader(request.tenantId, this.provider, this.config.authHeader ?? 'authorization-bearer');
    const response = await withRetry(() => createHttpClient(this.config.baseUrl).request({
      method: String(method),
      url: path,
      data: body,
      params: query,
      headers: {
        ...this.config.defaultHeaders,
        ...authHeaders,
        ...(headers as Record<string, string>),
        'x-correlation-id': request.correlationId
      }
    }));
    return { provider: this.provider, action: request.action, data: response.data, metadata: { status: response.status } };
  }
}
