import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../../http/errors.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';

const execFileAsync = promisify(execFile);
const ALLOWED_COMMANDS = new Set(['git', 'gh', 'psql', 'supabase']);

export class CliAdapter implements IntegrationAdapter {
  provider = 'cli';

  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    const { command, args = [], cwd } = request.input as { command?: string; args?: string[]; cwd?: string };
    if (!command || !ALLOWED_COMMANDS.has(command)) throw new AppError(400, 'CLI command is not allowed', 'CLI_COMMAND_DENIED');
    const result = await execFileAsync(command, args, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 });
    return { provider: this.provider, action: request.action, data: { stdout: result.stdout, stderr: result.stderr } };
  }
}
