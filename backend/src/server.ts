import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const server = app.listen(config.PORT, () => {
  logger.info(`Server listening on port ${config.PORT} in ${config.NODE_ENV} mode`);
});

// Graceful Shutdown Implementation
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('Closed out remaining connections.');
    
    // In Phase 2, we would also close DB connections here if we maintained persistent pools,
    // but the Firebase Admin SDK handles connection pooling internally and generally 
    // doesn't require explicit closure in Cloud Run (the instance terminates).
    
    process.exit(0);
  });

  // Force close if it takes too long (e.g. 10s)
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
