import { Timestamp } from 'firebase-admin/firestore';

export interface ChatRequest {
  message: string;
  conversationId: string;
}

export interface ChatResponse {
  conversationId: string;
  userMessageId: string;
  modelMessageId: string;
  modelResponse: string;
}

import { FinalizeResponse } from './journal.types.js';

import { ThoughtMap } from './thought-map.types.js';

export interface IdempotencyRecord {
  operation: 'CHAT' | 'JOURNAL_FINALIZE' | 'THOUGHT_MAP_GENERATE';
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  requestFingerprint: string;
  response?: ChatResponse | FinalizeResponse | ThoughtMap;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  leaseExpiresAt?: Timestamp; // Deprecated for idempotency but retained for schema completeness
}

export interface ConversationData {
  status: 'ACTIVE' | 'SUMMARIZING' | 'ARCHIVED';
  isProcessing: boolean;
  processingStartedAt?: Timestamp;
  processingLeaseExpiresAt?: Timestamp;
  processingLeaseId?: string; // Fencing token for concurrent recovery
  journalId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type IdempotencyAcquireResult<T = ChatResponse | FinalizeResponse> =
  | { status: 'ACQUIRED' }
  | { status: 'COMPLETED'; response: T }
  | { status: 'IN_PROGRESS' }
  | { status: 'CONFLICT'; reason: string }
  | { status: 'FAILED' };
