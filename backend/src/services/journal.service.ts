import { db } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { geminiService, ChatMessage } from './gemini.service.js';
import { GeminiJournalOutput, FinalizeResponse } from '../types/journal.types.js';
import { ConversationData } from '../types/chat.types.js';
import { config } from '../config/index.js';
import { randomUUID } from 'crypto';

export class JournalService {
  /**
   * Orchestrates the secure Phase 3 finalization flow:
   * 1. Lock conversation & transition to SUMMARIZING (Transaction 1)
   * 2. Read Context
   * 3. Gemini Generation (Outside transaction)
   * 4. Persist Journal and transition to ARCHIVED (Transaction 2)
   */
  public async finalizeConversation(uid: string, conversationId: string): Promise<FinalizeResponse> {
    const convRef = db.collection('users').doc(uid).collection('conversations').doc(conversationId);
    const journalsRef = db.collection('users').doc(uid).collection('journals');
    const fencingToken = randomUUID();

    // --- 1. Conversation Lock & SUMMARIZING Transition ---
    await db.runTransaction(async (transaction) => {
      const convDoc = await transaction.get(convRef);
      
      if (!convDoc.exists) {
        throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }

      const data = convDoc.data() as ConversationData;

      if (data.status === 'ARCHIVED') {
        throw new AppError('Conversation is already archived', 409, 'ALREADY_ARCHIVED');
      }

      const now = Timestamp.now();

      // Safe lock recovery: if the processing lease has expired, we can claim it.
      let isRecoverable = false;
      if (data.isProcessing) {
        const leaseExpiresAt = data.processingLeaseExpiresAt;
        if (leaseExpiresAt && leaseExpiresAt.toMillis() <= now.toMillis()) {
          isRecoverable = true; // Lease is dead, we can recover
        } else {
          throw new AppError('Conversation is currently processing a request', 409, 'CONVERSATION_BUSY');
        }
      }

      if (data.status !== 'ACTIVE' && !(data.status === 'SUMMARIZING' && isRecoverable)) {
        throw new AppError(`Conversation is not ACTIVE. Current status: ${data.status}`, 400, 'CONVERSATION_NOT_ACTIVE');
      }

      transaction.update(convRef, {
        status: 'SUMMARIZING',
        isProcessing: true,
        processingStartedAt: now,
        processingLeaseExpiresAt: Timestamp.fromMillis(now.toMillis() + 90000), // 90s lease for summarization
        processingLeaseId: fencingToken
      });
    });

    let journalOutput: GeminiJournalOutput;
    let history: ChatMessage[] = [];
    const newJournalRef = journalsRef.doc(); // Generate ID on backend

    try {
      // --- 2. Context Hydration ---
      const messagesRef = convRef.collection('messages');
      const snapshot = await messagesRef.orderBy('createdAt', 'asc').limit(100).get(); // Get up to 100 messages for full context
      
      snapshot.forEach(doc => {
        const d = doc.data();
        if (['user', 'model', 'system_summary'].includes(d.role)) {
          history.push({ role: d.role as 'user' | 'model' | 'system_summary', text: d.text });
        }
      });

      if (history.length === 0) {
         throw new AppError('Cannot finalize an empty conversation', 400, 'INVALID_REQUEST');
      }

      // --- 3. Gemini Call (OUTSIDE ALL TRANSACTIONS) ---
      journalOutput = await geminiService.summarizeJournal(history);

    } catch (error) {
      // Recovery: Return the conversation to ACTIVE and release the lock on Gemini failure
      // ONLY if we still own the lease.
      await db.runTransaction(async (transaction) => {
        const currentConv = await transaction.get(convRef);
        const currentData = currentConv.data() as ConversationData;
        if (currentData?.processingLeaseId === fencingToken) {
          transaction.update(convRef, { 
            status: 'ACTIVE',
            isProcessing: false,
            processingStartedAt: FieldValue.delete(),
            processingLeaseExpiresAt: FieldValue.delete(),
            processingLeaseId: FieldValue.delete()
          });
        }
      }).catch(() => {});
      throw error;
    }

    // --- 4. Final Persistence (Short Transaction) ---
    try {
      await db.runTransaction(async (transaction) => {
        const currentConv = await transaction.get(convRef);
        const currentData = currentConv.data() as ConversationData;
        
        // Fencing Token check to prevent slow zombies from overwriting new recoveries
        if (currentData?.processingLeaseId !== fencingToken) {
           throw new AppError('Lease hijacked by concurrent request', 409, 'LEASE_LOST');
        }

        if (currentData?.status === 'ARCHIVED') {
           return; // Defense in depth
        }

        const now = Timestamp.now();

        // 4a. Create the Journal
        transaction.set(newJournalRef, {
          title: journalOutput.title,
          summary: journalOutput.summary,
          keywords: journalOutput.keywords,
          themes: journalOutput.themes,
          sourceConversationId: conversationId,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
          modelVersion: config.GEMINI_MODEL
        });

        // 4b. Archive the Conversation
        transaction.update(convRef, {
          status: 'ARCHIVED',
          journalId: newJournalRef.id,
          isProcessing: false,
          processingStartedAt: FieldValue.delete(),
          processingLeaseExpiresAt: FieldValue.delete(),
          processingLeaseId: FieldValue.delete(),
          updatedAt: now
        });
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'LEASE_LOST') {
        throw new AppError('Lease expired and was recovered by another request', 409, 'LEASE_LOST');
      }
      throw new AppError('Failed to persist journal', 500, 'JOURNAL_PERSISTENCE_FAILED');
    }

    return {
      journalId: newJournalRef.id,
      conversationId
    };
  }
}

export const journalService = new JournalService();
