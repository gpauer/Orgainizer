import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
  console.log('handleLogin called with token:', newToken);
  localStorage.setItem('token', newToken);
  setToken(newToken);
  setIsAuthenticated(true);
  console.log('isAuthenticated:', true);
  };
  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setIsAuthenticated(false);
  };
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          isAuthenticated ? <Navigate to="/calendar" /> : <Login onLogin={handleLogin} />
        } />
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
              <Calendar token={token} />
              <ChatAssistant token={token} />
            </div>
          ) : <Navigate to="/login" />
        } />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
