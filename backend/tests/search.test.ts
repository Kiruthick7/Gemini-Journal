import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { auth, db } from '../src/utils/firebase.js';
import { geminiService } from '../src/services/gemini.service.js';
import { quotaService } from '../src/services/quota.service.js';
import { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';

describe('GET /api/journal/search', () => {
  const mockUid = 'userSearch123';
  
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(auth, 'verifyIdToken').mockResolvedValue({ uid: mockUid } as unknown as DecodedIdToken);
    jest.spyOn(quotaService, 'consumeSearchQuota').mockResolvedValue();
  });

  describe('Validation & Auth Security', () => {
    it('returns 401 if token is missing', async () => {
      const res = await request(app).get('/api/journal/search?q=test');
      expect(res.status).toBe(401);
    });

    it('returns 400 if query is too short', async () => {
      const res = await request(app)
        .get('/api/journal/search?q=a')
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Validation failed/);
    });

    it('returns 400 if limit is out of bounds', async () => {
      const res = await request(app)
        .get('/api/journal/search?q=valid&limit=50')
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(400);
    });

    it('consumes quota on valid request', async () => {
      const quotaSpy = jest.spyOn(quotaService, 'consumeSearchQuota');
      
      // We will mock gemini service to just return keywords since it's a valid simple query
      jest.spyOn(geminiService, 'extractSearchKeywords').mockResolvedValue(['valid']);

      // Mock DB
      jest.spyOn(db, 'collection').mockReturnValue({
        doc: () => ({
          collection: () => ({
            where: () => ({ limit: () => ({ get: () => [] }) })
          })
        })
      } as unknown as ReturnType<typeof db.collection>);

      await request(app)
        .get('/api/journal/search?q=valid')
        .set('Authorization', 'Bearer token');

      expect(quotaSpy).toHaveBeenCalledWith(mockUid);
    });
  });

  describe('Search Flow & Firestore Isolation', () => {
    it('bypasses Gemini for simple keyword searches', async () => {
      const geminiSpy = jest.spyOn(geminiService, 'extractSearchKeywords');
      
      const dbSpy = jest.fn().mockReturnValue({ limit: () => ({ get: () => [] }) });
      jest.spyOn(db, 'collection').mockReturnValue({
        doc: (uid: string) => {
          expect(uid).toBe(mockUid); // Crucial isolation check!
          return {
            collection: () => ({
              where: dbSpy
            })
          };
        }
      } as unknown as ReturnType<typeof db.collection>);

      const res = await request(app)
        .get('/api/journal/search?q=typescript')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(geminiSpy).not.toHaveBeenCalled();
      expect(res.body.data.keywords).toEqual(['typescript']);
      
      // Should have made 2 array-contains-any calls
      expect(dbSpy).toHaveBeenCalledWith('keywords', 'array-contains-any', ['typescript']);
      expect(dbSpy).toHaveBeenCalledWith('themes', 'array-contains-any', ['typescript', 'Typescript']);
    });

    it('calls Gemini for natural language queries', async () => {
      const geminiSpy = jest.spyOn(geminiService, 'extractSearchKeywords').mockResolvedValue(['career', 'job']);
      
      jest.spyOn(db, 'collection').mockReturnValue({
        doc: () => ({
          collection: () => ({
            where: () => ({ limit: () => ({ get: () => [] }) })
          })
        })
      } as unknown as ReturnType<typeof db.collection>);

      const res = await request(app)
        .get('/api/journal/search?q=what%20did%20i%20say%20about%20my%20career%3F')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(geminiSpy).toHaveBeenCalled();
      expect(res.body.data.keywords).toEqual(['career', 'job']);
    });

    it('merges, deduplicates, and ranks results correctly', async () => {
      jest.spyOn(geminiService, 'extractSearchKeywords'); // unused, simple query

      const mockJournal1 = {
        id: 'j1',
        title: 'Learning Typescript',
        summary: '...',
        keywords: ['typescript', 'code'],
        themes: ['Learning'],
        createdAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000)
      };

      const mockJournal2 = {
        id: 'j2',
        title: 'Random',
        summary: '...',
        keywords: ['random'],
        themes: ['Typescript'],
        createdAt: Timestamp.fromMillis(2000),
        updatedAt: Timestamp.fromMillis(2000)
      };

      // Mock keywords match j1, themes match j2, and duplicate j1
      const dbSpy = jest.fn().mockImplementation((field) => {
        if (field === 'keywords') {
          return { limit: () => ({ get: () => [{ id: 'j1', data: () => mockJournal1 }] }) };
        }
        if (field === 'themes') {
          return { limit: () => ({ get: () => [
            { id: 'j2', data: () => mockJournal2 },
            { id: 'j1', data: () => mockJournal1 } // Duplicate to test deduplication
          ]})};
        }
      });

      jest.spyOn(db, 'collection').mockReturnValue({
        doc: () => ({
          collection: () => ({
            where: dbSpy
          })
        })
      } as unknown as ReturnType<typeof db.collection>);

      const res = await request(app)
        .get('/api/journal/search?q=typescript')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      
      const results = res.body.data.results;
      expect(results.length).toBe(2);
      
      // j1 should be ranked higher: Title (+5) + Keywords (+3) = 8
      // j2 should be ranked lower: Themes (+2) = 2
      expect(results[0].id).toBe('j1');
      expect(results[1].id).toBe('j2');
    });

    it('handles AI Service Unavailable (503)', async () => {
      const { AppError } = await import('../src/errors/AppError.js');
      jest.spyOn(geminiService, 'extractSearchKeywords').mockRejectedValue(new AppError('AI Service Unavailable', 503, 'AI_OUTPUT_INVALID'));
      
      const res = await request(app)
        .get('/api/journal/search?q=what%20did%20i%20write%20about%20jobs%3F')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(503);
    });

    it('bounds candidate queries to a safe maximum', async () => {
      const geminiSpy = jest.spyOn(geminiService, 'extractSearchKeywords'); // simple query bypasses this
      
      const limitSpy = jest.fn().mockReturnValue({ get: () => [] });
      const whereSpy = jest.fn().mockReturnValue({ limit: limitSpy });

      jest.spyOn(db, 'collection').mockReturnValue({
        doc: () => ({
          collection: () => ({
            where: whereSpy
          })
        })
      } as unknown as ReturnType<typeof db.collection>);

      // Request a limit of 10. The backend should bound candidates to Math.max(50, 10 * 3) = 50.
      await request(app)
        .get('/api/journal/search?q=typescript&limit=10')
        .set('Authorization', 'Bearer token');

      expect(whereSpy).toHaveBeenCalled();
      expect(limitSpy).toHaveBeenCalledWith(50);
    });

    it('strictly enforces cross-user isolation regardless of input', async () => {
      jest.spyOn(geminiService, 'extractSearchKeywords'); // unused

      const docSpy = jest.fn().mockReturnValue({
        collection: () => ({
          where: () => ({ limit: () => ({ get: () => [] }) })
        })
      });

      jest.spyOn(db, 'collection').mockReturnValue({
        doc: docSpy
      } as unknown as ReturnType<typeof db.collection>);

      // Attempt to inject a different UID via query params
      await request(app)
        .get('/api/journal/search?q=typescript&uid=attacker123')
        .set('Authorization', 'Bearer token');

      // The backend MUST use mockUid (from the verified token), completely ignoring 'attacker123'
      expect(docSpy).toHaveBeenCalledWith(mockUid);
    });
  });
});
