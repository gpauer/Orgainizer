import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// Dynamic API base (relative in production, configurable or localhost in dev)
const API_BASE = process.env.NODE_ENV === 'production'
  ? '/api'
  : (process.env.REACT_APP_API_BASE || 'http://localhost:3001/api');

interface LoginProps {
  onLogin: (token: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    try {
      const response = await axios.get(`${API_BASE}/auth/google`);
      window.location.href = response.data.url;
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      axios
        .get(`${API_BASE}/auth/google/callback?code=${code}`)
        .then(response => {
          const accessToken = response.data.tokens.access_token as string;
          onLogin(accessToken);
          navigate('/calendar');
        })
        .catch(error => {
          console.error('Auth callback error:', error);
        });
    }
  }, [onLogin, navigate]);

  return (
    <div className="login-container">
      <h1>AI Calendar Assistant</h1>
      <button onClick={handleGoogleLogin}>Sign in with Google</button>
    </div>
  );
};

export default Login;
