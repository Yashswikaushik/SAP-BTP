import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/orchestrator';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.TOKEN_ENCRYPTION_KEY = 'test-key-with-at-least-32-characters';
process.env.API_AUTH_TOKEN = 'test-api-token-with-16-chars';
process.env.WEBHOOK_SIGNING_SECRET = 'test-webhook-secret';

describe('secret encryption', () => {
  it('round trips encrypted secrets without returning plaintext payloads', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/auth/crypto.js');
    const secret = 'super-sensitive-token';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });
});
