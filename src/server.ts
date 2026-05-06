import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { AppError } from './http/errors.js';
import { authPlugin } from './http/authPlugin.js';
import { routes } from './http/routes.js';
import { httpRequestCounter } from './observability/metrics.js';
import { logger } from './logging/logger.js';

export async function buildServer() {
  const app = Fastify({ logger, requestIdHeader: 'x-correlation-id' });
  await app.register(helmet);
  await app.register(sensible);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin);
  await app.register(routes);

  app.addHook('onResponse', async (request, reply) => {
    httpRequestCounter.inc({ method: request.method, route: request.routeOptions.url ?? request.url, status: String(reply.statusCode) });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ code: error.code, message: error.message, details: error.details });
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.status(status).send({ code: 'INTERNAL_ERROR', message: error.message });
  });
  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ host: env.HOST, port: env.PORT });
}
