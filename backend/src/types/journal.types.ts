import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';

export const journalSchema = z.object({
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(2000),
  keywords: z.array(z.string().min(1).max(30)).max(5),
  themes: z.array(z.string().min(1).max(30)).max(5)
}).strict();

export type GeminiJournalOutput = z.infer<typeof journalSchema>;

export interface JournalEntry {
  title: string;
  summary: string;
  keywords: string[];
  themes: string[];
  sourceConversationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  schemaVersion: number;
  modelVersion: string;
  includeInThoughtMap?: boolean; // Defaults to true if undefined
}

export interface FinalizeResponse {
  journalId: string;
  conversationId: string;
}
