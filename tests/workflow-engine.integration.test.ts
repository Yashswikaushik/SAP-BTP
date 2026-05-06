import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Prisma, WorkflowRunStatus, StepRunStatus, WorkflowStatus } from '@prisma/client';

// Environment setup
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/orchestrator_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.TOKEN_ENCRYPTION_KEY = 'test-key-with-at-least-32-characters-12345';
process.env.API_AUTH_TOKEN = 'test-api-token-with-16-chars';
process.env.WEBHOOK_SIGNING_SECRET = 'test-webhook-secret';

import { prisma } from '../src/db/prisma.js';
import { WorkflowService } from '../src/workflows/service.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { IntegrationAdapter, IntegrationActionRequest, IntegrationActionResult } from '../src/integrations/base/types.js';
import { registerIntegration, getIntegration } from '../src/integrations/registry.js';
import { AppError } from '../src/http/errors.js';

// Mock Adapter for testing workflows
class MockIntegrationAdapter implements IntegrationAdapter {
  provider: string;
  private executionLog: Array<{ action: string; input: Record<string, unknown>; timestamp: Date }> = [];
  private responseMap: Map<string, IntegrationActionResult> = new Map();
  private failureMap: Map<string, Error> = new Map();

  constructor(provider: string) {
    this.provider = provider;
  }

  setResponse(action: string, response: IntegrationActionResult): void {
    this.responseMap.set(action, response);
  }

  setFailure(action: string, error: Error): void {
    this.failureMap.set(action, error);
  }

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    this.executionLog.push({
      action: request.action,
      input: request.input,
      timestamp: new Date()
    });

    if (this.failureMap.has(request.action)) {
      throw this.failureMap.get(request.action);
    }

    const response = this.responseMap.get(request.action);
    if (!response) {
      throw new AppError(404, `Action ${request.action} not configured`, 'ACTION_NOT_FOUND');
    }

    return response;
  }

  getExecutionLog(): Array<{ action: string; input: Record<string, unknown>; timestamp: Date }> {
    return this.executionLog;
  }

  reset(): void {
    this.executionLog = [];
    this.responseMap.clear();
    this.failureMap.clear();
  }
}

