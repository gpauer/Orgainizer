import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Calendar from './components/Calendar';
import ChatAssistant from './components/ChatAssistant';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(null);
  
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }
  }, []);
  
  const handleLogin = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setIsAuthenticated(true);
  };
  
  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setIsAuthenticated(false);
  };
  
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          isAuthenticated ? <Navigate to="/calendar" /> : <Login onLogin={handleLogin} />
        } />
        <Route path="/calendar" element={
          isAuthenticated ? (
            <div className="app-container">
              <header>
                <h1>AI Calendar Assistant</h1>
                <button onClick={handleLogout}>Logout</button>
              </header>
              <main>
                <Calendar token={token} />
                <ChatAssistant token={token} />
              </main>
            </div>
          ) : <Navigate to="/login" />
        } />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/calendar" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;