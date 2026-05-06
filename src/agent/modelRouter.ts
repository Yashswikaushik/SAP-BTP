import { env } from '../config/env.js';
import { createHttpClient } from '../integrations/base/httpClient.js';

export type AgentMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };
export type ModelRouteRequest = { provider?: 'openai' | 'claude'; model?: string; messages: AgentMessage[]; tools?: unknown[]; temperature?: number };

export class ModelRouter {
  async complete(request: ModelRouteRequest): Promise<unknown> {
    const provider = request.provider ?? (env.OPENAI_API_KEY ? 'openai' : 'claude');
    if (provider === 'openai') {
      const { data } = await createHttpClient('https://api.openai.com/v1', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } })
        .post('/chat/completions', { model: request.model ?? 'gpt-4o-mini', messages: request.messages, tools: request.tools, temperature: request.temperature ?? 0.2 });
      return data;
    }
    const { data } = await createHttpClient('https://api.anthropic.com/v1', {
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    }).post('/messages', { model: request.model ?? 'claude-3-5-sonnet-latest', messages: request.messages.filter((m) => m.role !== 'system'), system: request.messages.find((m) => m.role === 'system')?.content, max_tokens: 2048, temperature: request.temperature ?? 0.2 });
    return data;
  }
}
