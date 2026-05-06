import client from 'prom-client';

client.collectDefaultMetrics();
export const httpRequestCounter = new client.Counter({ name: 'http_requests_total', help: 'HTTP requests', labelNames: ['method', 'route', 'status'] });
export function metricsText() { return client.register.metrics(); }
