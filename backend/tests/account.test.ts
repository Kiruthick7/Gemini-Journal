import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { accountService } from '../src/services/account.service.js';
import { auth } from '../src/utils/firebase.js';
import { DecodedIdToken } from 'firebase-admin/auth';

describe('Account Deletion Phase 6 Requirements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. rejects unauthenticated requests', async () => {
    const res = await request(app).delete('/api/account');
    expect(res.status).toBe(401);
  });

  it('2. safely deletes the authenticated account via recursiveDelete', async () => {
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValueOnce({ uid: 'uAccount' } as DecodedIdToken);
    const deleteSpy = jest.spyOn(accountService, 'deleteAccount').mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(deleteSpy).toHaveBeenCalledWith('uAccount');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('3. handles failure safely', async () => {
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValueOnce({ uid: 'uAccount' } as DecodedIdToken);
    jest.spyOn(accountService, 'deleteAccount').mockRejectedValueOnce(new Error('Firestore error'));

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(500); // Standard express error handler handles it
  });
});