describe('Workflow Engine Integration Tests', () => {
  const tenantId = 'test-tenant-workflow';
  const workflowService = new WorkflowService();
  const workflowEngine = new WorkflowEngine();
  let mockSlackAdapter: MockIntegrationAdapter;
  let mockWebhookAdapter: MockIntegrationAdapter;

  beforeEach(() => {
    // Create mock adapters
    mockSlackAdapter = new MockIntegrationAdapter('slack');
    mockWebhookAdapter = new MockIntegrationAdapter('webhook');

    // Register them
    registerIntegration(mockSlackAdapter);
    registerIntegration(mockWebhookAdapter);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await prisma.stepRun.deleteMany({});
      await prisma.workflowRun.deleteMany({});
      await prisma.workflow.deleteMany({});
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    } catch (error) {
      // Cleanup errors are expected if tables don't exist
    }

    mockSlackAdapter.reset();
    mockWebhookAdapter.reset();
  });

  describe('Sequential Workflow Execution', () => {
    it('executes multiple steps in order', async () => {
      // Setup mock responses
      mockSlackAdapter.setResponse('send-message', {
        provider: 'slack',
        action: 'send-message',
        data: { channel: 'C123', message_ts: '1234567890.000100' }
      });

      mockWebhookAdapter.setResponse('trigger', {
        provider: 'webhook',
        action: 'trigger',
        data: { status: 'triggered' }
      });

      // Create workflow
      const workflow = await workflowService.createWorkflow(tenantId, 'Sequential Workflow', {
        trigger: { type: 'api' },
        steps: [
          {
            id: 'step1',
            type: 'integration',
            provider: 'slack',
            action: 'send-message',
            input: { channel: 'C123', text: 'Starting workflow' },
            next: 'step2'
          },
          {
            id: 'step2',
            type: 'integration',
            provider: 'webhook',
            action: 'trigger',
            input: { event: 'workflow-progress' }
          }
        ]
      });

      // Trigger workflow
      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { initialData: 'test' });

      // Execute workflow
      await workflowEngine.executeRun(run.id);

      // Verify
      const updatedRun = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        include: { stepRuns: true }
      });

      expect(updatedRun?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(updatedRun?.stepRuns).toHaveLength(2);
      expect(updatedRun?.stepRuns[0]?.status).toBe(StepRunStatus.SUCCEEDED);
      expect(updatedRun?.stepRuns[1]?.status).toBe(StepRunStatus.SUCCEEDED);

      // Verify execution order
      expect(mockSlackAdapter.getExecutionLog()).toHaveLength(1);
      expect(mockWebhookAdapter.getExecutionLog()).toHaveLength(1);
    });

    it('preserves and passes context between steps', async () => {
      mockSlackAdapter.setResponse('send-message', {
        provider: 'slack',
        action: 'send-message',
        data: { message: 'Step 1 complete', id: 'step1-result-123' }
      });

      mockWebhookAdapter.setResponse('notify', {
        provider: 'webhook',
        action: 'notify',
        data: { notified: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Context Flow', {
        steps: [
          {
            id: 'collect-data',
            type: 'integration',
            provider: 'slack',
            action: 'send-message',
            input: { message: 'Initial message' },
            next: 'use-previous-output'
          },
          {
            id: 'use-previous-output',
            type: 'integration',
            provider: 'webhook',
            action: 'notify',
            input: { previousStepOutput: 'context.steps.collect-data' }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { input: 'test-data' });
      await workflowEngine.executeRun(run.id);

      const updatedRun = await prisma.workflowRun.findUnique({
        where: { id: run.id }
      });

      // Verify context contains both step outputs
      expect(updatedRun?.output).toBeDefined();
      const output = updatedRun?.output as Record<string, unknown>;
      expect(output?.steps).toBeDefined();
      const steps = output?.steps as Record<string, unknown>;
      expect(steps?.['collect-data']).toBeDefined();
      expect(steps?.['use-previous-output']).toBeDefined();
    });
  });

  describe('Conditional Routing', () => {
    it('routes to next step when condition equals value is true', async () => {
      mockSlackAdapter.setResponse('send-approved', {
        provider: 'slack',
        action: 'send-approved',
        data: { status: 'approved' }
      });

      mockWebhookAdapter.setResponse('send-rejected', {
        provider: 'webhook',
        action: 'send-rejected',
        data: { status: 'rejected' }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Conditional Workflow', {
        steps: [
          {
            id: 'check-approval',
            type: 'condition',
            when: {
              left: 'input.approved',
              operator: 'equals',
              right: true,
              next: 'send-approved',
              otherwise: 'send-rejected'
            }
          },
          {
            id: 'send-approved',
            type: 'integration',
            provider: 'slack',
            action: 'send-approved'
          },
          {
            id: 'send-rejected',
            type: 'integration',
            provider: 'webhook',
            action: 'send-rejected'
          }
        ]
      });

      // Test with approved=true
      const run1 = await workflowService.triggerWorkflow(workflow.id, tenantId, { approved: true });
      await workflowEngine.executeRun(run1.id);

      const result1 = await prisma.workflowRun.findUnique({
        where: { id: run1.id },
        include: { stepRuns: true }
      });

      expect(result1?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(result1?.stepRuns).toHaveLength(2); // check-approval + send-approved
      expect(mockSlackAdapter.getExecutionLog()).toHaveLength(1);
      expect(mockWebhookAdapter.getExecutionLog()).toHaveLength(0);
    });

    it('routes to otherwise step when condition equals value is false', async () => {
      mockSlackAdapter.setResponse('send-approved', {
        provider: 'slack',
        action: 'send-approved',
        data: { status: 'approved' }
      });

      mockWebhookAdapter.setResponse('send-rejected', {
        provider: 'webhook',
        action: 'send-rejected',
        data: { status: 'rejected' }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Conditional Otherwise', {
        steps: [
          {
            id: 'check-approval',
            type: 'condition',
            when: {
              left: 'input.approved',
              operator: 'equals',
              right: true,
              next: 'send-approved',
              otherwise: 'send-rejected'
            }
          },
          {
            id: 'send-approved',
            type: 'integration',
            provider: 'slack',
            action: 'send-approved'
          },
          {
            id: 'send-rejected',
            type: 'integration',
            provider: 'webhook',
            action: 'send-rejected'
          }
        ]
      });

      // Test with approved=false
      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { approved: false });
      await workflowEngine.executeRun(run.id);

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        include: { stepRuns: true }
      });

      expect(result?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(mockSlackAdapter.getExecutionLog()).toHaveLength(0);
      expect(mockWebhookAdapter.getExecutionLog()).toHaveLength(1);
    });

    it('handles notEquals operator correctly', async () => {
      mockSlackAdapter.setResponse('process', {
        provider: 'slack',
        action: 'process',
        data: { result: 'processed' }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'NotEquals Workflow', {
        steps: [
          {
            id: 'check-status',
            type: 'condition',
            when: {
              left: 'input.status',
              operator: 'notEquals',
              right: 'error',
              next: 'process',
              otherwise: 'skip'
            }
          },
          {
            id: 'process',
            type: 'integration',
            provider: 'slack',
            action: 'process'
          },
          {
            id: 'skip',
            type: 'delay',
            input: { ms: 10 }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { status: 'success' });
      await workflowEngine.executeRun(run.id);

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        include: { stepRuns: true }
      });

      expect(result?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(mockSlackAdapter.getExecutionLog()).toHaveLength(1); // Process was called
    });

    it('handles exists operator for presence checking', async () => {
      mockSlackAdapter.setResponse('send-notification', {
        provider: 'slack',
        action: 'send-notification',
        data: { notified: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Exists Workflow', {
        steps: [
          {
            id: 'check-email',
            type: 'condition',
            when: {
              left: 'input.email',
              operator: 'exists',
              next: 'notify-user',
              otherwise: 'skip'
            }
          },
          {
            id: 'notify-user',
            type: 'integration',
            provider: 'slack',
            action: 'send-notification'
          },
          {
            id: 'skip',
            type: 'delay',
            input: { ms: 10 }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { email: 'test@example.com' });
      await workflowEngine.executeRun(run.id);

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id }
      });

      expect(result?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(mockSlackAdapter.getExecutionLog()).toHaveLength(1);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('captures integration step errors', async () => {
      mockSlackAdapter.setFailure('send-message', new Error('Failed to send message'));

      const workflow = await workflowService.createWorkflow(tenantId, 'Error Workflow', {
        steps: [
          {
            id: 'risky-step',
            type: 'integration',
            provider: 'slack',
            action: 'send-message'
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, {});

      try {
        await workflowEngine.executeRun(run.id);
      } catch (error) {
        // Expected to throw
      }

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id }
      });

      expect(result?.status).toBe(WorkflowRunStatus.FAILED);
      expect(result?.error).toBeDefined();
    });

    it('executes onFailure handler when step fails', async () => {
      mockSlackAdapter.setFailure('risky-action', new Error('Something went wrong'));
      mockWebhookAdapter.setResponse('handle-error', {
        provider: 'webhook',
        action: 'handle-error',
        data: { handled: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Error Recovery', {
        steps: [
          {
            id: 'risky-step',
            type: 'integration',
            provider: 'slack',
            action: 'risky-action',
            onFailure: 'handle-error'
          },
          {
            id: 'handle-error',
            type: 'integration',
            provider: 'webhook',
            action: 'handle-error'
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, {});
      await workflowEngine.executeRun(run.id);

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        include: { stepRuns: true }
      });

      expect(result?.status).toBe(WorkflowRunStatus.SUCCEEDED); // Overall succeeded due to recovery
      expect(result?.stepRuns).toHaveLength(2);
      expect(result?.stepRuns[0]?.status).toBe(StepRunStatus.FAILED); // First step failed
      expect(result?.stepRuns[1]?.status).toBe(StepRunStatus.SUCCEEDED); // Recovery succeeded
      expect(mockWebhookAdapter.getExecutionLog()).toHaveLength(1); // Handler was called
    });

    it('propagates error when no onFailure handler defined', async () => {
      mockSlackAdapter.setFailure('send-message', new Error('Network error'));

      const workflow = await workflowService.createWorkflow(tenantId, 'Unhandled Error', {
        steps: [
          {
            id: 'failing-step',
            type: 'integration',
            provider: 'slack',
            action: 'send-message'
            // No onFailure handler
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, {});

      try {
        await workflowEngine.executeRun(run.id);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id }
      });

      expect(result?.status).toBe(WorkflowRunStatus.FAILED);
    });
  });

  describe('Cycle Detection', () => {
    it('detects and prevents workflow cycles', async () => {
      // Note: In practice, the schema validation should prevent this,
      // but we test the cycle detection in the engine as well
      mockSlackAdapter.setResponse('step1', {
        provider: 'slack',
        action: 'step1',
        data: { done: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Cycle Detection', {
        steps: [
          {
            id: 'step1',
            type: 'integration',
            provider: 'slack',
            action: 'step1',
            next: 'step2'
          },
          {
            id: 'step2',
            type: 'condition',
            when: {
              left: 'input.loop',
              operator: 'equals',
              right: true,
              next: 'step1', // Creates cycle
              otherwise: 'end'
            }
          },
          {
            id: 'end',
            type: 'delay',
            input: { ms: 10 }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { loop: true });

      try {
        await workflowEngine.executeRun(run.id);
        expect.fail('Should have detected cycle');
      } catch (error) {
        expect((error as Error).message).toContain('cycle');
      }

      const result = await prisma.workflowRun.findUnique({
        where: { id: run.id }
      });

      expect(result?.status).toBe(WorkflowRunStatus.FAILED);
    });
  });

  describe('Idempotency', () => {
    it('prevents duplicate workflow executions with idempotency key', async () => {
      mockSlackAdapter.setResponse('send', {
        provider: 'slack',
        action: 'send',
        data: { sent: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Idempotent Workflow', {
        steps: [
          {
            id: 'send-message',
            type: 'integration',
            provider: 'slack',
            action: 'send'
          }
        ]
      });

      const idempotencyKey = 'test-key-123';

      // Trigger twice with same idempotency key
      const run1 = await workflowService.triggerWorkflow(workflow.id, tenantId, { data: 'test' }, undefined, idempotencyKey);
      const run2 = await workflowService.triggerWorkflow(workflow.id, tenantId, { data: 'test' }, undefined, idempotencyKey);

      // Should return the same run ID
      expect(run1.id).toBe(run2.id);
      expect(run1.idempotencyKey).toBe(idempotencyKey);
    });
  });

  describe('Step Execution Recording', () => {
    it('records all step executions with metadata', async () => {
      mockSlackAdapter.setResponse('action1', {
        provider: 'slack',
        action: 'action1',
        data: { result: 'step1' }
      });

      mockWebhookAdapter.setResponse('action2', {
        provider: 'webhook',
        action: 'action2',
        data: { result: 'step2' }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Recording Workflow', {
        steps: [
          {
            id: 'step1',
            type: 'integration',
            provider: 'slack',
            action: 'action1',
            next: 'step2'
          },
          {
            id: 'step2',
            type: 'integration',
            provider: 'webhook',
            action: 'action2'
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { input: 'test' });
      await workflowEngine.executeRun(run.id);

      const stepRuns = await prisma.stepRun.findMany({
        where: { workflowRunId: run.id },
        orderBy: { startedAt: 'asc' }
      });

      expect(stepRuns).toHaveLength(2);
      expect(stepRuns[0]?.stepId).toBe('step1');
      expect(stepRuns[0]?.status).toBe(StepRunStatus.SUCCEEDED);
      expect(stepRuns[0]?.startedAt).toBeDefined();
      expect(stepRuns[0]?.finishedAt).toBeDefined();
      expect(stepRuns[0]?.output).toBeDefined();

      expect(stepRuns[1]?.stepId).toBe('step2');
      expect(stepRuns[1]?.status).toBe(StepRunStatus.SUCCEEDED);
    });
  });

  describe('Complex Workflow Scenarios', () => {
    it('handles workflows with multiple conditional branches', async () => {
      mockSlackAdapter.setResponse('process-low', {
        provider: 'slack',
        action: 'process-low',
        data: { priority: 'low' }
      });

      mockSlackAdapter.setResponse('process-high', {
        provider: 'slack',
        action: 'process-high',
        data: { priority: 'high' }
      });

      mockWebhookAdapter.setResponse('complete', {
        provider: 'webhook',
        action: 'complete',
        data: { completed: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Multi-Branch Workflow', {
        steps: [
          {
            id: 'check-priority',
            type: 'condition',
            when: {
              left: 'input.priority',
              operator: 'equals',
              right: 'high',
              next: 'process-high',
              otherwise: 'process-low'
            }
          },
          {
            id: 'process-high',
            type: 'integration',
            provider: 'slack',
            action: 'process-high',
            next: 'complete'
          },
          {
            id: 'process-low',
            type: 'integration',
            provider: 'slack',
            action: 'process-low',
            next: 'complete'
          },
          {
            id: 'complete',
            type: 'integration',
            provider: 'webhook',
            action: 'complete'
          }
        ]
      });

      // Test high priority
      const run1 = await workflowService.triggerWorkflow(workflow.id, tenantId, { priority: 'high' });
      await workflowEngine.executeRun(run1.id);

      const result1 = await prisma.workflowRun.findUnique({
        where: { id: run1.id },
        include: { stepRuns: true }
      });

      expect(result1?.status).toBe(WorkflowRunStatus.SUCCEEDED);
      expect(result1?.stepRuns).toHaveLength(3); // check-priority + process-high + complete

      // Verify order: check-priority -> process-high -> complete
      expect(result1?.stepRuns[0]?.stepId).toBe('check-priority');
      expect(result1?.stepRuns[1]?.stepId).toBe('process-high');
      expect(result1?.stepRuns[2]?.stepId).toBe('complete');
    });
  });

  describe('Adapter Integration', () => {
    it('calls correct adapter with step parameters', async () => {
      mockSlackAdapter.setResponse('post-message', {
        provider: 'slack',
        action: 'post-message',
        data: { success: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Adapter Call', {
        steps: [
          {
            id: 'send-slack',
            type: 'integration',
            provider: 'slack',
            action: 'post-message',
            input: { channel: '#general', text: 'Hello' }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, {});
      await workflowEngine.executeRun(run.id);

      const executionLog = mockSlackAdapter.getExecutionLog();

      expect(executionLog).toHaveLength(1);
      expect(executionLog[0]?.action).toBe('post-message');
      expect(executionLog[0]?.input?.channel).toBe('#general');
      expect(executionLog[0]?.input?.text).toBe('Hello');
    });

    it('proposes context to adapter through input merging', async () => {
      mockSlackAdapter.setResponse('notify', {
        provider: 'slack',
        action: 'notify',
        data: { notified: true }
      });

      const workflow = await workflowService.createWorkflow(tenantId, 'Context Merge', {
        steps: [
          {
            id: 'notify',
            type: 'integration',
            provider: 'slack',
            action: 'notify',
            input: { template: 'user-created' }
          }
        ]
      });

      const run = await workflowService.triggerWorkflow(workflow.id, tenantId, { userId: '123', userName: 'Alice' });
      await workflowEngine.executeRun(run.id);

      const executionLog = mockSlackAdapter.getExecutionLog();
      const input = executionLog[0]?.input as Record<string, unknown>;

      expect(input?.template).toBe('user-created');
      expect(input?.context).toBeDefined();
    });
  });
});
