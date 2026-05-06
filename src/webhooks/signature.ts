import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../http/errors.js';

export function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function stablePayload(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
}

export function verifySignature(secret: string, payload: string, signature: string): void {
  const expected = signPayload(secret, payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature.replace(/^sha256=/, ''));
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new AppError(401, 'Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
  }
}
