## Integration Tests for SAP-BTP

This directory contains comprehensive integration tests for the AI Automation Orchestration Core's workflow engine and provider adapters.

### Test Files

#### 1. **workflow-engine.integration.test.ts**
Tests the complete workflow execution lifecycle including:

- **Sequential Workflow Execution**: Verifies multi-step workflows execute in order
- **Context Preservation**: Ensures workflow context flows between steps
- **Conditional Routing**: Tests `condition` steps with `equals`, `notEquals`, and `exists` operators
- **Error Handling**: Validates `onFailure` error recovery paths
- **Cycle Detection**: Prevents infinite loops in workflow definitions
- **Integration Adapter Execution**: Verifies adapters are called with correct parameters
- **Idempotency**: Tests duplicate prevention with idempotency keys
- **Step Execution Recording**: Confirms all step executions are persisted with timing

**Key Features Tested:**
```typescript
// Sequential steps with context passing
steps: [
  { id: 'step1', type: 'integration', provider: 'slack', action: 'send-message', next: 'step2' },
  { id: 'step2', type: 'delay', input: { ms: 100 } }
]

// Conditional routing
steps: [
  {
    id: 'check',
    type: 'condition',
    when: {
      left: 'input.approved',
      operator: 'equals',
      right: true,
      next: 'approve',
      otherwise: 'reject'
    }
  }
]

// Error recovery
steps: [
  { id: 'risky', type: 'integration', provider: 'api', action: 'call', onFailure: 'handle-error' },
  { id: 'handle-error', type: 'integration', provider: 'slack', action: 'notify' }
]
```

#### 2. **adapter-integration.test.ts**
Tests provider adapter behavior including:

- **REST Request Execution**: Basic GET/POST operations
- **Security Validation**: Enforces relative paths and schema validation
- **Error Classification**: Identifies retryable vs. non-retryable errors
- **Retry Logic**: Tests exponential backoff with jitter
- **Rate Limiting**: Validates provider-specific rate limit configurations
- **Request Context**: Ensures tenant context and correlation IDs flow through requests
- **Query Parameters**: Tests parameterized REST calls
- **Custom Headers**: Validates header merging and propagation

**Key Features Tested:**
```typescript
// REST adapter safety
// Only allows relative paths: /users/123 ✅
// Blocks absolute URLs: https://example.com ❌

// Retry policy: 3 attempts with exponential backoff
attempts: 3
baseDelayMs: 250
maxDelayMs: 5000

// Retryable errors: 429, 5xx
// Non-retryable: 4xx (except 429)

// Correlation ID tracking
correlationId: 'corr-123' -> propagated to outbound requests
```

### Setup

#### Prerequisites
- PostgreSQL 14+ running
- Redis 6+ running
- Node.js 20+

#### Environment Configuration

1. Create a test database:
```bash
createdb orchestrator_test
```

2. Environment variables are set in each test file:
```typescript
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/orchestrator_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.TOKEN_ENCRYPTION_KEY = 'test-key-with-at-least-32-characters-12345';
process.env.API_AUTH_TOKEN = 'test-api-token-with-16-chars';
process.env.WEBHOOK_SIGNING_SECRET = 'test-webhook-secret';
```

### Running Tests

Run all integration tests:
```bash
npm test
```

Run specific test file:
```bash
npm test -- tests/workflow-engine.integration.test.ts
npm test -- tests/adapter-integration.test.ts
```

Run with watch mode:
```bash
npm test -- --watch
```

Run with coverage:
```bash
npm test -- --coverage
```

Run specific test suite:
```bash
npm test -- --grep "Sequential Workflow"
npm test -- --grep "Retry Logic"
```

### Test Architecture

#### Mock Adapters
Tests use a `MockIntegrationAdapter` that:
- Implements the `IntegrationAdapter` interface
- Returns configurable responses per action
- Records execution logs for verification
- Can be configured to fail for error testing

```typescript
const mockSlackAdapter = new MockIntegrationAdapter('slack', {
  'send-message': { channel: 'C123', message_ts: '1234567890.000100' }
});
```

#### Database Cleanup
Each test:
1. **beforeEach**: Clears step runs, workflow runs, workflows, and tenant data
2. **afterEach**: Cleans up test data to prevent interference

```typescript
await prisma.stepRun.deleteMany({});
await prisma.workflowRun.deleteMany({});
await prisma.workflow.deleteMany({});
await prisma.tenant.deleteMany({ where: { id: tenantId } });
```

#### Dependency Injection
Tests register mock adapters before each test:
```typescript
registerIntegration(mockSlackAdapter);
registerIntegration(mockWebhookAdapter);
```

### Test Scenarios

#### Scenario 1: Multi-Step Workflow with Context
**Purpose**: Verify workflow context flows between steps

```typescript
// Workflow Definition
{
  steps: [
    {
      id: 'collect',
      type: 'integration',
      provider: 'slack',
      action: 'send-message',
      input: { data: 'from-step-1' },
      next: 'verify'
    },
    {
      id: 'verify',
      type: 'integration',
      provider: 'webhook',
      action: 'trigger',
      input: { previousOutput: 'context.steps.collect' }  // References previous step
    }
  ]
}

// Workflow Run
const run = await workflowService.triggerWorkflow(workflowId, tenantId, { initialData: 'test' });
await workflowEngine.executeRun(run.id);

// Verification
expect(updatedRun.output.steps.collect).toBeDefined();
expect(updatedRun.output.steps.verify).toBeDefined();
```

