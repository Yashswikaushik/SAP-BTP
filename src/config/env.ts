import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  API_AUTH_TOKEN: z.string().min(16),
  LOG_LEVEL: z.string().default('info'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  MCP_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
});

export type AppEnv = z.infer<typeof envSchema>;
export const env: AppEnv = envSchema.parse(process.env);
