import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from '../src/webhooks/signature.js';

describe('webhook signatures', () => {
  it('verifies hmac signatures', () => {
    const payload = '{"ok":true}';
    const signature = signPayload('secret', payload);
    expect(() => verifySignature('secret', payload, signature)).not.toThrow();
    expect(() => verifySignature('secret', payload, 'bad')).toThrow();
  });
});
