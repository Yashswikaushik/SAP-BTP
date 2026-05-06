export type IntegrationActionRequest = {
  tenantId: string;
  action: string;
  input: Record<string, unknown>;
  correlationId: string;
};

export type IntegrationActionResult = {
  provider: string;
  action: string;
  data: unknown;
  metadata?: Record<string, unknown>;
};

export interface IntegrationAdapter {
  provider: string;
  execute(request: IntegrationActionRequest): Promise<IntegrationActionResult>;
}
