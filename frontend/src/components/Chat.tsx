import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../contexts/AuthContext';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export function Chat() {
  const { user } = useAuth();
  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem('activeConversationId'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track the current idempotency key for retries
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState<string>(uuidv4());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Hydrate conversation on load
  useEffect(() => {
    if (!conversationId || !user) return;
    
    const hydrateConversation = async () => {
      try {
        setIsLoading(true);
        const token = await user.getIdToken();
        const res = await fetch(`/api/chat/${conversationId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
          // If 404 or other error, clear the local storage so we can start fresh
          localStorage.removeItem('activeConversationId');
          setConversationId(null);
          return;
        }
        
        const json = await res.json();
        // Skip system summaries, load only user/model messages
        const loadedMessages = json.data.messages.filter((m: any) => m.role !== 'system_summary');
        setMessages(loadedMessages);
      } catch (err: any) {
        console.error("Failed to hydrate conversation", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    // Only hydrate if messages are empty to prevent re-fetching on hot reloads
    if (messages.length === 0) {
      hydrateConversation();
    }
  }, [conversationId, user]);

  const startConversation = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const token = await user.getIdToken();
      const res = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to start conversation');
      const json = await res.json();
      setConversationId(json.data.conversationId);
      localStorage.setItem('activeConversationId', json.data.conversationId);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (e?: React.FormEvent, isRetry = false) => {
    e?.preventDefault();
    
    const textToSend = input.trim();
    if (!textToSend || !user || !conversationId || isLoading) return;

    // Use the same idempotency key if this is a retry of a failed request, otherwise generate new
    const idempotencyKey = isRetry ? currentIdempotencyKey : uuidv4();
    setCurrentIdempotencyKey(idempotencyKey);

    setIsLoading(true);
    setError(null);
    
    // Only add to UI if it's a fresh send (not a retry of an already-visible user message)
    if (!isRetry) {
      setMessages(prev => [...prev, { id: idempotencyKey, role: 'user', text: textToSend }]);
      setInput(''); // clear input only on fresh send
    }

    try {
      const token = await user.getIdToken();
      
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          message: textToSend,
          conversationId
        })
      });

      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error?.message || 'Chat request failed');
      }

      // Success
      setMessages(prev => [...prev, { 
        id: json.data.modelMessageId, 
        role: 'model', 
        text: json.data.modelResponse 
      }]);
      
      // Request completed, we will need a new idempotency key for next message
      setCurrentIdempotencyKey(uuidv4());
      
    } catch (err: any) {
      setError(err.message);
      // We keep the currentIdempotencyKey so the user can hit 'Retry' safely
      // And we restore the input so they don't lose their typed text if they want to edit it
      if (!isRetry) {
          // Remove the optimistically added user message to keep UI in sync with backend
          setMessages(prev => prev.filter(m => m.id !== idempotencyKey));
          setInput(textToSend);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const finalizeConversation = async () => {
    if (!user || !conversationId || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/journal/finalize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': uuidv4()
        },
        body: JSON.stringify({ conversationId })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to finalize');
      
      // Reset state for new chat
      localStorage.removeItem('activeConversationId');
      setConversationId(null);
      setMessages([]);
      setInput('');
      alert("Journal saved and summarized!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!conversationId) {
    return (
      <div className="text-center mt-8">
        <h2>Start a New Reflection</h2>
        <p className="mt-4" style={{ color: 'var(--text-secondary)' }}>Clear your mind and document your day.</p>
        <button onClick={startConversation} className="btn-primary mt-4">
          Begin Chat
        </button>
        {error && <div className="error-banner mt-4">{error}</div>}
      </div>
    );
  }

  return (
    <div className="glass-card chat-container">
      
      {/* Message List */}
      <div className="message-list">
        {messages.length === 0 && <p className="text-center" style={{ color: 'var(--text-secondary)' }}>No messages yet. Start typing!</p>}
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role === 'user' ? 'user' : 'model'}`}>
            {msg.role === 'model' ? (
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            ) : (
              msg.text
            )}
          </div>
        ))}
        {isLoading && <div className="typing-indicator">Gemini is thinking...</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Error / Retry Banner */}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => sendMessage(undefined, true)} className="btn-secondary" disabled={isLoading}>
            Retry Request
          </button>
        </div>
      )}

      {/* Chat Input */}
      <form onSubmit={(e) => sendMessage(e, false)} className="chat-input-form">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your reflection here..."
          disabled={isLoading}
        />
        <button type="submit" className="btn-primary" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
      
      {/* Finalize Button */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
          <button 
            onClick={finalizeConversation} 
            className="btn-secondary" 
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : 'Save & Summarize Journal'}
          </button>
        </div>
      )}
    </div>
  );
}
