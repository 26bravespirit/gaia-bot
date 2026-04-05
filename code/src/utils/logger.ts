import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}][${level}] ${message}${metaStr}`;
    }),
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/gaia-bot.log', maxsize: 5 * 1024 * 1024, maxFiles: 3 }),
  ],
});
