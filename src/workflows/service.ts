import { nanoid } from 'nanoid';
import { Prisma, WorkflowStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { workflowQueue, defaultJobOptions } from '../queues/queues.js';
import { workflowDefinitionSchema } from './definition.js';

export class WorkflowService {
  async createWorkflow(tenantId: string, name: string, definition: Prisma.InputJsonValue) {
    const parsed = workflowDefinitionSchema.parse(definition);
    await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: tenantId } });
    return prisma.workflow.create({ data: { tenantId, name, definition: parsed as Prisma.InputJsonValue, status: WorkflowStatus.ACTIVE } });
  }

  async triggerWorkflow(workflowId: string, tenantId: string, input: Prisma.InputJsonValue, correlationId = nanoid(), idempotencyKey?: string) {
    await prisma.workflow.findFirstOrThrow({ where: { id: workflowId, tenantId, status: WorkflowStatus.ACTIVE } });
    const run = idempotencyKey
      ? await prisma.workflowRun.upsert({
        where: { tenantId_workflowId_idempotencyKey: { tenantId, workflowId, idempotencyKey } },
        create: { workflowId, tenantId, input, correlationId, idempotencyKey },
        update: {}
      })
      : await prisma.workflowRun.create({ data: { workflowId, tenantId, input, correlationId } });
    if (run.status === 'QUEUED') {
      await workflowQueue.add('execute', { workflowRunId: run.id, tenantId, correlationId }, { ...defaultJobOptions, jobId: run.id });
    }
    return run;
  }
}

export const workflowService = new WorkflowService();
