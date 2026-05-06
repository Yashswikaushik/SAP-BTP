import { z } from 'zod';

export const workflowStepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['integration', 'agent', 'condition', 'delay']),
  provider: z.string().optional(),
  action: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  next: z.string().optional(),
  onFailure: z.string().optional(),
  when: z.object({
    left: z.string().min(1),
    operator: z.enum(['exists', 'equals', 'notEquals']),
    right: z.unknown().optional(),
    next: z.string().optional(),
    otherwise: z.string().optional()
  }).optional()
});

export const workflowDefinitionSchema = z.object({
  trigger: z.object({ type: z.enum(['api', 'webhook', 'schedule']), config: z.record(z.unknown()).optional() }).optional(),
  steps: z.array(workflowStepSchema).min(1),
  timeoutMs: z.number().int().positive().max(86_400_000).optional()
}).superRefine((definition, ctx) => {
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate step id: ${step.id}`, path: ['steps'] });
    ids.add(step.id);
  }
  for (const step of definition.steps) {
    for (const target of [step.next, step.onFailure, step.when?.next, step.when?.otherwise].filter(Boolean)) {
      if (!ids.has(String(target))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Step ${step.id} references missing step ${target}`, path: ['steps'] });
    }
  }
});
