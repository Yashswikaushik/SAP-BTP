import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export async function authPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    if (request.url === '/healthz' || request.url === '/readyz' || request.url === '/metrics') return;
    const header = request.headers.authorization;
    if (header !== `Bearer ${env.API_AUTH_TOKEN}`) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
  });
}
