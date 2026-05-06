export type WorkflowDefinition = {
  trigger?: { type: 'api' | 'webhook' | 'schedule'; config?: Record<string, unknown> };
  steps: WorkflowStep[];
  timeoutMs?: number;
};

export type WorkflowStep = {
  id: string;
  type: 'integration' | 'agent' | 'condition' | 'delay';
  provider?: string;
  action?: string;
  input?: Record<string, unknown>;
  next?: string;
  onFailure?: string;
  when?: {
    left: string;
    operator: 'exists' | 'equals' | 'notEquals';
    right?: unknown;
    next?: string;
    otherwise?: string;
  };
};
