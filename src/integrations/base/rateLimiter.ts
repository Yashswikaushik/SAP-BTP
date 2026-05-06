import { redis } from '../../queues/connection.js';
import { RateLimitError } from '../../http/errors.js';

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export const defaultRateLimitPolicy: RateLimitPolicy = {
  limit: 120,
  windowMs: 60_000
};

export class IntegrationRateLimiter {
  async consume(tenantId: string, provider: string, policy: RateLimitPolicy = defaultRateLimitPolicy): Promise<void> {
    const key = `rate-limit:${tenantId}:${provider}`;
    const now = Date.now();
    const oldest = now - policy.windowMs;
    const member = `${now}:${Math.random()}`;
    const result = await redis.multi()
      .zremrangebyscore(key, 0, oldest)
      .zcard(key)
      .zadd(key, now, member)
      .pexpire(key, policy.windowMs)
      .exec();
    const count = Number(result?.[1]?.[1] ?? 0);
    if (count >= policy.limit) {
      await redis.zrem(key, member);
      throw new RateLimitError(policy.windowMs, { provider, tenantId, limit: policy.limit });
    }
  }
}

export const integrationRateLimiter = new IntegrationRateLimiter();
