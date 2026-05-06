import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';

export type McpServerConfig = { command: string; args?: string[]; env?: Record<string, string> };

export class McpClient {
  async callTool(config: McpServerConfig, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const id = nanoid();
    const child = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env }
    });
    const request = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: args } };
    const timeout = setTimeout(() => child.kill('SIGTERM'), env.MCP_DEFAULT_TIMEOUT_MS);
    child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
    const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve));
    clearTimeout(timeout);
    if (exitCode !== 0) throw new AppError(502, 'MCP server call failed', 'MCP_SERVER_FAILED', Buffer.concat(errors).toString('utf8'));
    const lines = Buffer.concat(chunks).toString('utf8').trim().split('\n').filter(Boolean);
    const response = lines.map((line) => JSON.parse(line)).find((msg) => msg.id === id);
    if (!response) throw new AppError(502, 'MCP server returned no matching response', 'MCP_NO_RESPONSE');
    if (response.error) throw new AppError(502, 'MCP tool returned error', 'MCP_TOOL_ERROR', response.error);
    return response.result;
  }
}
