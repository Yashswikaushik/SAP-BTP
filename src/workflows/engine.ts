import { Prisma, StepRunStatus, WorkflowRunStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { AppError } from '../http/errors.js';
import { getIntegration } from '../integrations/registry.js';
import { logger } from '../logging/logger.js';
import { workflowDefinitionSchema } from './definition.js';
import { WorkflowDefinition, WorkflowStep } from './types.js';

function mergeContext(input: Record<string, unknown> | undefined, context: Record<string, unknown>) {
  return { ...(input ?? {}), context };
}

export class WorkflowEngine {
  async executeRun(workflowRunId: string): Promise<void> {
    const run = await prisma.workflowRun.findUnique({ include: { workflow: true }, where: { id: workflowRunId } });
    if (!run) throw new AppError(404, 'Workflow run not found', 'WORKFLOW_RUN_NOT_FOUND');
    const definition = workflowDefinitionSchema.parse(run.workflow.definition) as WorkflowDefinition;
    const context: Record<string, unknown> = { input: run.input, steps: {} };
    await prisma.workflowRun.update({ where: { id: run.id }, data: { status: WorkflowRunStatus.RUNNING, startedAt: new Date() } });

    let current: WorkflowStep | undefined = definition.steps[0];
    const visited = new Set<string>();
    try {
      while (current) {
        if (visited.has(current.id)) throw new AppError(400, `Workflow cycle detected at ${current.id}`, 'WORKFLOW_CYCLE_DETECTED');
        visited.add(current.id);
        try {
          const output = await this.executeStep(run.id, run.tenantId, run.correlationId, current, context);
          context.steps = { ...(context.steps as Record<string, unknown>), [current.id]: output };
          current = this.resolveNextStep(definition, current, context);
        } catch (error) {
          const failedStep = current;
          if (!failedStep) throw error;
          if (!failedStep.onFailure) throw error;
          context.steps = { ...(context.steps as Record<string, unknown>), [failedStep.id]: { error: serializeError(error) } };
          current = definition.steps.find((step) => step.id === failedStep.onFailure);
        }
      }
      await prisma.workflowRun.update({ where: { id: run.id }, data: { status: WorkflowRunStatus.SUCCEEDED, output: context as Prisma.InputJsonValue, finishedAt: new Date() } });
    } catch (error) {
      logger.error({ error, workflowRunId }, 'workflow run failed');
      await prisma.workflowRun.update({ where: { id: run.id }, data: { status: WorkflowRunStatus.FAILED, error: serializeError(error), finishedAt: new Date() } });
      throw error;
    }
  }

  private resolveNextStep(definition: WorkflowDefinition, step: WorkflowStep, context: Record<string, unknown>): WorkflowStep | undefined {
    if (step.when) {
      const value = readPath(context, step.when.left);
      const passed = step.when.operator === 'exists'
        ? value !== undefined && value !== null
        : step.when.operator === 'equals'
          ? value === step.when.right
          : value !== step.when.right;
      const target = passed ? step.when.next : step.when.otherwise;
      if (target) return definition.steps.find((candidate) => candidate.id === target);
    }
    return step.next ? definition.steps.find((candidate) => candidate.id === step.next) : undefined;
  }

  private async executeStep(workflowRunId: string, tenantId: string, correlationId: string, step: WorkflowStep, context: Record<string, unknown>): Promise<unknown> {
    const stepRun = await prisma.stepRun.create({ data: { workflowRunId, stepId: step.id, status: StepRunStatus.RUNNING, startedAt: new Date(), input: mergeContext(step.input, context) as Prisma.InputJsonValue } });
    try {
      let output: unknown;
      if (step.type === 'delay') {
        const ms = Number(step.input?.ms ?? 1000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        output = { delayedMs: ms };
      } else if (step.type === 'condition') {
        output = { passed: step.when ? readPath(context, step.when.left) === step.when.right : Boolean(step.input?.passed ?? true) };
      } else {
        const provider = step.type === 'agent' ? 'ai' : step.provider;
        if (!provider || !step.action) throw new AppError(400, `Step ${step.id} is missing provider/action`, 'STEP_INVALID');
        const adapter = getIntegration(provider);
        if (!adapter) throw new AppError(404, `Integration ${provider} not registered`, 'INTEGRATION_NOT_FOUND');
        output = await adapter.execute({ tenantId, action: step.action, input: mergeContext(step.input, context), correlationId });
      }
      await prisma.stepRun.update({ where: { id: stepRun.id }, data: { status: StepRunStatus.SUCCEEDED, attempts: { increment: 1 }, output: output as Prisma.InputJsonValue, finishedAt: new Date() } });
      return output;
    } catch (error) {
      await prisma.stepRun.update({ where: { id: stepRun.id }, data: { status: StepRunStatus.FAILED, attempts: { increment: 1 }, error: serializeError(error), finishedAt: new Date() } });
      throw error;
    }
  }
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function serializeError(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

export const workflowEngine = new WorkflowEngine();
