import { db } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { geminiService, ChatMessage } from './gemini.service.js';
import { ChatRequest, ChatResponse } from '../types/chat.types.js';

export class ChatService {
  /**
   * Initializes a new backend-generated conversation.
   */
  public async createConversation(uid: string): Promise<string> {
    const convRef = db.collection('users').doc(uid).collection('conversations').doc();
    
    await convRef.set({
      status: 'ACTIVE',
      isProcessing: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      schemaVersion: 1
    });

    return convRef.id;
  }

  /**
   * Orchestrates the secure Phase 2 chat flow:
   * 1. Lock conversation (Transaction 1)
   * 2. Read Context
   * 3. Gemini Generation (Outside transaction)
   * 4. Persist data and unlock (Transaction 2)
   */
  public async handleChat(uid: string, req: ChatRequest, idempotencyKey: string): Promise<ChatResponse> {
    const convRef = db.collection('users').doc(uid).collection('conversations').doc(req.conversationId);
    const messagesRef = convRef.collection('messages');

    // --- 1. Conversation Lock (Short Transaction) ---
    await db.runTransaction(async (transaction) => {
      const convDoc = await transaction.get(convRef);
      
      if (!convDoc.exists) {
        throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }

      const data = convDoc.data();
      if (data?.status !== 'ACTIVE') {
        throw new AppError('Conversation is not ACTIVE', 400, 'CONVERSATION_NOT_ACTIVE');
      }

      const now = Timestamp.now();

      if (data?.isProcessing) {
        // Safe lock recovery: if the processing lease has expired, it means a previous request crashed
        // after acquiring the lock but before finalizing. We can safely claim it now.
        const leaseExpiresAt = data.processingLeaseExpiresAt as Timestamp | undefined;
        if (leaseExpiresAt && leaseExpiresAt.toMillis() > now.toMillis()) {
          throw new AppError('Conversation is currently processing a request', 409, 'CONVERSATION_BUSY');
        }
      }

      // Max lease of 60 seconds (longer than Cloud Run request timeout for Gemini)
      transaction.update(convRef, {
        isProcessing: true,
        processingStartedAt: now,
        processingLeaseExpiresAt: Timestamp.fromMillis(now.toMillis() + 60000)
      });
    });

    let modelResponse: string;
    let history: ChatMessage[] = [];
    const userMessageRef = messagesRef.doc();
    const modelMessageRef = messagesRef.doc();

    try {
      // --- 2. Context Hydration ---
      const snapshot = await messagesRef.orderBy('createdAt', 'desc').limit(6).get();
      
      snapshot.forEach(doc => {
        const d = doc.data();
        if (['user', 'model', 'system_summary'].includes(d.role)) {
          history.unshift({ role: d.role as 'user' | 'model' | 'system_summary', text: d.text });
        }
      });

      // --- 3. Gemini Call (OUTSIDE ALL TRANSACTIONS) ---
      modelResponse = await geminiService.generateChatResponse(history, req.message);

    } catch (error) {
      // Recovery: Best-effort release the lock on Gemini/Hydration failure
      await convRef.update({ 
        isProcessing: false,
        processingStartedAt: FieldValue.delete(),
        processingLeaseExpiresAt: FieldValue.delete()
      }).catch(() => {});
      throw error;
    }

    // --- 4. Final Persistence (Short Transaction) ---
    try {
      await db.runTransaction(async (transaction) => {
        // We write the new documents and unlock the conversation simultaneously
        transaction.set(userMessageRef, {
          role: 'user',
          text: req.message,
          createdAt: Timestamp.now(),
          idempotencyKey,
          schemaVersion: 1
        });

        transaction.set(modelMessageRef, {
          role: 'model',
          text: modelResponse,
          createdAt: Timestamp.now(),
          schemaVersion: 1
        });

        transaction.update(convRef, {
          isProcessing: false,
          processingStartedAt: FieldValue.delete(),
          processingLeaseExpiresAt: FieldValue.delete(),
          updatedAt: Timestamp.now()
        });
      });
    } catch (error) {
      // Explicit Failure Boundary Documentation:
      // If persistence fails, the conversation remains locked, representing an incomplete state that will automatically recover via lease expiration.
      // The idempotency key will be marked FAILED by the controller.
      throw new AppError('Failed to persist conversation history', 500, 'PERSISTENCE_FAILED');
    }

    return {
      conversationId: req.conversationId,
      userMessageId: userMessageRef.id,
      modelMessageId: modelMessageRef.id,
      modelResponse
    };
  }
}

export const chatService = new ChatService();
