import pino from 'pino';
import { config } from '../config/index.js';

// @ts-expect-error Pino types in NodeNext CJS interop report as non-callable
export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
  // In a real cloud run environment, Pino will output JSON which Cloud Logging parses.
});
