import { db } from '../utils/firebase.js';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { IdempotencyRecord, ChatResponse, IdempotencyAcquireResult } from '../types/chat.types.js';
import { createHash } from 'crypto';

export class IdempotencyService {
  /**
   * Generates a stable request fingerprint.
   */
  public generateFingerprint(conversationId: string, message: string): string {
    const hash = createHash('sha256');
    hash.update(`CHAT:${conversationId}:${message}`);
    return hash.digest('hex');
  }

  /**
   * Atomically acquires the idempotency key or returns the typed status.
   * Returns a discriminated union for safe control flow.
   */
  public async acquireOrReturn<T = ChatResponse>(uid: string, idempotencyKey: string, fingerprint: string, operation: 'CHAT' | 'JOURNAL_FINALIZE' | 'THOUGHT_MAP_GENERATE' = 'CHAT'): Promise<IdempotencyAcquireResult<T>> {
    const keyRef = db.collection('users').doc(uid).collection('idempotencyKeys').doc(idempotencyKey);

    return db.runTransaction(async (transaction): Promise<IdempotencyAcquireResult<T>> => {
      const doc = await transaction.get(keyRef);
      const now = Timestamp.now();

      if (doc.exists) {
        const data = doc.data() as IdempotencyRecord;

        // Strict fingerprint validation
        if (data.requestFingerprint !== fingerprint) {
          return { status: 'CONFLICT', reason: 'Idempotency key reuse detected with different request payload' };
        }

        if (data.status === 'COMPLETED') {
          return { status: 'COMPLETED', response: data.response as unknown as T };
        }

        if (data.status === 'FAILED') {
          return { status: 'FAILED' };
        }

        if (data.status === 'PROCESSING') {
          // A PROCESSING key is terminally in-progress for the client. They must retry with a NEW key.
          return { status: 'IN_PROGRESS' };
        }
      }

      // New key
      const newRecord: IdempotencyRecord = {
        operation,
        status: 'PROCESSING',
        requestFingerprint: fingerprint,
        createdAt: now,
        updatedAt: now,
      };
      
      transaction.set(keyRef, newRecord);
      return { status: 'ACQUIRED' };
    });
  }

  public async markCompleted(uid: string, idempotencyKey: string, responseBody: unknown): Promise<void> {
    const keyRef = db.collection('users').doc(uid).collection('idempotencyKeys').doc(idempotencyKey);
    await keyRef.update({
      status: 'COMPLETED',
      response: responseBody,
      updatedAt: Timestamp.now(),
      leaseExpiresAt: FieldValue.delete() // Cleanup if existed previously
    });
  }

  public async markFailed(uid: string, idempotencyKey: string): Promise<void> {
    const keyRef = db.collection('users').doc(uid).collection('idempotencyKeys').doc(idempotencyKey);
    await keyRef.update({
      status: 'FAILED',
      updatedAt: Timestamp.now(),
      leaseExpiresAt: FieldValue.delete()
    });
  }
}

export const idempotencyService = new IdempotencyService();
