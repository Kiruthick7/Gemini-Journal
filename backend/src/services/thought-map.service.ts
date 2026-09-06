import { z } from 'zod';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';
import { config } from '../config/index.js';
import { 
  ThoughtMap, 
  ThoughtMapSignal, 
  ThoughtMapThemeNode
} from '../types/thought-map.types.js';
import { geminiInterpretationService } from './gemini-interpretation.service.js';

export class ThoughtMapService {
  private readonly MAX_JOURNALS = 50;
  private readonly MAX_SIGNALS = 30;
  private readonly LEASE_DURATION_MS = 60 * 1000; // 60 seconds

  /**
   * Generates a new Thought Map for the user.
   */
  async generateThoughtMap(uid: string, requestId: string): Promise<ThoughtMap> {
    const stateRef = db.collection('users').doc(uid).collection('thoughtMap').doc('state');
    const latestRef = db.collection('users').doc(uid).collection('thoughtMap').doc('latest');
    const journalsRef = db.collection('users').doc(uid).collection('journals');

    const leaseId = requestId; // Use requestId as unique lease identifier

    // 1. Acquire Lease (Failure-first lock)
    await db.runTransaction(async (transaction) => {
      const stateDoc = await transaction.get(stateRef);
      if (stateDoc.exists) {
        const data = stateDoc.data();
        if (data?.status === 'GENERATING') {
          const now = Date.now();
          const leaseExpiresAt = data.leaseExpiresAt?.toMillis() || 0;
          if (now < leaseExpiresAt) {
            throw new AppError('Thought Map generation is already in progress', 409, 'GENERATION_IN_PROGRESS');
          }
          // Lease expired, safe to recover and proceed
        }
      }
      
      transaction.set(stateRef, {
        status: 'GENERATING',
        processingLeaseId: leaseId,
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + this.LEASE_DURATION_MS)
      }, { merge: true });
    });

