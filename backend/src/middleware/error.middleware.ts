import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  // Log the error internally (safely)
  logger.error({ 
    err, 
    requestId: req.id, 
    path: req.path,
    method: req.method
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.id
      }
    });
  }

  // Handle generic / unknown errors safely
  // We do not leak stack traces or internal Firebase errors in production
  const isDev = config.NODE_ENV === 'development';
  const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
  
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId: req.id,
      ...(isDev && { details: errMessage })
    }
  });
};
