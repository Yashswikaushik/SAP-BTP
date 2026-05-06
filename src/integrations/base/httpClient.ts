import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, CreateAxiosDefaults } from 'axios';
import { IntegrationError, RateLimitError } from '../../http/errors.js';
import { logger } from '../../logging/logger.js';

export function createHttpClient(baseURL?: string, defaults: AxiosRequestConfig = {}): AxiosInstance {
  const options: CreateAxiosDefaults = { timeout: 30_000, ...defaults };
  if (baseURL) options.baseURL = baseURL;
  const client = axios.create(options);
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const status = error.response?.status;
    if (status === 429) {
      const retryAfter = Number(error.response?.headers['retry-after'] ?? 1) * 1000;
      throw new RateLimitError(retryAfter, { url: error.config?.url });
    }
    if (status && status >= 500) logger.warn({ status, url: error.config?.url }, 'upstream transient error');
    throw new IntegrationError(error.message, { status, data: error.response?.data });
  });
  return client;
}
