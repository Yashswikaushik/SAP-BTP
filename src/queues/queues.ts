import { Queue, JobsOptions } from 'bullmq';
import { redis } from './connection.js';

export type WorkflowJob = { workflowRunId: string; tenantId: string; correlationId: string };
export const workflowQueue = new Queue<WorkflowJob>('workflow-execution', { connection: redis });
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000
};
