import { db } from '../utils/firebase.js';

export class AccountService {
  /**
   * Recursively deletes all user data inside users/{uid}.
   * This uses the Firebase Admin SDK's BulkWriter internally, which
   * respects the maximum Firestore batch size (500) and safely pages through
   * large collections and subcollections.
   * 
   * It is naturally retryable: if it fails halfway, rerunning it will 
   * just delete the remaining documents.
   */
  public async deleteAccount(uid: string): Promise<void> {
    const userRef = db.collection('users').doc(uid);
    await db.recursiveDelete(userRef);
  }
}

export const accountService = new AccountService();
