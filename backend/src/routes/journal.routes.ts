import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../errors/AppError.js';
import { quotaService } from '../services/quota.service.js';
import { idempotencyService } from '../services/idempotency.service.js';
import { journalService } from '../services/journal.service.js';
import { db } from '../utils/firebase.js';
import { FinalizeResponse } from '../types/journal.types.js';

export const journalRouter = Router();

// Zod schemas
const finalizeSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID required').regex(/^[a-zA-Z0-9_-]+$/, 'Invalid format')
}).strict();

journalRouter.use(authenticate);

// 1. Finalize Conversation to Journal
journalRouter.post('/finalize', async (req: Request, res: Response, next: NextFunction) => {
  const uid = req.user!.uid;
  const idempotencyKey = req.headers['x-idempotency-key'];

  try {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new AppError('X-Idempotency-Key header is required', 400, 'BAD_REQUEST');
    }

    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(`Validation failed: ${parsed.error.errors[0].message}`, 400, 'BAD_REQUEST');
    }

    const fingerprint = idempotencyService.generateFingerprint(parsed.data.conversationId, 'JOURNAL_FINALIZE');

    // Typed Idempotency Result
    const acquireResult = await idempotencyService.acquireOrReturn<FinalizeResponse>(
      uid, 
      idempotencyKey, 
      fingerprint, 
      'JOURNAL_FINALIZE'
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
      // 1. Attempt to finalize
      await quotaService.consumeFinalizationQuota(uid);
      const responseBody = await journalService.finalizeConversation(uid, parsed.data.conversationId);

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

const searchSchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(200, 'Query too long'),
  limit: z.coerce.number().min(1).max(20).default(10)
});

// 2. Search Journals
journalRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const parsed = searchSchema.safeParse(req.query);
    
    if (!parsed.success) {
      throw new AppError(`Validation failed: ${parsed.error.errors[0].message}`, 400, 'BAD_REQUEST');
    }

    await quotaService.consumeSearchQuota(uid);

    const { journalSearchService } = await import('../services/journal-search.service.js');
    const searchResponse = await journalSearchService.searchJournals(
      uid, 
      parsed.data.q, 
      parsed.data.limit, 
      String(req.id)
    );

    res.status(200).json({
      data: searchResponse,
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});

// 3. List Journals (Paginated)
journalRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 50);
    // Note: A true cursor system (startAfter) would require passing doc snapshots or encoded cursor values. 
    // For this hackathon step, we'll return a simple bounded list. 
    
    const journalsSnapshot = await db.collection('users').doc(uid).collection('journals')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const journals = journalsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      data: journals,
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});

// 3. Get Single Journal
journalRouter.get('/:journalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const journalId = req.params.journalId;

    const journalDoc = await db.collection('users').doc(uid).collection('journals').doc(journalId).get();

    if (!journalDoc.exists) {
      throw new AppError('Journal not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      data: {
        id: journalDoc.id,
        ...journalDoc.data()
      },
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});

// 4. Update Journal Preferences
const preferencesSchema = z.object({
  includeInThoughtMap: z.boolean()
});

journalRouter.patch('/:journalId/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const journalId = req.params.journalId;
    
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(`Validation failed: ${parsed.error.errors[0].message}`, 400, 'BAD_REQUEST');
    }

    const journalRef = db.collection('users').doc(uid).collection('journals').doc(journalId);
    
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(journalRef);
      if (!doc.exists) {
        throw new AppError('Journal not found', 404, 'NOT_FOUND');
      }
      
      transaction.update(journalRef, {
        includeInThoughtMap: parsed.data.includeInThoughtMap,
        updatedAt: new Date()
      });
    });

    res.status(200).json({
      data: { success: true },
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});
