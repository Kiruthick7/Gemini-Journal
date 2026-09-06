import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface JournalSearchResult {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  themes: string[];
  createdAt: { _seconds: number; _nanoseconds: number };
  updatedAt: { _seconds: number; _nanoseconds: number };
}

export function Search() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JournalSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState<JournalSearchResult | null>(null);

  // Load recent journals on mount
  useEffect(() => {
    if (!user) return;
    
    const loadRecentJournals = async () => {
      setIsLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/journal/`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const json = await res.json();
        
        if (res.ok) {
          setResults(json.data);
          setHasMore(false); // simple limit endpoint doesn't return hasMore
        }
      } catch (err) {
        console.error("Failed to load recent journals:", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadRecentJournals();
  }, [user]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const textQuery = query.trim();
    
    if (!textQuery || !user || isLoading) return;

    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/journal/search?q=${encodeURIComponent(textQuery)}&limit=10`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error?.message || 'Search failed');
      }

      setResults(json.data.results);
      setHasMore(json.data.hasMore);

    } catch (err: any) {
      setError(err.message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: { _seconds?: number, seconds?: number }) => {
    if (!timestamp) return 'Unknown date';
    // Firestore Timestamp can be serialized as _seconds or seconds
    const seconds = timestamp._seconds ?? timestamp.seconds;
    if (!seconds) return 'Unknown date';
    const date = new Date(seconds * 1000);
    return date.toLocaleDateString();
  };

  return (
    <div className="search-container">
      
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your journal (e.g. 'career goals')"
          disabled={isLoading}
          aria-label="Search your journal"
        />
        <button type="submit" className="btn-primary" disabled={isLoading || !query.trim()}>
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {/* Results List */}
      <div className="search-results">
        {!isLoading && hasSearched && results.length === 0 && !error && (
          <div className="text-center" style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', marginTop: '2rem' }}>
            <p>No journal entries matched that search.</p>
            <p style={{ fontSize: '0.9em' }}>Try a broader phrase.</p>
          </div>
        )}

        {results.map(journal => (
          <div 
            key={journal.id} 
            className="journal-card glass-card"
            style={{ padding: '1.5rem', background: 'var(--bg-tertiary)' }}
            onClick={() => setSelectedJournal(journal)}
          >
            <div className="journal-card-header">
              <h3 className="journal-card-title">{journal.title}</h3>
              <span className="journal-card-date">
                {formatDate(journal.createdAt)}
              </span>
            </div>
            
            <p className="journal-card-summary">
              {journal.summary}
            </p>
            
            <div className="tag-container">
              {journal.themes.map((theme, i) => (
                <span key={i} className="tag">
                  {theme}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
        
      {hasMore && (
        <div className="text-center mt-4" style={{ color: 'var(--text-secondary)' }}>
          More results available. Please refine your search.
        </div>
      )}

      {/* Journal Detail Modal */}
      {selectedJournal && (
        <div className="modal-overlay" onClick={() => setSelectedJournal(null)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <h2 style={{ background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {selectedJournal.title}
              </h2>
              <button 
                onClick={() => setSelectedJournal(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              {formatDate(selectedJournal.createdAt)}
            </div>
            
            <div style={{ marginBottom: '2rem', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
              {selectedJournal.summary}
            </div>
            
            <div>
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Themes & Tags</h4>
              <div className="tag-container">
                {selectedJournal.themes.map((theme, i) => (
                  <span key={`theme-${i}`} className="tag" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-secondary)' }}>
                    {theme}
                  </span>
                ))}
                {selectedJournal.keywords.map((keyword, i) => (
                  <span key={`keyword-${i}`} className="tag">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
