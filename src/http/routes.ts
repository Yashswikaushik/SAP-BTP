import { CredentialType, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tokenManager } from '../auth/tokenManager.js';
import { prisma } from '../db/prisma.js';
import { getIntegration, listIntegrations } from '../integrations/registry.js';
import { metricsText } from '../observability/metrics.js';
import { webhookService } from '../webhooks/service.js';
import { workflowDefinitionSchema } from '../workflows/definition.js';
import { workflowService } from '../workflows/service.js';

const tenantHeader = z.object({ 'x-tenant-id': z.string().min(1) }).passthrough();

export async function routes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => { await prisma.$queryRaw`SELECT 1`; return { ok: true }; });
  app.get('/metrics', async (_request, reply) => reply.type('text/plain').send(await metricsText()));

  app.post('/tenants', async (request) => {
    const body = z.object({ id: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    return prisma.tenant.upsert({ where: { id: body.id }, update: { name: body.name }, create: body });
  });

  app.get('/integrations', async () => ({ integrations: listIntegrations() }));

  app.post('/credentials', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const body = z.object({ provider: z.string(), type: z.nativeEnum(CredentialType), accessToken: z.string().optional(), refreshToken: z.string().optional(), apiKey: z.string().optional(), expiresAt: z.string().datetime().optional(), metadata: z.record(z.unknown()).optional() }).parse(request.body);
    await prisma.tenant.upsert({ where: { id: headers['x-tenant-id'] }, update: {}, create: { id: headers['x-tenant-id'], name: headers['x-tenant-id'] } });
    return tokenManager.upsertCredential({ ...body, tenantId: headers['x-tenant-id'], expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined, metadata: body.metadata as Prisma.InputJsonValue });
  });

  app.post('/integrations/:provider/actions/:action', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const params = z.object({ provider: z.string(), action: z.string() }).parse(request.params);
    const adapter = getIntegration(params.provider);
    if (!adapter) return app.httpErrors.notFound('Integration not registered');
    return adapter.execute({ tenantId: headers['x-tenant-id'], action: params.action, input: (request.body ?? {}) as Record<string, unknown>, correlationId: request.id });
  });

  app.post('/workflows', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const body = z.object({ name: z.string(), definition: workflowDefinitionSchema }).parse(request.body);
    return workflowService.createWorkflow(headers['x-tenant-id'], body.name, body.definition as Prisma.InputJsonValue);
  });

  app.post('/workflows/:id/runs', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const params = z.object({ id: z.string() }).parse(request.params);
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined;
    return workflowService.triggerWorkflow(params.id, headers['x-tenant-id'], (request.body ?? {}) as Prisma.InputJsonValue, request.id, idempotencyKey);
  });

  app.get('/workflows/runs/:id', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const params = z.object({ id: z.string() }).parse(request.params);
    return prisma.workflowRun.findFirstOrThrow({ where: { id: params.id, tenantId: headers['x-tenant-id'] }, include: { stepRuns: true } });
  });

  app.post('/webhooks/:endpointId', async (request) => {
    const headers = tenantHeader.parse(request.headers);
    const params = z.object({ endpointId: z.string() }).parse(request.params);
    const signature = typeof request.headers['x-webhook-signature'] === 'string' ? request.headers['x-webhook-signature'] : undefined;
    return webhookService.ingest(params.endpointId, headers['x-tenant-id'], request.body, request.id, signature);
  });
}
