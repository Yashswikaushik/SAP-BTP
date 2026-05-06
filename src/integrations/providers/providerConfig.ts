import { RateLimitPolicy } from '../base/rateLimiter.js';

export type ProviderConfig = {
  baseUrl: string;
  authHeader?: 'authorization-bearer' | 'x-api-key' | 'none';
  defaultHeaders?: Record<string, string>;
  rateLimit?: RateLimitPolicy;
};

export const providerConfigs: Record<string, ProviderConfig> = {
  openai: { baseUrl: 'https://api.openai.com/v1', authHeader: 'authorization-bearer', rateLimit: { limit: 60, windowMs: 60_000 } },
  claude: { baseUrl: 'https://api.anthropic.com/v1', authHeader: 'x-api-key', defaultHeaders: { 'anthropic-version': '2023-06-01' }, rateLimit: { limit: 60, windowMs: 60_000 } },
  whatsapp: { baseUrl: 'https://graph.facebook.com/v20.0', authHeader: 'authorization-bearer' },
  gmail: { baseUrl: 'https://gmail.googleapis.com/gmail/v1', authHeader: 'authorization-bearer' },
  'google-drive': { baseUrl: 'https://www.googleapis.com/drive/v3', authHeader: 'authorization-bearer' },
  slack: { baseUrl: 'https://slack.com/api', authHeader: 'authorization-bearer', rateLimit: { limit: 50, windowMs: 60_000 } },
  notion: { baseUrl: 'https://api.notion.com/v1', authHeader: 'authorization-bearer', defaultHeaders: { 'Notion-Version': '2022-06-28' }, rateLimit: { limit: 90, windowMs: 60_000 } },
  github: { baseUrl: 'https://api.github.com', authHeader: 'authorization-bearer', defaultHeaders: { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }, rateLimit: { limit: 300, windowMs: 60_000 } },
  supabase: { baseUrl: 'https://api.supabase.com/v1', authHeader: 'authorization-bearer' }
};
