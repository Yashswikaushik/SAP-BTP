import pg from 'pg';
import { AppError } from '../../http/errors.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';
import { withRetry } from '../base/retry.js';

const { Pool } = pg;
const pools = new Map<string, pg.Pool>();
const MUTATION_PATTERN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|call)\b/i;

export class PostgresAdapter implements IntegrationAdapter {
  provider = 'postgresql';

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    const { connectionString, query, params = [], readOnly = true } = request.input as {
      connectionString?: string;
      query?: string;
      params?: unknown[];
      readOnly?: boolean;
    };
    if (!connectionString || !query) throw new AppError(400, 'PostgreSQL action requires connectionString and query', 'INVALID_POSTGRES_ACTION');
    if (readOnly && MUTATION_PATTERN.test(query)) throw new AppError(400, 'Read-only PostgreSQL action rejected mutation statement', 'POSTGRES_READONLY_VIOLATION');
    const pool = this.poolFor(connectionString);
    const started = Date.now();
    const result = await withRetry(() => pool.query(query, params));
    return {
      provider: this.provider,
      action: request.action,
      data: { rows: result.rows, rowCount: result.rowCount },
      metadata: { durationMs: Date.now() - started }
    };
  }

  private poolFor(connectionString: string): pg.Pool {
    const existing = pools.get(connectionString);
    if (existing) return existing;
    const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    pools.set(connectionString, pool);
    return pool;
  }
}
