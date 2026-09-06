import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';

export const thoughtMapSignalSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['theme', 'keyword']),
  count: z.number().int().min(1),
  journalIds: z.array(z.string())
});

export const thoughtMapThemeNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().min(10).max(500),
  signals: z.array(z.string()) // Array of signal IDs that form this interpretation
});

export const geminiThoughtMapOutputSchema = z.object({
  themes: z.array(thoughtMapThemeNodeSchema).max(10)
}).strict();

export type GeminiThoughtMapOutput = z.infer<typeof geminiThoughtMapOutputSchema>;
export type ThoughtMapSignal = z.infer<typeof thoughtMapSignalSchema>;
export type ThoughtMapThemeNode = z.infer<typeof thoughtMapThemeNodeSchema>;

export interface ThoughtMap {
  themes: ThoughtMapThemeNode[];
  signals: Record<string, ThoughtMapSignal>; // Dictionary of all signals used
  journalIds: string[]; // All unique journal IDs referenced
  createdAt: Timestamp;
  modelVersion: string;
}

export const thoughtMapPreferencesSchema = z.object({
  includeInThoughtMap: z.boolean()
});

export type ThoughtMapPreferences = z.infer<typeof thoughtMapPreferencesSchema>;
