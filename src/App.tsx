import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Calendar from './components/Calendar';
import ChatAssistant from './components/ChatAssistant';
import VoiceAssistant from './components/VoiceAssistant';
import { useToasts } from './components/Notifications';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setIsAuthenticated(false);
  };

  const { push } = useToasts();

  useEffect(() => {
    const handler = () => {
      push({ type: 'warn', message: 'Session expired. Please sign in again.' });
      handleLogout();
    };
    window.addEventListener('app:auth-expired', handler);
    return () => window.removeEventListener('app:auth-expired', handler);
  }, [push]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? <Navigate to="/calendar" /> : <Login onLogin={handleLogin} />
          }
        />
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/calendar" /> : <Login onLogin={handleLogin} />
          }
        />
        <Route
          path="/calendar"
          element={
            isAuthenticated ? (
              <div className="app-container">
                <header>
                  <h1>AI Calendar Assistant</h1>
                  <button onClick={handleLogout}>Logout</button>
                </header>
                <div className="main-content">
                  <Calendar token={token!} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                    <ChatAssistant token={token!} />
                    <VoiceAssistant token={token!} />
                  </div>
                </div>
              </div>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
