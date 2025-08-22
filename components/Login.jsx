import React from 'react';
import axios from 'axios';

function Login({ onLogin }) {
  const handleGoogleLogin = async () => {
    try {
      const response = await axios.get('/api/auth/google');
      window.location.href = response.data.url;
    } catch (error) {
      console.error('Login error:', error);
    }
  };
  
  // Handle OAuth callback
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      axios.get(`/api/auth/google/callback?code=${code}`)
        .then(response => {
          onLogin(response.data.tokens.access_token);
        })
        .catch(error => {
          console.error('Auth callback error:', error);
        });
    }
  }, [onLogin]);

  return (
    <div className="login-container">
      <h1>AI Calendar Assistant</h1>
      <button onClick={handleGoogleLogin}>Sign in with Google</button>
    </div>
  );
}

export default Login;