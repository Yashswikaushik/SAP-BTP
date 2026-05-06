import { AiAdapter } from './providers/aiAdapter.js';
import { CliAdapter } from './providers/cliAdapter.js';
import { GraphqlAdapter } from './providers/graphqlAdapter.js';
import { McpAdapter } from './providers/mcpAdapter.js';
import { PostgresAdapter } from './providers/postgresAdapter.js';
import { providerConfigs } from './providers/providerConfig.js';
import { RestAdapter } from './providers/restAdapter.js';
import { IntegrationAdapter } from './base/types.js';

const adapters = new Map<string, IntegrationAdapter>();

export function registerIntegration(adapter: IntegrationAdapter): void {
  adapters.set(adapter.provider, adapter);
}

export function registerDefaultIntegrations(): void {
  [new AiAdapter(), new CliAdapter(), new McpAdapter(), new PostgresAdapter()].forEach(registerIntegration);
  Object.entries(providerConfigs).forEach(([provider, config]) => registerIntegration(new RestAdapter(provider, config)));
  const githubConfig = providerConfigs.github;
  if (githubConfig) {
    registerIntegration(new GraphqlAdapter('github-graphql', 'https://api.github.com/graphql', githubConfig));
  }
}

export function getIntegration(provider: string): IntegrationAdapter | undefined {
  return adapters.get(provider);
}

export function listIntegrations(): string[] {
  return [...adapters.keys()].sort();
}
