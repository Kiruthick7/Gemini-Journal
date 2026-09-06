import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { auth, db } from '../src/utils/firebase.js';
import { idempotencyService } from '../src/services/idempotency.service.js';
import { quotaService } from '../src/services/quota.service.js';
import { journalService } from '../src/services/journal.service.js';
import { geminiService } from '../src/services/gemini.service.js';
import { DecodedIdToken } from 'firebase-admin/auth';
import { FinalizeResponse } from '../src/types/journal.types.js';
import { AppError } from '../src/errors/AppError.js';

describe('POST /api/journal/finalize', () => {
  const mockUid = 'userA123';
  const mockIdempotencyKey = 'uuid-journal-123';
  const mockConversationId = 'conv-journal-456';
  const validPayload = { conversationId: mockConversationId };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValue({ uid: mockUid } as unknown as DecodedIdToken);
  });

  describe('Validation & Auth Security', () => {
    it('returns 401 if token is missing', async () => {
      const res = await request(app).post('/api/journal/finalize').send(validPayload);
      expect(res.status).toBe(401);
    });

    it('returns 400 if X-Idempotency-Key is missing', async () => {
      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .send(validPayload);
      expect(res.status).toBe(400);
    });
  });

  describe('Core Finalization Flow & Idempotency Typing', () => {
    it('processes a valid journal finalization successfully', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'ACQUIRED' });
      jest.spyOn(quotaService, 'consumeFinalizationQuota').mockResolvedValue();
      jest.spyOn(idempotencyService, 'markCompleted').mockResolvedValue();
      
      const finalizeSpy = jest.spyOn(journalService, 'finalizeConversation').mockResolvedValue({
        journalId: 'new-journal-789',
        conversationId: mockConversationId
      });

      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.journalId).toBe('new-journal-789');
      expect(finalizeSpy).toHaveBeenCalledWith(mockUid, mockConversationId);
    });

    it('returns 200 with cached result if idempotency is COMPLETED', async () => {
      const cachedResponse: FinalizeResponse = { journalId: 'cached-j-1', conversationId: mockConversationId };
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ 
        status: 'COMPLETED', 
        response: cachedResponse 
      });
      
      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.data.journalId).toBe('cached-j-1');
    });

    it('returns 409 if idempotency conflict (IN_PROGRESS)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'IN_PROGRESS' });
      
      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(409);
    });

    it('returns 400 if idempotency fingerprint mismatch (CONFLICT)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'CONFLICT', reason: 'Reuse detected' });
      
      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(400);
    });

    it('returns 409 if idempotency is permanently consumed (FAILED)', async () => {
      jest.spyOn(idempotencyService, 'acquireOrReturn').mockResolvedValue({ status: 'FAILED' });
      
      const res = await request(app)
        .post('/api/journal/finalize')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Idempotency-Key', mockIdempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(409);
    });
    
    it('prevents slow zombie from overwriting after lease expires (fencing token test)', async () => {
      // 1. A request acquires the lock and transitions to SUMMARIZING with fencingToken A.
      // 2. It goes to Gemini (slow).
      // 3. The lease expires.
      // 4. A new request acquires the lock, transitioning to SUMMARIZING with fencingToken B.
      // 5. The new request finishes, setting to ARCHIVED and storing journal B.
      // 6. The original (zombie) request wakes up and tries to persist journal A.
      // It should fail with LEASE_LOST (409) because its fencingToken A !== fencingToken B (or it's already ARCHIVED).

      // To simulate this in JournalService:
      // We will mock `transaction.get` to return a state where the `processingLeaseId` does not match the token it generated, mimicking the hijack.
      
      const mockFencingTokenGet = jest.fn<() => Promise<any>>();
      mockFencingTokenGet
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            status: 'ACTIVE',
            isProcessing: false,
          })
        }) // 1st read (Lock acquisition)
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            status: 'SUMMARIZING',
            processingLeaseId: 'some-other-fencing-token-hijacked'
          })
        }); // 2nd read (Persistence check)

      jest.spyOn(db, 'collection').mockReturnValue({
        doc: () => ({
          id: 'new-journal-789',
          collection: () => ({
            doc: () => ({
              id: mockConversationId,
              get: () => ({ exists: true, data: () => ({ role: 'user', text: 'test' }) }),
              collection: () => ({
                orderBy: () => ({ limit: () => ({ get: () => [{ data: () => ({ role: 'user', text: 'test' }) }] }) }),
              })
            }),
            orderBy: () => ({ limit: () => ({ get: () => [{ data: () => ({ role: 'user', text: 'test' }) }] }) }),
          })
        })
      } as unknown as ReturnType<typeof db.collection>);

      // We have to test `JournalService` directly to mock the internal transactions for the zombie behavior
      const dbTransactionSpy = jest.spyOn(db, 'runTransaction').mockImplementation(async (callback) => {
        return callback({
          get: mockFencingTokenGet,
          update: jest.fn(),
          set: jest.fn(),
        } as unknown as FirebaseFirestore.Transaction);
      });

      jest.spyOn(geminiService, 'summarizeJournal').mockResolvedValue({
        title: 'Title', summary: 'Summary', keywords: ['k1'], themes: ['t1']
      });

      await expect(journalService.finalizeConversation(mockUid, mockConversationId)).rejects.toThrow('Lease expired and was recovered by another request');
      
      dbTransactionSpy.mockRestore();
    });
  });
});
