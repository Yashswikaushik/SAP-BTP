import { ModelRouter } from '../../agent/modelRouter.js';
import { IntegrationActionRequest, IntegrationActionResult, IntegrationAdapter } from '../base/types.js';

export class AiAdapter implements IntegrationAdapter {
  provider = 'ai';
  private router = new ModelRouter();
  async execute(request: IntegrationActionRequest): Promise<IntegrationActionResult> {
    return { provider: this.provider, action: request.action, data: await this.router.complete(request.input as never) };
  }
}
