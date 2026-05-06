import pino, { LoggerOptions } from 'pino';
import { env } from '../config/env.js';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', '*.accessToken', '*.refreshToken', '*.apiKey', '*.secret']
};
if (env.NODE_ENV === 'development') options.transport = { target: 'pino-pretty', options: { colorize: true } };
export const logger = pino(options);
