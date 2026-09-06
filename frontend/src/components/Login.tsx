import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export const Login: React.FC = () => {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="glass-card text-center" style={{ maxWidth: '500px', width: '100%', padding: '4rem 2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>Gemini Journal</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem', fontSize: '1.1rem' }}>
          A private, AI-powered thinking companion.
        </p>
        <button onClick={signInWithGoogle} className="btn-primary" style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
};
