import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../errors/AppError.js';
import { quotaService } from '../services/quota.service.js';
import { idempotencyService } from '../services/idempotency.service.js';
import { chatService } from '../services/chat.service.js';
import { db } from '../utils/firebase.js';

export const chatRouter = Router();

// Zod schemas
const chatMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message too long'),
  conversationId: z.string().min(1, 'Conversation ID required').regex(/^[a-zA-Z0-9_-]+$/, 'Invalid format')
}).strict(); // strict() explicitly rejects any extra unknown fields from the client

chatRouter.use(authenticate);

// 1. Generate Conversation ID Endpoint
chatRouter.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const conversationId = await chatService.createConversation(uid);
    
    res.status(201).json({
      data: { conversationId },
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});

// 2. Chat Endpoint
chatRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const uid = req.user!.uid;
  const idempotencyKey = req.headers['x-idempotency-key'];

  try {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new AppError('X-Idempotency-Key header is required', 400, 'BAD_REQUEST');
    }

    // A. Request Validation
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(`Validation failed: ${parsed.error.errors[0].message}`, 400, 'BAD_REQUEST');
    }

    // B. Generate Request Fingerprint
    const fingerprint = idempotencyService.generateFingerprint(parsed.data.conversationId, parsed.data.message);

    // C. Idempotency Check via Typed Result
    const acquireResult = await idempotencyService.acquireOrReturn(uid, idempotencyKey, fingerprint);
    
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
        break; // Continue to execution
    }

    try {
      // D. Quota Enforcement
      await quotaService.consumeChatQuota(uid);

      // E. Core Execution (Firestore + Gemini)
      const responseBody = await chatService.handleChat(uid, parsed.data, idempotencyKey);

      // F. Mark Idempotency Completed
      await idempotencyService.markCompleted(uid, idempotencyKey, responseBody);

      return res.status(200).json({
        data: responseBody,
        requestId: req.id
      });
    } catch (executionError: unknown) {
      // G. Mark Idempotency Failed on execution error
      await idempotencyService.markFailed(uid, idempotencyKey).catch(() => {});
      throw executionError;
    }
  } catch (err: unknown) {
    next(err);
  }
});

// 3. Conversation Hydration Endpoint (Frontend Recovery)
chatRouter.get('/:conversationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = req.user!.uid;
    const conversationId = req.params.conversationId;

    const convRef = db.collection('users').doc(uid).collection('conversations').doc(conversationId);
    const convDoc = await convRef.get();

    if (!convDoc.exists) {
      throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    }

    const messagesSnapshot = await convRef.collection('messages').orderBy('createdAt', 'asc').limit(50).get();
    const messages = messagesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role,
        text: data.text,
        createdAt: data.createdAt
      };
    });

    res.status(200).json({
      data: {
        conversation: convDoc.data(),
        messages
      },
      requestId: req.id
    });
  } catch (err: unknown) {
    next(err);
  }
});
