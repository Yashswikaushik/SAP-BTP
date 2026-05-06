import { Worker } from 'bullmq';
import { redis } from '../queues/connection.js';
import { workflowEngine } from '../workflows/engine.js';
import { logger } from '../logging/logger.js';
import { registerDefaultIntegrations } from '../integrations/registry.js';

registerDefaultIntegrations();

new Worker('workflow-execution', async (job) => workflowEngine.executeRun(job.data.workflowRunId), {
  connection: redis,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10)
}).on('failed', (job, error) => logger.error({ jobId: job?.id, error }, 'workflow job failed'))
  .on('completed', (job) => logger.info({ jobId: job.id }, 'workflow job completed'));

logger.info('workflow worker started');
