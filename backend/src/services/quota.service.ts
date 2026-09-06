import { db } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_DAILY_CHAT_REQUESTS = 50;
const MAX_DAILY_FINALIZATION_REQUESTS = 10;
const MAX_DAILY_SEARCH_REQUESTS = 30;

export class QuotaService {
  /**
   * Atomically checks and increments the user's daily chat quota.
   * Throws a 429 AppError if quota is exceeded.
   */
  public async consumeChatQuota(uid: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const quotaRef = db.collection('users').doc(uid).collection('quotas').doc(`daily_${today}`);

    await db.runTransaction(async (transaction) => {
      const quotaDoc = await transaction.get(quotaRef);

      if (!quotaDoc.exists) {
        transaction.set(quotaRef, { chatRequests: 1 });
        return;
      }

      const currentRequests = quotaDoc.data()?.chatRequests || 0;

      if (currentRequests >= MAX_DAILY_CHAT_REQUESTS) {
        throw new AppError('Daily chat quota exceeded', 429, 'QUOTA_EXCEEDED');
      }

      transaction.update(quotaRef, {
        chatRequests: FieldValue.increment(1)
      });
    });
  }

  /**
   * Atomically checks and increments the user's daily finalization quota.
   * Throws a 429 AppError if quota is exceeded.
   */
  public async consumeFinalizationQuota(uid: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const quotaRef = db.collection('users').doc(uid).collection('quotas').doc(`daily_finalize_${today}`);

    await db.runTransaction(async (transaction) => {
      const quotaDoc = await transaction.get(quotaRef);

      if (!quotaDoc.exists) {
        transaction.set(quotaRef, { finalizeRequests: 1 });
        return;
      }

      const currentRequests = quotaDoc.data()?.finalizeRequests || 0;

      if (currentRequests >= MAX_DAILY_FINALIZATION_REQUESTS) {
        throw new AppError('Daily journal finalization quota exceeded', 429, 'FINALIZATION_QUOTA_EXCEEDED');
      }

      transaction.update(quotaRef, {
        finalizeRequests: FieldValue.increment(1)
      });
    });
  }

  /**
   * Atomically checks and increments the user's daily search quota.
   * Throws a 429 AppError if quota is exceeded.
   */
  public async consumeSearchQuota(uid: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const quotaRef = db.collection('users').doc(uid).collection('quotas').doc(`daily_search_${today}`);

    await db.runTransaction(async (transaction) => {
      const quotaDoc = await transaction.get(quotaRef);

      if (!quotaDoc.exists) {
        transaction.set(quotaRef, { searchRequests: 1 });
        return;
      }

      const currentRequests = quotaDoc.data()?.searchRequests || 0;

      if (currentRequests >= MAX_DAILY_SEARCH_REQUESTS) {
        throw new AppError('Daily search quota exceeded', 429, 'SEARCH_QUOTA_EXCEEDED');
      }

      transaction.update(quotaRef, {
        searchRequests: FieldValue.increment(1)
      });
    });
  }
}

export const quotaService = new QuotaService();
