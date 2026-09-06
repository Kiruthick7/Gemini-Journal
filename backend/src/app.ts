import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config/index.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { logger } from './utils/logger.js';
import { chatRouter } from './routes/chat.routes.js';
import { journalRouter } from './routes/journal.routes.js';
import { thoughtMapRouter } from './routes/thought-map.routes.js';
import { accountRouter } from './routes/account.routes.js';

export const app = express();

// 1. Request ID Generation (must be first so logs have it)
app.use(requestIdMiddleware);

// 2. Structured Logging
// @ts-expect-error Pino types in NodeNext CJS interop report as non-callable
app.use(pinoHttp({ 
  logger,
  genReqId: (req: Request) => (req as Request & { id: string }).id, // Use our generated UUID
}));

// 3. Security Headers
// We use helmet's safe defaults, which cover CSP, XCTO, Referrer-Policy, Frameguard
// We explicitly allow popups for Firebase Auth sign-in
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false,
}));

// 4. Explicit CORS
app.use(cors({
  origin: config.NODE_ENV === 'production' ? config.FRONTEND_ORIGIN : [config.FRONTEND_ORIGIN, 'http://localhost:5173'],
  credentials: true,
}));

// 5. Body Parsing with Strict Limit
// 50KB limit as defined in the blueprint
app.use(express.json({ limit: '50kb' }));

// 6. Health & Readiness
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.get('/ready', (req, res) => {
  // Can be expanded to check DB ping if necessary, but simple OK is fine for pure stateless apps.
  res.status(200).json({ status: 'READY' });
});

// Phase 2: Business Routes
app.use('/api/chat', chatRouter);
app.use('/api/journal', journalRouter);
app.use('/api/thought-map', thoughtMapRouter);
app.use('/api/account', accountRouter);

// 7. Serve Frontend in Production
import path from 'path';
import { fileURLToPath } from 'url';

if (config.NODE_ENV === 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  
  app.use(express.static(frontendDist));
  
  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 8. Centralized Error Handling (must be last)
app.use(errorHandler);
