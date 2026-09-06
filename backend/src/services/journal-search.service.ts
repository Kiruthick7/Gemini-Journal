import { db } from '../utils/firebase.js';
import { AppError } from '../errors/AppError.js';
import { geminiService } from './gemini.service.js';
import { Timestamp } from 'firebase-admin/firestore';

export interface JournalSearchResult {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  themes: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SearchResponse {
  query: string;
  keywords: string[];
  results: JournalSearchResult[];
  hasMore: boolean;
}

export class JournalSearchService {
  /**
   * Orchestrates the Phase 4 keyword search.
   */
  public async searchJournals(uid: string, query: string, limit: number, requestId?: string): Promise<SearchResponse> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      throw new AppError('Search query cannot be empty', 400, 'BAD_REQUEST');
    }

    // 1. Keyword Extraction (Local vs Gemini)
    let keywords: string[] = [];
    
    // Stop words to filter out from local tokenization
    const stopWords = new Set(['a', 'the', 'in', 'my', 'about', 'what', 'how', 'why', 'did', 'i', 'to', 'for', 'of', 'and', 'with', 'on', 'at']);
    const tokens = trimmedQuery
      .toLowerCase()
      .split(/[\s,\.\-]+/)
      .map(t => t.trim())
      .filter(t => t.length > 2 && !stopWords.has(t));

    // If it's a very simple search (1-3 distinct keywords and no question markers)
    const isSimple = tokens.length > 0 && tokens.length <= 3 && !trimmedQuery.includes('?');
    
    if (isSimple) {
      keywords = Array.from(new Set(tokens));
    } else {
      const extracted = await geminiService.extractSearchKeywords(trimmedQuery, requestId);
      keywords = Array.from(new Set(extracted.map(k => k.toLowerCase())));
    }

    if (keywords.length === 0) {
      return {
        query: trimmedQuery,
        keywords: [],
        results: [],
        hasMore: false
      };
    }

    // Generate Title Cased versions for case-insensitive matching
    const titleCasedKeywords = keywords.map(kw => kw.charAt(0).toUpperCase() + kw.slice(1));
    
    // Firestore array-contains-any allows a maximum of 10 elements
    const safeKeywords = Array.from(new Set([...keywords, ...titleCasedKeywords])).slice(0, 10);
    const safeThemeKeywords = Array.from(new Set([...keywords, ...titleCasedKeywords])).slice(0, 10);

    // 2. Firestore Retrieval (Bounded to safe maximum for in-memory ranking)
    const candidateLimit = Math.max(50, limit * 3);
    const journalsRef = db.collection('users').doc(uid).collection('journals');
    
    const [keywordsSnapshot, themesSnapshot] = await Promise.all([
      journalsRef.where('keywords', 'array-contains-any', safeKeywords).limit(candidateLimit).get(),
      journalsRef.where('themes', 'array-contains-any', safeThemeKeywords).limit(candidateLimit).get()
    ]);

    // 3. Merging and Deduplication
    const resultsMap = new Map<string, JournalSearchResult>();

    const processSnapshot = (snapshot: FirebaseFirestore.QuerySnapshot) => {
      snapshot.forEach(doc => {
        if (!resultsMap.has(doc.id)) {
          const data = doc.data();
          resultsMap.set(doc.id, {
            id: doc.id,
            title: data.title,
            summary: data.summary,
            keywords: data.keywords || [],
            themes: data.themes || [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
          });
        }
      });
    };

    processSnapshot(keywordsSnapshot);
    processSnapshot(themesSnapshot);

    const mergedResults = Array.from(resultsMap.values());

    // 4. Local Ranking
    const scoredResults = mergedResults.map(journal => {
      let score = 0;
      
      const journalTitleLower = journal.title.toLowerCase();
      const journalKeywordsLower = journal.keywords.map(k => k.toLowerCase());
      const journalThemesLower = journal.themes.map(t => t.toLowerCase());

      keywords.forEach(kw => {
        if (journalTitleLower.includes(kw)) score += 5;
        if (journalKeywordsLower.includes(kw)) score += 3;
        if (journalThemesLower.includes(kw)) score += 2;
      });

      return { journal, score };
    });

    // Sort by Score DESC, then CreatedAt DESC
    scoredResults.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score; // Score DESC
      }
      return b.journal.createdAt.toMillis() - a.journal.createdAt.toMillis(); // CreatedAt DESC
    });

    // 5. Pagination Bounds
    const hasMore = scoredResults.length > limit;
    const paginatedResults = scoredResults.slice(0, limit).map(sr => sr.journal);

    return {
      query: trimmedQuery,
      keywords,
      results: paginatedResults,
      hasMore
    };
  }
}

export const journalSearchService = new JournalSearchService();
