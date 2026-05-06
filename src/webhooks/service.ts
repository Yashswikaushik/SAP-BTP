import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../http/errors.js';
import { workflowService } from '../workflows/service.js';
import { stablePayload, verifySignature } from './signature.js';

export class WebhookService {
  verify(secret: string, payload: string, signature: string): void {
    verifySignature(secret, payload, signature);
  }

  async ingest(endpointId: string, tenantId: string, payload: unknown, correlationId: string, signature?: string) {
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId, enabled: true } });
    if (!endpoint) throw new AppError(404, 'Webhook endpoint not found', 'WEBHOOK_ENDPOINT_NOT_FOUND');
    if (signature) this.verify(env.WEBHOOK_SIGNING_SECRET, stablePayload(payload), signature);
    if (!endpoint.workflowId) return { accepted: true, routed: false };
    const run = await workflowService.triggerWorkflow(endpoint.workflowId, tenantId, payload as never, correlationId, correlationId);
    return { accepted: true, routed: true, workflowRunId: run.id };
  }
}

export const webhookService = new WebhookService();
