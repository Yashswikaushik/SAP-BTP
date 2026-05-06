import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '../src/workflows/definition.js';

describe('workflowDefinitionSchema', () => {
  it('rejects duplicate step ids and dangling routes', () => {
    const result = workflowDefinitionSchema.safeParse({
      steps: [
        { id: 'start', type: 'delay', next: 'missing' },
        { id: 'start', type: 'delay' }
      ]
    });
    expect(result.success).toBe(false);
  });

  it('accepts routed integration workflows', () => {
    const result = workflowDefinitionSchema.safeParse({
      trigger: { type: 'api' },
      steps: [
        { id: 'start', type: 'condition', when: { left: 'input.approved', operator: 'equals', right: true, next: 'notify', otherwise: 'stop' } },
        { id: 'notify', type: 'integration', provider: 'slack', action: 'post' },
        { id: 'stop', type: 'delay', input: { ms: 1 } }
      ]
    });
    expect(result.success).toBe(true);
  });
});
