import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Calendar from './components/Calendar';
import ChatAssistant from './components/ChatAssistant';
import { useToasts } from './components/Notifications';
import UserMenu from './components/UserMenu';
import './components/UserMenu.css';
import Clock from './components/Clock';

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
                <header className="app-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'1rem',padding:'0.5rem 1rem'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
                    <h1 style={{margin:0,fontSize:'1.4rem'}}>Orgainizer</h1>
                    <Clock />
                  </div>
                  <UserMenu onLogout={handleLogout} />
                </header>
                <div className="main-content">
                  <Calendar token={token!} />
                  <ChatAssistant token={token!} />
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