    try {
      // 2. Fetch Bounded Eligible Journals
      // We fetch the most recent MAX_JOURNALS, then filter out those excluded by preference.
      const snapshot = await journalsRef
        .orderBy('createdAt', 'desc')
        .limit(this.MAX_JOURNALS * 2) // Fetch a bit more to account for excluded ones, up to 100
        .get();

      const eligibleJournals: { id: string, themes: string[], keywords: string[] }[] = [];
      
      // Schema specifically for reading from Firestore which contains extra metadata fields
      const firestoreJournalSchema = z.object({
        themes: z.array(z.string().min(1).max(30)).max(5).default([]),
        keywords: z.array(z.string().min(1).max(30)).max(5).default([])
      });

      for (const doc of snapshot.docs) {
        const data = doc.data();
        // Skip if explicitly excluded
        if (data.includeInThoughtMap === false) continue;

        // Strictly validate schema (treat DB as untrusted) but allow extra fields
        const parsed = firestoreJournalSchema.safeParse(data);
        if (parsed.success) {
          eligibleJournals.push({
            id: doc.id,
            themes: parsed.data.themes || [],
            keywords: parsed.data.keywords || []
          });
        }
        
        if (eligibleJournals.length >= this.MAX_JOURNALS) break;
      }

      if (eligibleJournals.length < 3) {
        throw new AppError('Not enough eligible journal entries to generate a Thought Map. Minimum required: 3.', 400, 'INSUFFICIENT_DATA');
      }

      // 3. Deterministic Aggregation (Factual Backend Authority)
      const signalCounts = new Map<string, { value: string, type: 'theme' | 'keyword', count: number, journalIds: Set<string> }>();

      const addSignal = (value: string, type: 'theme' | 'keyword', journalId: string) => {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return;
        const key = `${type}:${normalized}`;
        if (!signalCounts.has(key)) {
          signalCounts.set(key, { value, type, count: 0, journalIds: new Set() });
        }
        const s = signalCounts.get(key)!;
        s.count += 1;
        s.journalIds.add(journalId);
        // Prefer Title Cased representation for display if it's a theme
        if (type === 'theme' && value.charAt(0) === value.charAt(0).toUpperCase()) {
           s.value = value;
        }
      };

      for (const j of eligibleJournals) {
        j.themes.forEach(t => addSignal(t, 'theme', j.id));
        j.keywords.forEach(k => addSignal(k, 'keyword', j.id));
      }

      // Sort signals: Themes first, then frequency
      const sortedSignals = Array.from(signalCounts.values()).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'theme' ? -1 : 1;
        return b.count - a.count;
      });

      // Truncate to MAX_SIGNALS
      const topSignals = sortedSignals.slice(0, this.MAX_SIGNALS);

      // 4. Construct Bounded ID Map
      const inputIdMap: Record<string, ThoughtMapSignal> = {};
      let themeCounter = 1;
      let keywordCounter = 1;

      for (const s of topSignals) {
        const id = s.type === 'theme' ? `T${themeCounter++}` : `K${keywordCounter++}`;
        inputIdMap[id] = {
          id,
          name: s.value,
          type: s.type,
          count: s.count,
          journalIds: Array.from(s.journalIds)
        };
      }

      // 5. Construct Bounded Data String for Gemini
      const boundedDataStr = Object.values(inputIdMap)
        .map(s => `[${s.id}] Type: ${s.type.toUpperCase()}, Value: "${s.name}", Frequency: ${s.count}`)
        .join('\n');

      // 6. Invoke Gemini Interpretation
      const geminiOutput = await geminiInterpretationService.generateInterpretation(boundedDataStr, requestId);

      // 7. Verify Evidence Integrity (Strict Backend Facts)
      const finalThemes: ThoughtMapThemeNode[] = [];
      const usedSignalIds = new Set<string>();

      let nodeCounter = 1;
      for (const rawTheme of geminiOutput.themes) {
        // Strip hallucinated or mismatched signals
        const validSignals = rawTheme.signals.filter(sigId => !!inputIdMap[sigId]);
        if (validSignals.length === 0) continue; // Drop theme if it has no valid signals

        validSignals.forEach(id => usedSignalIds.add(id));

        finalThemes.push({
          id: `NODE_${nodeCounter++}`, // Generate fresh neutral IDs
          name: rawTheme.name,
          description: rawTheme.description,
          signals: validSignals
        });
      }

      if (finalThemes.length === 0) {
        throw new AppError('AI generated zero valid themes from the given signals.', 500, 'AI_OUTPUT_INVALID');
      }

      // Keep only signals that were actually used
      const finalSignals: Record<string, ThoughtMapSignal> = {};
      const finalJournalIds = new Set<string>();

      usedSignalIds.forEach(sigId => {
        const s = inputIdMap[sigId];
        finalSignals[sigId] = s;
        s.journalIds.forEach(jid => finalJournalIds.add(jid));
      });

      const thoughtMap: ThoughtMap = {
        themes: finalThemes,
        signals: finalSignals,
        journalIds: Array.from(finalJournalIds),
        createdAt: Timestamp.now(),
        modelVersion: config.GEMINI_MODEL
      };

      // 8. Atomic Persistence
      await db.runTransaction(async (transaction) => {
        // Verify lease hasn't been stolen by a recovered request
        const currentLock = await transaction.get(stateRef);
        if (currentLock.exists && currentLock.data()?.processingLeaseId !== leaseId) {
          throw new AppError('Lease hijacked or expired during generation', 409, 'LEASE_LOST');
        }

        transaction.set(latestRef, thoughtMap);
        transaction.set(stateRef, {
          status: 'ACTIVE',
          processingLeaseId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          lastUpdated: Timestamp.now()
        }, { merge: true });
      });

      return thoughtMap;

    } catch (executionError: unknown) {
      // 9. Release lock on failure
      await db.runTransaction(async (transaction) => {
        const currentLock = await transaction.get(stateRef);
        if (currentLock.exists && currentLock.data()?.processingLeaseId === leaseId) {
          transaction.set(stateRef, {
            status: 'ACTIVE',
            processingLeaseId: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete()
          }, { merge: true });
        }
      }).catch(() => {}); // Best effort unlock

      throw executionError;
    }
  }

  async getLatestThoughtMap(uid: string): Promise<ThoughtMap | null> {
    const doc = await db.collection('users').doc(uid).collection('thoughtMap').doc('latest').get();
    if (!doc.exists) return null;
    return doc.data() as ThoughtMap;
  }
}

export const thoughtMapService = new ThoughtMapService();
