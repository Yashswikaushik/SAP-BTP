import { registerDefaultIntegrations } from './integrations/registry.js';
import { logger } from './logging/logger.js';
import { startServer } from './server.js';

registerDefaultIntegrations();
startServer().catch((error) => {
  logger.fatal({ error }, 'server failed to start');
  process.exit(1);
});
