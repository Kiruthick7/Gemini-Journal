import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../errors/AppError.js';
import { idempotencyService } from '../services/idempotency.service.js';
import { thoughtMapService } from '../services/thought-map.service.js';
import { ThoughtMap } from '../types/thought-map.types.js';

export const thoughtMapRouter = Router();

thoughtMapRouter.use(authenticate);

// 1. Generate Thought Map
thoughtMapRouter.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  const uid = req.user!.uid;
  const idempotencyKey = req.headers['x-idempotency-key'];

  try {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new AppError('X-Idempotency-Key header is required', 400, 'BAD_REQUEST');
    }

    const fingerprint = idempotencyService.generateFingerprint('thought-map', 'THOUGHT_MAP_GENERATE');

    // Typed Idempotency Result
    const acquireResult = await idempotencyService.acquireOrReturn<ThoughtMap>(
      uid, 
      idempotencyKey, 
      fingerprint, 
      'THOUGHT_MAP_GENERATE'
    );
    
    switch (acquireResult.status) {
      case 'COMPLETED':
        return res.status(200).json({
          data: acquireResult.response,
          requestId: req.id,
          cached: true
        });
      case 'IN_PROGRESS':
        throw new AppError('Request is currently processing', 409, 'REQUEST_IN_PROGRESS');
      case 'CONFLICT':
        throw new AppError(acquireResult.reason, 400, 'INVALID_REQUEST');
      case 'FAILED':
        throw new AppError('Idempotency key previously failed and is permanently consumed. Please retry with a new key.', 409, 'IDEMPOTENCY_CONFLICT');
      case 'ACQUIRED':
        break; 
    }

    try {
      // Generate the map
      const responseBody = await thoughtMapService.generateThoughtMap(uid, idempotencyKey);

      await idempotencyService.markCompleted(uid, idempotencyKey, responseBody);

      return res.status(200).json({
        data: responseBody,
        requestId: req.id
      });
    } catch (executionError: unknown) {
      await idempotencyService.markFailed(uid, idempotencyKey).catch(() => {});
      throw executionError;
    }
  } catch (err: unknown) {
    next(err);
  }
});

// 2. Get Latest Thought Map
thoughtMapRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const map = await thoughtMapService.getLatestThoughtMap(uid);
    
    if (!map) {
      throw new AppError('No Thought Map found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      data: map,
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});