#### Scenario 2: Error Recovery with onFailure
**Purpose**: Verify workflows can recover from errors

```typescript
// Workflow Definition
{
  steps: [
    {
      id: 'risky-step',
      type: 'integration',
      provider: 'failing-service',
      action: 'do-something',
      onFailure: 'handle-error'
    },
    {
      id: 'handle-error',
      type: 'integration',
      provider: 'slack',
      action: 'send-message',
      input: { text: 'Error occurred' }
    }
  ]
}

// Execution
await workflowEngine.executeRun(run.id);

// Verification
expect(updatedRun.status).toBe('SUCCEEDED');  // Overall workflow succeeded
expect(failedStep.status).toBe('FAILED');      // Step failed but error was handled
```

#### Scenario 3: Conditional Routing with Operators
**Purpose**: Verify condition evaluation and routing

```typescript
// Workflow Definition
{
  steps: [
    {
      id: 'check',
      type: 'condition',
      when: {
        left: 'input.approved',
        operator: 'equals',
        right: true,
        next: 'approve',
        otherwise: 'reject'
      }
    },
    { id: 'approve', type: 'integration', provider: 'slack', action: 'send-message' },
    { id: 'reject', type: 'delay', input: { ms: 50 } }
  ]
}

// With approved=true
const run1 = await workflowService.triggerWorkflow(workflowId, tenantId, { approved: true });
// Executes: check -> approve

// With approved=false
const run2 = await workflowService.triggerWorkflow(workflowId, tenantId, { approved: false });
// Executes: check -> reject
```

### Expected Behavior

#### Successful Workflow
```
Status: SUCCEEDED
Steps: All steps executed, each with StepRunStatus.SUCCEEDED
Output: Contains results from all steps (context.steps)
```

#### Failed Workflow (no error handler)
```
Status: FAILED
Steps: Failed step with StepRunStatus.FAILED, error details captured
Error: Contains error name, message, and stack
```

#### Failed Workflow (with error handler)
```
Status: SUCCEEDED (overall)
Steps: Failed step + recovery step executed
context.steps: Failed step error + recovery step result
```

#### Conditional Route (condition passes)
```
Steps executed: check + next branch
Otherwise branch: NOT executed
```

#### Cycle Detected
```
Error: "Workflow cycle detected at {stepId}"
Status: FAILED
Visited steps: Tracked to prevent re-visiting
```

### Debugging Tests

#### Enable Verbose Logging
```bash
npm test -- tests/workflow-engine.integration.test.ts --reporter=verbose
```

#### Check Step Run Details
```typescript
// In test
const stepRuns = await prisma.stepRun.findMany({
  where: { workflowRunId: run.id }
});
console.log(JSON.stringify(stepRuns, null, 2));
```

#### Verify Mock Adapter Calls
```typescript
// After workflow execution
console.log('Mock adapter execution log:', mockSlackAdapter.getExecutionLog());
```

#### Check Database State
```typescript
const workflow = await prisma.workflow.findUnique({
  where: { id: workflowId }
});
console.log('Workflow definition:', JSON.stringify(workflow.definition, null, 2));
```

### Common Issues and Solutions

#### Issue: Tests timeout
**Solution**: Increase Vitest timeout or check Redis/PostgreSQL connectivity
```typescript
describe('test', { timeout: 10000 }, () => { ... })
```

#### Issue: Database cleanup fails
**Solution**: Tests are designed to catch and ignore cleanup errors
```typescript
try {
  await prisma.workflow.deleteMany({});
} catch (error) {
  // Ignore - table might not exist
}
```

#### Issue: Mock adapter not being called
**Solution**: Verify adapter is registered and provider name matches
```typescript
registerIntegration(mockSlackAdapter);  // Must happen before workflow creation
// Workflow definition must use provider: 'slack'
```

### Performance Considerations

- **Retry Tests**: Actual delays happen; exponential backoff adds time to test execution
- **Cycle Detection**: Tracks visited steps to prevent infinite loops
- **Database Cleanup**: Runs before and after each test; scales with test count

### Future Enhancements

- [ ] Add tests for webhook triggers
- [ ] Add tests for scheduled workflow triggers
- [ ] Add tests for multi-tenant isolation
- [ ] Add tests for concurrent workflow execution
- [ ] Add tests for workflow timeout enforcement
- [ ] Add performance benchmarks
- [ ] Add tests for queue job lifecycle
- [ ] Add tests for GraphQL adapter
- [ ] Add tests for CLI adapter
- [ ] Add tests for MCP adapter

### Related Documentation

- [Workflow Definition Schema](../src/workflows/definition.ts)
- [Workflow Engine](../src/workflows/engine.ts)
- [REST Adapter](../src/integrations/providers/restAdapter.ts)
- [Retry Logic](../src/integrations/base/retry.ts)
- [Integration Registry](../src/integrations/registry.ts)
