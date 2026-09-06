import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { auth } from '../src/utils/firebase.js';
import { idempotencyService } from '../src/services/idempotency.service.js';
import { quotaService } from '../src/services/quota.service.js';
import { chatService } from '../src/services/chat.service.js';
import { DecodedIdToken } from 'firebase-admin/auth';

describe('POST /api/chat', () => {
  const mockUid = 'userA123';
  const mockIdempotencyKey = 'uuid-1234';
  const mockConversationId = 'conv-123';
  const validPayload = {
    message: 'Hello Gemini',
    conversationId: mockConversationId
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValue({ uid: mockUid } as unknown as DecodedIdToken);
  });

  describe('Validation & Auth Security', () => {
    it('returns 401 if token is missing', async () => {
      const res = await request(app).post('/api/chat').send(validPayload);
      expect(res.status).toBe(401);
    });

    it('returns 400 if X-Idempotency-Key is missing', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-token')
        .send(validPayload);
      expect(res.status).toBe(400);
    });
  });

  describe('Core Flow & Idempotency Typing', () => {
    it('processes a valid chat request successfully', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'ACQUIRED' });
      jest.spyOn(quotaService, 'consumeChatQuota').mockResolvedValue();
      jest.spyOn(idempotencyService, 'markCompleted').mockResolvedValue();
      
      const handleChatSpy = jest.spyOn(chatService, 'handleChat').mockResolvedValue({
        conversationId: mockConversationId,
        userMessageId: 'msg-u',
        modelMessageId: 'msg-m',
        modelResponse: 'Mock Gemini response'
      });

      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.modelResponse).toBe('Mock Gemini response');
      expect(handleChatSpy).toHaveBeenCalledWith(mockUid, expect.any(Object), mockIdempotencyKey);
    });

    it('returns 409 if idempotency conflict (IN_PROGRESS)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'IN_PROGRESS' });
      
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(409);
    });

    it('returns 400 if idempotency fingerprint mismatch (CONFLICT)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'CONFLICT', reason: 'Reuse detected' });
      
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(400);
    });

    it('returns 409 if idempotency is permanently consumed (FAILED)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'FAILED' });
      
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(409);
    });
  });
});
