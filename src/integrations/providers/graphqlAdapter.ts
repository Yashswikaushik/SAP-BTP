import { GraphQLClient } from 'graphql-request';
import { tokenManager } from '../../auth/tokenManager.js';
import { AppError } from '../../http/errors.js';
import { integrationRateLimiter } from '../base/rateLimiter.js';
import { withRetry } from '../base/retry.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';
import { ProviderConfig } from './providerConfig.js';

export class GraphqlAdapter implements IntegrationAdapter {
  public provider: string;

  constructor(provider: string, private endpoint: string, private config: Partial<ProviderConfig> = {}) {
    this.provider = provider;
  }

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    const { query, variables } = request.input as Record<string, unknown>;
    if (typeof query !== 'string') throw new AppError(400, 'GraphQL action requires query', 'INVALID_ACTION_INPUT');
    await integrationRateLimiter.consume(request.tenantId, this.provider, this.config.rateLimit);
    await tokenManager.refreshOAuthIfNeeded(request.tenantId, this.provider);
    const client = new GraphQLClient(this.endpoint, {
      headers: {
        ...this.config.defaultHeaders,
        ...await tokenManager.getAuthHeader(request.tenantId, this.provider, this.config.authHeader ?? 'authorization-bearer')
      }
    });
    const data = await withRetry(() => client.request(query, variables as Record<string, unknown> | undefined));
    return { provider: this.provider, action: request.action, data };
  }
}
