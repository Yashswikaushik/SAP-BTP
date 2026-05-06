import { AppError } from '../../http/errors.js';
import { McpClient } from '../../mcp/mcpClient.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';

export class McpAdapter implements IntegrationAdapter {
  provider = 'mcp';
  private client = new McpClient();

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    const { server, toolName, args = {} } = request.input as Record<string, unknown>;
    if (!server || typeof toolName !== 'string') throw new AppError(400, 'MCP action requires server and toolName', 'INVALID_MCP_ACTION');
    const data = await this.client.callTool(server as { command: string; args?: string[]; env?: Record<string, string> }, toolName, args as Record<string, unknown>);
    return { provider: this.provider, action: request.action, data };
  }
}
