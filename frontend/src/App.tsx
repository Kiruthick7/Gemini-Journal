import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Login } from './components/Login'
import { Chat } from './components/Chat'
import { Search } from './components/Search'
import { ThoughtMap } from './components/ThoughtMap'
import './index.css'

function AuthenticatedApp() {
  const { logout } = useAuth();
  const [currentView, setCurrentView] = useState<'chat' | 'search' | 'thought-map'>('chat');
  
  return (
    <div className="app-container">
      <header className="header">
        <h1>Gemini Journal</h1>
        <div className="header-controls">
          <nav className="nav-pills">
            <button 
              onClick={() => setCurrentView('chat')}
              className={`nav-pill ${currentView === 'chat' ? 'active' : ''}`}
            >
              Today
            </button>
            <button 
              onClick={() => setCurrentView('search')}
              className={`nav-pill ${currentView === 'search' ? 'active' : ''}`}
            >
              Search
            </button>
            <button 
              onClick={() => setCurrentView('thought-map')}
              className={`nav-pill ${currentView === 'thought-map' ? 'active' : ''}`}
            >
              Thought Map
            </button>
          </nav>
          <button onClick={logout} className="btn-secondary">Logout</button>
        </div>
      </header>
      <main>
        <div style={{ display: currentView === 'chat' ? 'block' : 'none' }}>
          <Chat />
        </div>
        <div style={{ display: currentView === 'search' ? 'block' : 'none' }}>
          <Search />
        </div>
        <div style={{ display: currentView === 'thought-map' ? 'block' : 'none' }}>
          <ThoughtMap />
        </div>
      </main>
    </div>
  )
}

function MainContent() {
  const { user } = useAuth();
  return user ? <AuthenticatedApp /> : <Login />;
}

function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  )
}

export default App
