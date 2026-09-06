import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { v4 as uuidv4 } from 'uuid';

export interface ThoughtMapSignal {
  id: string;
  name: string;
  type: 'theme' | 'keyword';
  count: number;
  journalIds: string[];
}

export interface ThoughtMapThemeNode {
  id: string;
  name: string;
  description: string;
  signals: string[];
}

export interface ThoughtMapData {
  themes: ThoughtMapThemeNode[];
  signals: Record<string, ThoughtMapSignal>;
  journalIds: string[];
  createdAt: { _seconds: number; _nanoseconds: number };
  modelVersion: string;
}

export function ThoughtMap() {
  const { user } = useAuth();
  const [thoughtMap, setThoughtMap] = useState<ThoughtMapData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThoughtMap = async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/thought-map/', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 404) {
        setThoughtMap(null);
        return;
      }
      
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to fetch thought map');
      
      setThoughtMap(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchThoughtMap();
  }, [user]);

  const generateMap = async () => {
    if (!user || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/thought-map/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Idempotency-Key': uuidv4(),
          'Content-Type': 'application/json'
        }
      });
      
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to generate map');
      
      setThoughtMap(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return <div className="text-center mt-8" style={{ color: 'var(--text-secondary)' }}>Loading your insights...</div>;
  }

  return (
    <div className="thought-map-container">
      <div className="header" style={{ marginBottom: '2rem', paddingBottom: 0, borderBottom: 'none' }}>
        <div>
          <h2>Your Thought Map</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            AI-generated insights connecting patterns across your journals.
          </p>
        </div>
        <button 
          onClick={generateMap} 
          className="btn-primary" 
          disabled={isGenerating}
        >
          {isGenerating ? 'Analyzing Journals...' : 'Generate Fresh Map'}
        </button>
      </div>

      {error && <div className="error-banner mb-4">{error}</div>}

      {!thoughtMap ? (
        <div className="glass-card text-center" style={{ padding: '4rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧠</div>
          <h3>No Thought Map Yet</h3>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0 2rem', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
            We'll analyze your past journals, find recurring themes and keywords, and use Gemini to map out how your thoughts connect over time.
          </p>
          <button onClick={generateMap} className="btn-primary" disabled={isGenerating}>
            {isGenerating ? 'Generating Map...' : 'Generate Your First Map'}
          </button>
        </div>
      ) : (
        <div className="thought-map-grid">
          {thoughtMap.themes.map(theme => (
            <div key={theme.id} className="glass-card node-card">
              <h3 className="node-title">{theme.name}</h3>
              <p className="node-desc">{theme.description}</p>
              
              <div className="node-signals">
                {theme.signals.map(sigId => {
                  const signal = thoughtMap.signals[sigId];
                  if (!signal) return null;
                  return (
                    <span 
                      key={sigId} 
                      className="tag" 
                      style={{ 
                        background: signal.type === 'theme' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: signal.type === 'theme' ? 'var(--accent-secondary)' : 'var(--accent-primary)'
                      }}
                      title={`Found in ${signal.count} journals`}
                    >
                      {signal.name} <span style={{opacity: 0.6, fontSize: '0.8em'}}>({signal.count})</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
