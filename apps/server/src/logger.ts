import { pino } from 'pino';
import { env } from './env.js';

export const logger = pino(
  env.isProd
    ? { level: process.env['LOG_LEVEL'] ?? 'info' }
    : {
        level: process.env['LOG_LEVEL'] ?? 'info',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
);
